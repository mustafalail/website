import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, orderBy} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
// --- PREVIEW MODE DETECTION ---
// Returns true if the site is sitting inside an <iframe> (like your Admin Dashboard)
const isPreviewMode = window.self !== window.top;
if (isPreviewMode) {
    console.log("Admin Preview Mode Active: Loading Draft Data...");
}

// --- 1. SYNC FOOTER YEAR ---
async function syncFooterYear() {
    try {
        // ID must matches Firebase console exactly
        const docRef = doc(db, "global_config", "footer_year_info");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // DECISION POINT: Use draft_year if in preview mode, otherwise use copyright_year
            const yearToShow = isPreviewMode ? (data.draft_year || data.copyright_year) : data.copyright_year;
            
            // This updates the CSS year variable
            document.documentElement.style.setProperty('--current-year', `"${yearToShow}"`);
            
            console.log("Footer year synced from cloud:", yearToShow);
        } 
    } catch (error) {
        console.error("Error fetching document:", error);
    }
}
// --- 2. LOAD ALL VIDEOS ---
async function loadAllVideos() {
    try {
        console.log("Attempting to fetch videos from 'video_content'...");
        const querySnapshot = await getDocs(collection(db, "video_content"));
        
        querySnapshot.forEach((doc) => {
            const videoElement = document.getElementById(doc.id);
            
            if (videoElement) {
                const data = doc.data();

                // DECISION POINT: Use draft_url if in preview mode, otherwise use live_url
                const urlToShow = isPreviewMode ? (data.draft_url || data.live_url) : data.live_url;

                if (urlToShow) {
                    // Extract ID using regex
                    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
                    const match = urlToShow.match(regExp);
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

// --- 3. Section Adder -- 
const SectionRenderer = {
    async loadSections(pageName) {
        const container = document.getElementById('dynamic-sections-container');
        if (!container) {
            console.error("Could not find the container div in HTML!");
            return;
        }

        try {
            const q = query(
                collection(db, "page_sections"),
                where("target_page", "==", pageName),
                orderBy("createdAt", "asc")
            );

            const querySnapshot = await getDocs(q);
            console.log(`Found ${querySnapshot.size} sections for ${pageName}`); // Add this!
            
            querySnapshot.forEach((doc) => {
                console.log("Rendering section:", doc.id); // Add this!
                const data = doc.data();
                const sectionHtml = this.createSectionTemplate(data);
                container.innerHTML += sectionHtml;
            });
        } catch (e) {
            console.error("Firestore Load Error:", e);
        }
    },

    createSectionTemplate(data) {
        return `
            <section class="py-5 border-bottom">
                <div class="container">
                    <div class="row align-items-center">
                        ${data.image_url ? `
                            <div class="col-md-5 mb-3 mb-md-0">
                                <img src="${data.image_url}" class="img-fluid rounded shadow-sm" alt="${data.title}">
                            </div>
                        ` : ''}
                        <div class="${data.image_url ? 'col-md-7' : 'col-12'}">
                            <h2 class="fw-bold mb-3">${data.title}</h2>
                            <p class="lead text-muted">${data.body_text}</p>
                            ${data.has_subpage ? `
                                <a href="subpage-template.html?id=${data.slug}" class="btn btn-outline-primary">
                                    Learn More <i class="bi bi-arrow-right"></i>
                                </a>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
};
// Wrap everything in a listener to ensure the HTML is fully loaded first
document.addEventListener('DOMContentLoaded', () => {
    // Detect current filename
    let currentPage = window.location.pathname.split("/").pop();
    if (!currentPage || currentPage === "index" || currentPage === "") {
        currentPage = "index.html";
    }

    console.log("Page Ready. Loading sections for:", currentPage);

    // Start the processes
    SectionRenderer.loadSections(currentPage);
    loadAllVideos();
    syncFooterYear();
});

/// Detect current filename (e.g., "index.html" or "research.html")
const currentPage = window.location.pathname.split("/").pop() || "index.html";
console.log("📍 Site is trying to load sections for:", currentPage); // Add this!
// Start the process for the current page
SectionRenderer.loadSections(currentPage);


loadAllVideos();
syncFooterYear();