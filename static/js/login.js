document.addEventListener("DOMContentLoaded", function() {
    document.getElementById("loginButton").addEventListener("click", async function (e) {
        e.preventDefault(); // Prevent the form from submitting
  
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;
  
        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });
  
            const result = await response.json();
  
            if (result.success) {
              console.log("Success");
                // Redirect to index page if login is successful
                window.location.href = result.redirectUrl || '/index';  // Redirect to '/index' page
            } else {
                alert(result.message || "Login failed");
            }
        } catch (error) {
            console.error('Error:', error);
            alert("An error occurred. Please try again.");
        }
    });

    // Register button handler
  document.getElementById("registerButton").addEventListener("click", async function (e) {
        e.preventDefault();

        const username = document.getElementById("register-username").value;
        const password = document.getElementById("register-password").value;

        try {
        const response = await fetch("/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        const result = await response.json();
        alert(result.message || "Registration complete");
        } catch (error) {
        console.error("Error:", error);
        alert("An error occurred during registration.");
        }
    });
});

  