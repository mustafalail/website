import { db, auth } from './firebase-config.js';
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

// Check if user is authenticated on page load
onAuthStateChanged(auth, (user) => {
    //Checks what page the user is currently looking at
    const isLoginPage = window.location.pathname.includes("login.html");

    if (!user) {
        // Only redirects to login if the user isn't already there
        if (!isLoginPage) {
            console.log("Not logged in. Redirecting to login page...");
            window.location.href = "login.html";
        }
    }
    else {
        // If the user is logged in but try to visit login.html, send them to the dashboard
        if (isLoginPage) {
            window.location.href = "admin.html";
        } else {
            // Otherwise, load the protected data
            loadCurrentSettings();
        }
    }
});
// --- LOAD FUNCTION: Loads current year ---
async function loadCurrentSettings() {
    const yearInput = document.getElementById('year-input');
    const footerRef = doc(db, "global_config", "footer_year_info");

    try {
        const docSnap = await getDoc(footerRef);
        if (docSnap.exists()) {
            // This line puts the cloud data directly into the input box
            yearInput.value = docSnap.data().copyright_year;
            console.log("Current settings loaded from cloud.");
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

const saveBtn = document.getElementById('save-settings');

saveBtn.addEventListener('click', async () => {
    const newYear = document.getElementById('year-input').value;
    const footer_year_infoRef = doc(db, "global_config", "footer_year_info");

    try{
        await updateDoc(footer_year_infoRef, {
            copyright_year: newYear
        });
        alert("Copyright year updated successfully!");
    }
    catch (error) {
        console.error("Error updating document: ", error);
        alert("Failed to update copyright year. Please try again.");
    }
});

//Sign out functionality
const logoutBtn = document.getElementById('logout-btn');
logoutBtn.addEventListener('click', async () => {
    try {
        await signOut(auth);
        console.log("User signed out successfully.");

    } catch (error) {
        console.error("Logout Error:", error);
    }
});
