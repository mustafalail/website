import { auth } from './firebase-config.js';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";


const loginBtn = document.getElementById('login-btn');
const forgotPasswordBtn = document.getElementById('forgot-password-link'); // Ensure this ID matches your HTML!

//this function is for the login button
loginBtn.addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
        // On success, send them to the admin dashboard
        window.location.href = "admin.html"; 
    } catch (error) {
        alert("Invalid credentials. Please try again.");
        console.error("Login Error:", error.code);
    }
});

//This function handles the "Forgot Password" link click event
if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener('click', async (e) => {
        e.preventDefault(); // Stops the page from jumping/refreshing
        
        // Grab the email from your existing login form
        const emailAddress = document.getElementById('email').value.trim();

        // Validate that they actually typed an email
        if (!emailAddress) {
            alert("Please type your admin email address into the Email box first, then click 'Forgot Password?'.");
            return;
        }

        // Trigger Firebase's secure reset protocol
        try {
            forgotPasswordBtn.innerText = "Sending email...";
            
            // We use the 'auth' you already imported at the top!
            await sendPasswordResetEmail(auth, emailAddress);
            
            alert(`A password reset link has been sent to ${emailAddress}. Please check your inbox and spam folder.`);
            
        } catch (error) {
            console.error("Password reset error:", error);
            
            // Make the error messages user-friendly
            if (error.code === 'auth/user-not-found') {
                alert("That email is not registered as an admin.");
            } else if (error.code === 'auth/invalid-email') {
                alert("Please enter a valid email address.");
            } else {
                alert("Error sending reset email. Please try again.");
            }
        } finally {
            // Reset the link text when done
            forgotPasswordBtn.innerText = "Forgot Password?";
        }
    });
}