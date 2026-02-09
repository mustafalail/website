import { db } from './firebase-config.js';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

async function syncFooterYear() {
    try {
        // ID must matches Firebase console exactly
        const docRef = doc(db, "global_config", "footer_year_info");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const cloudYear = docSnap.data().copyright_year;
            
            // This updates the CSS year variable
            document.documentElement.style.setProperty('--current-year', `"${cloudYear}"`);
            
            console.log("Footer year synced from cloud:", cloudYear);
        } else {
            console.log("No such document found in Firebase!");
        }
    } catch (error) {
        console.error("Error fetching document:", error);
    }
}

syncFooterYear();