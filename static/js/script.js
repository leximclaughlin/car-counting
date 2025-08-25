document.addEventListener("DOMContentLoaded", () => {
    const carCount = document.getElementById("carCount");
    const spotsAvailable = document.getElementById("spotsAvailable");
    const newCountInput = document.getElementById("newCount");
    const updateBtn = document.getElementById("updateBtn");
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const TOTAL_SPOTS = 55;
   
    updateBtn.addEventListener("click", async () => {
        const raw = parseInt(newCountInput.value, 10);
        if (!isNaN(raw) && raw >= 0) {
          const newValue = clamp(raw, 0, TOTAL_SPOTS);

          try {
            const res = await fetch('/car-count', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ newCount: newValue })
            });
      
            if (!res.ok) {
              throw new Error(`Request failed: ${res.status} ${res.statusText}`);
            }
      
            carCount.textContent = newValue;
            spotsAvailable.textContent = Math.max(TOTAL_SPOTS - newValue, 0);

            if (raw > TOTAL_SPOTS) {
              alert(`Max is ${TOTAL_SPOTS}. I've set it to ${TOTAL_SPOTS}.`);
            }
            
            newCountInput.value = "";
            alert("Car count updated and saved!");
          } catch (err) {
            console.error("Error updating live count:", err);
            alert("Failed to save the count. Please try again.");
          }
        } else {
          alert("Please enter a valid number.");
        }
    });      
  
    // Fetch live car count
    const getCarCount = async () => {
      try {
        const res = await fetch('/car-count');
  
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status} ${res.statusText}`);
        }
  
        const data = await res.json();
        if (data.liveCount !== undefined) {
          carCount.textContent = data.liveCount;

          const available = TOTAL_SPOTS - data.liveCount;
          spotsAvailable.textContent = available >= 0 ? available : 0;
        } else {
          console.error("No liveCount returned:", data);
        }

      } catch (err) {
        console.error("Error fetching live car count:", err);
      }
    };
  
    // Refresh every minute
    getCarCount();
    setInterval(getCarCount, 60000);

    // --- Monthly Report Dropdown Logic ---
    async function loadAvailableReports() {
      try {
        const res = await fetch('/reports/list');
        const months = await res.json();

        console.log('Months received:', months);

        const select = document.getElementById('reportMonth');
        if (!months.length) {
          select.innerHTML = '<option disabled>No reports available</option>';
          return;
        }

        select.innerHTML = '';
        months.forEach(month => {
          const [year, monthNum] = month.split('-');
          const date = new Date(Number(year), Number(monthNum) - 1); // month is 0-indexed
          const label = date.toLocaleString('default', { month: 'long', year: 'numeric' });
          const option = document.createElement('option');
          option.value = month;
          option.textContent = label;
          select.appendChild(option);
        });

      } catch (err) {
        console.error('Error loading reports:', err);
      }
    }

    document.getElementById('downloadMonthlyReport').addEventListener('click', () => {
      const month = document.getElementById('reportMonth').value;
      if (month) {
        window.location.href = `/reports/${month}`;
      } else {
        alert("Please select a month.");
      }
    });

    loadAvailableReports(); 

});

function getFirstOfMonthTimestamp() {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    return Math.floor(firstOfMonth.getTime() / 1000);
}

function formatDate(timestamp) {
    const options = { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' };
    return new Date(timestamp * 1000).toLocaleDateString('en-US', options);
}

async function downloadPeakCSV() {
  try {
    const res = await fetch('/peak-data'); 
    const peakData = await res.json();

    const csv = convertToCSV(peakData);
    downloadCSV(csv, 'monthly-peak-traffic.csv');
  } catch (err) {
    console.error('Error downloading CSV:', err);
    alert('Failed to download peak data.');
  }
}

function convertToCSV(data) {
  const header = 'Date,Peak Count,Time of Peak';
  const rows = data.map(row => `${row.date},${row.peakCount},${row.peakTime}`);
  return [header, ...rows].join('\n');
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function login() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  document.getElementById('message').textContent = data.message;
}