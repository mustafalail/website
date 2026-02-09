import { db } from './firebase-config.js';
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

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

// Run the load function as soon as the script starts
loadCurrentSettings();

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
