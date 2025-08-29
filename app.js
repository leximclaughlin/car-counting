// Dependencies
import express from 'express';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { scheduleJob } from 'node-schedule';
import fs from 'fs';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

const API_KEY = 'MmFkNTU0ZmUtZTE2NS00NjJjLWJjZjYtNzM0YmE5MGMwODc4fDVkZTNkMGU5LWI2YzMtNDk3OS1iOTgzLWYxMTU1MTgzODg3ZQ=='; 
const CAMERA_ID = 'eb1dcecf-76d9-471d-9d61-955a0bff6861'; 

const TOTAL_SPOTS = 55;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// Serve static files
app.use(express.static('static'));

app.get('/reports/list', (req, res) => {
  const dir = path.join(__dirname, 'static', 'reports');
  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir);
  const months = files
    .filter(f => f.endsWith('.csv'))
    .map(f => f.replace('.csv', ''));
  res.json(months.sort().reverse());
});

// Register the static middleware
app.use('/reports', express.static(path.join(__dirname, 'static', 'reports')));

app.use(express.json());


const USERS_FILE = path.join(__dirname, 'src', 'data', 'users.json');

// Ensure the reports directory exists
const reportsDir = path.join(__dirname, 'static', 'reports');
if (!existsSync(reportsDir)) {
  mkdirSync(reportsDir, { recursive: true });
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'login.html'));
});

// get token
async function getToken() {
  const response = await axios.post('https://api.verkada.com/token', {}, {
    headers: {
      accept: 'application/json',
      'x-api-key': API_KEY,
    },
  }); 
  console.log("Token:",  response.data.token);
  return response.data.token;
}

// August 18, 2025 at 3:00PM EDT (19:00 UTC)
const START_TIMESTAMP = 1755558000

async function getLiveVehicleCount(token) {
  const now = Math.floor(Date.now() / 1000);  
  const manualBaseline = loadManualBaseline(); // always read fresh

  const baselineTimestamp = manualBaseline?.timestamp || START_TIMESTAMP;
  const baseCount = manualBaseline?.count || 20; // actual count of 20 cars on start date

  const url = `https://api.verkada.com/cameras/v1/analytics/occupancy_trends?camera_id=${CAMERA_ID}&start_time=${baselineTimestamp}&interval=1_hour&type=vehicle&preset_id=e3bf81d8-a1a8-4822-8bfa-1e56bc38af65`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-verkada-auth': token
    }
  });

  const data = await response.json();

  const totalIn = data.trend_in.reduce((sum, [start, end, count]) => sum + count, 0);
  const totalOut = data.trend_out.reduce((sum, [start, end, count]) => sum + count, 0);

  // Clamp live result so it never exceeds TOTAL_SPOTS or goes below 0
  return clamp(baseCount + (totalIn - totalOut), 0, TOTAL_SPOTS);
  // return baseCount + (totalIn - totalOut);
}
  
  
const BASELINE_PATH = path.join(__dirname, 'manualBaseline.json');

function loadManualBaseline() {
  if (fs.existsSync(BASELINE_PATH)) {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  }
  return null;
}


function saveManualBaseline(baseline) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline));
}

app.post('/car-count', express.json(), (req, res) => {
  const { newCount } = req.body;
  if (typeof newCount === 'number' && newCount >= 0) {
    const now = Math.floor(Date.now() / 1000) - 60;
    const newBaseline = {
      count: newCount,
      timestamp: now
    };
    saveManualBaseline(newBaseline);

    console.log(`Manual count set to:`, newBaseline);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid count' });
  }
});

app.get('/car-count', async (req, res) => {
  try {
    const token = await getToken();
    const liveCount = await getLiveVehicleCount(token);
    const manualBaseline = loadManualBaseline(); // fresh read here too

    res.json({
      liveCount,
      isManual: manualBaseline !== null
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message || error);
    res.status(500).json({ error: 'Failed to retrieve live vehicle count' });
  }
});

app.delete('/car-count', (req, res) => {
  if (fs.existsSync(BASELINE_PATH)) {
    fs.unlinkSync(BASELINE_PATH);
  }
  console.log('Manual count cleared');
  res.json({ success: true });
});


function formatDateMMDDYYYY(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function formatTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function getFirstOfMonthTimestamp(year, month) {
  const date = new Date(Date.UTC(year, month - 1, 1, 4, 0, 0)); // 4AM UTC = midnight Eastern
  return Math.floor(date.getTime() / 1000);
}

async function findDailyPeakCounts(token, year, month) {
  const startTime = getFirstOfMonthTimestamp(year, month);
  const endTime = getFirstOfMonthTimestamp(year, month + 1); // next month start

  const now = Math.floor(Date.now() / 1000);  
  const manualBaseline = loadManualBaseline(); // always read fresh

  const baselineTimestamp = manualBaseline?.timestamp || START_TIMESTAMP;
  const baseCount = manualBaseline?.count || 20; // actual count of 20 cars on start date

 // const url = `https://api.verkada.com/cameras/v1/analytics/dashboard_occupancy_trends?dashboard_id=163fd2d5-f996-42ce-b0f9-85065e9ad7f4&start_time=${startTime}&end_time=${endTime}&interval=1_hour`;
  const url = `https://api.verkada.com/cameras/v1/analytics/occupancy_trends?camera_id=${CAMERA_ID}&start_time=${baselineTimestamp}&interval=1_hour&type=vehicle&preset_id=e3bf81d8-a1a8-4822-8bfa-1e56bc38af65`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-verkada-auth': token
    }
  });

  const data = await response.json();
  console.log('Verkada API response for', year, month, ':', JSON.stringify(data, null, 2));
  if (!data.trend_in || !data.trend_out) {
    console.warn('No trend_in or trend_out data for', year, month);
    return [];
  }

  const hourlyChanges = new Map();
  for (const [start, , count] of data.trend_in) {
    hourlyChanges.set(start, (hourlyChanges.get(start) || 0) + count);
  }
  for (const [start, , count] of data.trend_out) {
    hourlyChanges.set(start, (hourlyChanges.get(start) || 0) - count);
  }

  let runningTotal = baseCount;
  const dailyMaxMap = {};

  const sortedTimestamps = [...hourlyChanges.keys()].sort((a, b) => a - b);
  for (const timestamp of sortedTimestamps) {
    runningTotal += hourlyChanges.get(timestamp);
    const dateStr = formatDateMMDDYYYY(timestamp);
    if (!dailyMaxMap[dateStr] || runningTotal > dailyMaxMap[dateStr].count) {
      dailyMaxMap[dateStr] = {
        count: runningTotal,
        timestamp
      };
    }
  }

  return Object.entries(dailyMaxMap).map(([date, { count, timestamp }]) => ({
    date,
    peakCount: count,
    peakTime: formatTime(timestamp)
  }));
}

