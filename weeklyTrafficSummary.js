import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';

const EMAIL_USER = 't0773314@gmail.com';
const EMAIL_PASS = 'wmxb uugm zjze trme';
const RECIPIENTS = ['9389829@gmail.com', 'alphonso.westley@kiscosl.com', 'ftz.reception@kiscosl.com'];

const timeZone = 'America/New_York';

// === CONFIGURATION ===
const API_KEY = 'MmFkNTU0ZmUtZTE2NS00NjJjLWJjZjYtNzM0YmE5MGMwODc4fDVkZTNkMGU5LWI2YzMtNDk3OS1iOTgzLWYxMTU1MTgzODg3ZQ==';
const DASHBOARD_ID = '163fd2d5-f996-42ce-b0f9-85065e9ad7f4';

// === BASELINE CONFIGURATION ===
// July 16, 2025 at 6:00PM EDT (22:00 UTC)
const BASELINE_TIMESTAMP = Date.UTC(2025, 6, 16, 22, 0, 0) / 1000;
const BASELINE_COUNT = 16;

// === HELPER FUNCTIONS ===
function getFirstOfMonthTimestamp() {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return Math.floor(firstOfMonth.getTime() / 1000);
}

function formatDate(timestamp) {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function formatTimeOfDay(timestamp) {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function convertToCSV(data) {
  const notice = 'The maximum occupancy is 57 cars.';
  const header = 'Date,Peak Count,Time of Peak';
  const rows = data.map(row => `${row.date},${row.peakCount},${row.peakTime}`);
  return [notice, header, ...rows].join('\n');
}

async function getVerkadaToken() {
  const response = await fetch('https://api.verkada.com/token', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'x-api-key': API_KEY
    }
  });
  if (!response.ok) throw new Error(`Token fetch failed: ${response.status}`);
  const data = await response.json();
  return data.token;
}

async function findDailyPeakCounts(token) {
  const startTime = BASELINE_TIMESTAMP();
  const url = `https://api.verkada.com/cameras/v1/analytics/dashboard_occupancy_trends?dashboard_id=${DASHBOARD_ID}&start_time=${startTime}&interval=1_hour`;

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

  let runningTotal = 16;
  const dailyMaxMap = {};
  const sorted = [...hourlyChanges.keys()].sort((a, b) => a - b);
  for (const timestamp of sorted) {
    runningTotal += hourlyChanges.get(timestamp);
    const date = formatDate(timestamp);
    if (!dailyMaxMap[date] || runningTotal > dailyMaxMap[date].count) {
      dailyMaxMap[date] = { count: runningTotal, time: formatTimeOfDay(timestamp) };
    }
  }

  return Object.entries(dailyMaxMap).map(([date, { count, time }]) => ({
    date,
    peakCount: count,
    peakTime: time
  }));
}

async function sendEmailWithCSV(summaryText, csvContent) {
  const filePath = path.join('./', 'monthly-peak-traffic.csv');
  fs.writeFileSync(filePath, csvContent);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
  });

  const mailOptions = {
    from: EMAIL_USER,
    to: RECIPIENTS.join(','),
    subject: 'Monthly Vehicle Activity Summary',
    text: summaryText,
    attachments: [{ filename: 'peak-traffic.csv', path: filePath }]
  };

  await transporter.sendMail(mailOptions);
  fs.unlinkSync(filePath);
  console.log('Email sent successfully');
}

async function main() {
  try {
    const token = await getVerkadaToken();
    const peakData = await findDailyPeakCounts(token);
    const csv = convertToCSV(peakData);
    const summary = `Hi all,\n\nAttached is the peak vehicle traffic data for the past month.\n\nBest,\nThe Staff at Fitzgerald of Palisades`;

    await sendEmailWithCSV(summary, csv);
  } catch (error) {
    console.error('Error sending monthly report:', error);
  }
}

import schedule from 'node-schedule';
import moment from 'moment-timezone';

// Schedule to run at 8:00 AM EST on the 1st of each month
schedule.scheduleJob('0 8 1 * *', async () => {
  const now = moment().tz('America/New_York');
  if (now.hour() === 8) {
    console.log(`Running monthly report at ${now.format()}`);
    await main();
  }
});
