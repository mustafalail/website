import { auth } from '../JS Files/firebase-config.js';
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const loginBtn = document.getElementById('login-btn');

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