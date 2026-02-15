import { db } from './firebase-config.js';
import { doc, getDoc , collection, getDocs } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

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

async function loadAllVideos() {
    try {
        console.log("Attempting to fetch videos from 'video_content'...");
        const querySnapshot = await getDocs(collection(db, "video_content"));
        
        querySnapshot.forEach((doc) => {
            const videoElement = document.getElementById(doc.id);
            
            if (videoElement) {
                const data = doc.data();
                const liveUrl = data.live_url;
                console.log(` Match found for ID [${doc.id}]. URL: ${liveUrl}`);

                if (liveUrl) {
                    // Extract ID using regex
                    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
                    const match = liveUrl.match(regExp);
                    const videoId = (match && match[2].length === 11) ? match[2] : null;

                    if (videoId) {
                        videoElement.src = `https://www.youtube.com/embed/${videoId}`;
                    }
                }
            }
        });
    } catch (error) {
        console.error("Video Load Error:", error);
    }
}

loadAllVideos();

syncFooterYear();