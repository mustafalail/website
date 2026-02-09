
  // Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";
// NEW: Import the Firestore database tool
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyD1bLdkuYRQuCrG5Fpk_qlmXQA7Z964Bc0",
    authDomain: "portfolio-backend-0791.firebaseapp.com",
    projectId: "portfolio-backend-0791",
    storageBucket: "portfolio-backend-0791.firebasestorage.app",
    messagingSenderId: "46489525154",
    appId: "1:46489525154:web:f7b72869b0989bca6830fb",
    measurementId: "G-3YNGWHFF6Z"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// NEW: Initialize the database connection
const db = getFirestore(app);
// Export the app so other files can use it later
export { app, db };

console.log("Firebase connection initialized successfully!");