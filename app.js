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

// July 16, 2025 at 6:00PM EDT (22:00 UTC)
const START_TIMESTAMP = Date.UTC(2025, 6, 16, 22, 0, 0) / 1000; // 1752703200

async function getLiveVehicleCount(token) {
  const now = Math.floor(Date.now() / 1000);  
  const manualBaseline = loadManualBaseline(); // always read fresh

  const baselineTimestamp = manualBaseline?.timestamp || START_TIMESTAMP;
  const baseCount = manualBaseline?.count || 16;

  const url = `https://api.verkada.com/cameras/v1/analytics/occupancy_trends?camera_id=${CAMERA_ID}&start_time=${baselineTimestamp}&end_time=${now}&interval=1_hour&type=vehicle&preset_id=e3bf81d8-a1a8-4822-8bfa-1e56bc38af65`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-verkada-auth': token
    }
  });

  const data = await response.json();

  const totalIn = data.trend_in.reduce((sum, [start, end, count]) => sum + count, 0);
  const totalOut = data.trend_out.reduce((sum, [start, end, count]) => sum + count, 0);

  return baseCount + (totalIn - totalOut);
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

  const url = `https://api.verkada.com/cameras/v1/analytics/dashboard_occupancy_trends?dashboard_id=163fd2d5-f996-42ce-b0f9-85065e9ad7f4&start_time=${startTime}&end_time=${endTime}&interval=1_hour`;

  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'x-verkada-auth': token
    }
  });

  const data = await response.json();
  if (!data.trend_in || !data.trend_out) return [];

  const hourlyChanges = new Map();
  for (const [start, , count] of data.trend_in) {
    hourlyChanges.set(start, (hourlyChanges.get(start) || 0) + count);
  }
  for (const [start, , count] of data.trend_out) {
    hourlyChanges.set(start, (hourlyChanges.get(start) || 0) - count);
  }

  let runningTotal = 0;
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
  console.log(`✅ Report generated for ${label}`);
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

// Helper to generate the previous month's CSV at midnight on the 1st of each month 
scheduleJob('0 0 1 * *', async () => {
  const token = await getToken();
  const peakData = await findDailyPeakCounts(token);
  const csv = convertToCSV(peakData);

  const monthLabel = getPreviousMonthYear(); // e.g. "2025-06"
  const filePath = path.join(__dirname, 'reports', `${monthLabel}.csv`);

  fs.writeFileSync(filePath, csv);
  console.log(`Saved monthly report for ${monthLabel}`);
});

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

// Helper function for successful login
function loginSuccess(userFound, userIdTemp, res) {
  // Create JWT token
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };
  const payload = {
    sub: userIdTemp,  // subject, usually the user ID
    iat: Math.floor(Date.now() / 1000), // issued at timestamp
  };
  const token = createJWT(header, payload);

  // Set cookies with JWT token
  res.cookie('token', token, { httpOnly: true, maxAge: 3600000, sameSite: 'none', secure: true });

  return res.json({
    success: true,
    message: 'Login successful',
    redirectUrl: '/index',
  });
}

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
  console.log('written')
}

// Register route
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
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
  
// Manually generate the previous month's report at startup (for development/testing)
(async () => {
  try {
    const token = await getToken();
    const peakData = await findDailyPeakCounts(token);
    const csv = convertToCSV(peakData);

    const now = new Date();
    now.setMonth(now.getMonth() - 1); // previous month
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const label = `${year}-${month}`; // e.g. "2025-06"

    const filePath = path.join(__dirname, 'static', 'reports', `${label}.csv`);
    fs.writeFileSync(filePath, csv);
    console.log(`✅ Manually generated monthly report for ${label}`);
  } catch (err) {
    console.error('❌ Failed to generate manual report on startup:', err);
  }
})();

generateMonthlyReport(2025, 6); // Run before app.listen()


// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port: ${PORT}`);
});