async function generateMonthlyReport(year, month) {
  const token = await getToken();
  const peakData = await findDailyPeakCounts(token, year, month);
  const csv = convertToCSV(peakData);

  const label = `${year}-${String(month).padStart(2, '0')}`;
  const filePath = path.join(__dirname, 'static', 'reports', `${label}.csv`);
  fs.writeFileSync(filePath, csv);
  console.log(`Report generated for ${label}`);
}


app.get('/peak-data', async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // JS months are 0-based

    const token = await getToken();
    const peakData = await findDailyPeakCounts(token, year, month); // ✅ pass args
    res.json(peakData);
  } catch (err) {
    console.error('Error fetching peak data:', err);
    res.status(500).json({ error: 'Failed to fetch peak data' });
  }
});


function getPreviousMonthYear() {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`; // e.g. "2025-06"
}

// Helper: run on the 1st to generate the PREVIOUS month's report
scheduleJob('5 0 1 * *', async () => {
  try {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    if (prev.getMonth() + 1) {
      await generateMonthlyReport(prev.getFullYear(), prev.getMonth() + 1);
    }
    console.log(`Scheduled report generated for ${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,'0')}`);
  } catch (err) {
    console.error('❌ Scheduled report failed:', err);
  }
});

// Backfill from a chosen start month up to the last fully completed month
async function backfillMissingReports({ startYear, startMonth }) {
  const reportsDir = path.join(__dirname, 'static', 'reports');
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });

  // Build a set of already-generated report labels like "2025-06"
  const existing = new Set(
    fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.csv'))
      .map(f => f.replace('.csv', ''))
  );

  // Last completed month (today is August -> last completed is July)
  const today = new Date();
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  // Iterate months [start .. lastCompleted]
  for (
    let d = new Date(startYear, startMonth - 1, 1);
    d <= lastCompleted;
    d.setMonth(d.getMonth() + 1)
  ) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const label = `${y}-${String(m).padStart(2, '0')}`;

    if (!existing.has(label)) {
      console.log(` Backfilling ${label}...`);
      try {
        await generateMonthlyReport(y, m);
      } catch (e) {
        console.error(`❌ Failed to backfill ${label}:`, e);
      }
    } else {
      console.log(`Already have ${label}, skipping.`);
    }
  }
}

// Backfill starting June 2025 
backfillMissingReports({ startYear: 2025, startMonth: 6 })
  .then(() => console.log('Backfill complete'))
  .catch(err => console.error('Backfill error:', err));


function convertToCSV(data) {
  const header = 'Date,Peak Count,Time of Peak';
  const rows = data.map(row => `${row.date},${row.peakCount},${row.peakTime}`);
  return [header, ...rows].join('\n');
}

app.get('/reports/:yearMonth', (req, res) => {
  const { yearMonth } = req.params;
  const filePath = path.join(__dirname, 'static', 'reports', `${yearMonth}.csv`);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).send('File not found');
  }
});

app.get('/reports/list', (req, res) => {
  const dir = path.join(__dirname, 'static', 'reports');
  if (!fs.existsSync(dir)) return res.json([]);

  const files = fs.readdirSync(dir);
  const months = files
    .filter(f => f.endsWith('.csv'))
    .map(f => f.replace('.csv', '')); // e.g., ["2025-06", "2025-07"]

  res.json(months.sort().reverse()); // Latest first
}); 

// Route to serve the index page after successful login
app.get('/index', (req, res) => {
  res.sendFile(path.join(__dirname, 'templates', 'index.html'));
});

// Route to logout
app.post('/logout', (req, res) => {
  res.clearCookie('username'); 
  res.json({ success: true });
});

// Helper to read/write users
function readUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Register route
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  // Added validation - must have at least one character each
  if (!username || !password || username.length < 1 || password.length < 1) {
    return res.status(400).json({ message: 'Username and password must not be empty.' });
  }
  const users = readUsers();

  if (users[username]) {
    return res.status(400).json({ message: 'User already exists' });
  }

  const hashed = await bcrypt.hash(password, 10);
  users[username] = { password: hashed };
  writeUsers(users);

  res.json({ message: 'User registered' });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users[username];

  if (!user) return res.status(401).json({ success: false, message: 'Invalid login' });

  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ success: false, message: 'Invalid login' });

  res.cookie('username', username, { httpOnly: true });
  res.json({ success: true, message: 'Login successful', redirectUrl: '/index' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port: ${PORT}`);
});
