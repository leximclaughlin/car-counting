// Get the Log Out button
const logoutButton = document.getElementById('logout_button');

logoutButton.addEventListener('click', async () => {
  try {
    // Make a POST request to the /logout route
    const response = await fetch('/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (data.success) {
      window.location.href = '/'; 
    } else {
      alert('Log out failed. Please try again.');
    }
  } catch (error) {
    console.error('Error logging out:', error);
    alert('An error occurred while logging out.');
  }
});