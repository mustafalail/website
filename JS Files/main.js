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
            
            //Manual jump logic
            // After the loop finishes drawing the sections, it checks if there is a #slug in the URL
            if (window.location.hash) {
                const targetId = window.location.hash.substring(1); // Removes the '#'
                const targetElement = document.getElementById(targetId);
                
                if (targetElement) {
                    console.log(`Found anchor, jumping to: ${targetId}`);
                    // Smooth scroll to the section
                    targetElement.scrollIntoView({ behavior: 'smooth' });
                }
            }

        } catch (e) {
            console.error("Firestore Load Error:", e);
        }
    },

    createSectionTemplate(data) {
        // Safety check for missing fields
        const title = data.title || "Untitled Section";
        const body = data.body_text || "";
        const img = data.image_url || "";
        //pull the slug to use as the unique ID for anchor linking
        const sectionId = data.slug || `section-${Math.random().toString(36).substr(2, 9)}`;
        return `
            <section id="${sectionId}" class="py-5 container border-bottom">
                <div class="container">
                    <div class="row align-items-center">
                        ${img ? `
                            <div class="col-md-5 mb-3 mb-md-0">
                                <img src="${img}" class="img-fluid rounded shadow-sm" alt="${title}">
                            </div>
                        ` : ''}
                        <div class="${img ? 'col-md-7' : 'col-12'}">
                            <h2 class="fw-bold mb-3">${title}</h2>
                            <p class="lead text-muted">${body}</p>
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
};

// -- NAVIGATION Menu Bar SYNCING ---
const NavManager = {
    async syncDropdown(targetPage, dropdownId) {
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown) return;

        try {
            const q = query(
                collection(db, "page_sections"),
                where("target_page", "==", targetPage),
                orderBy("createdAt", "asc")
            );

            const querySnapshot = await getDocs(q);
           
          // --- SIBLING PATH LOGIC ---
          const currentPath = window.location.pathname;
          const isSubpage = currentPath.includes('-subpages');
          const isInMenu = currentPath.includes('/menu/');

          let basePath = "";

          if (targetPage === 'index.html') {
              // If we are in ANY folder, go up one level to find index.html
              basePath = (isSubpage || isInMenu) ? "../index.html" : "./index.html";
          } 
          else {
              // Target is a page like research.html or teaching.html
              if (isSubpage) {
                  // We are in 'research-subpages/', need to go UP to root then DOWN to menu
                  basePath = `../menu/${targetPage}`;
              } else if (isInMenu) {
                  // We are already in 'menu/', just stay here
                  basePath = `./${targetPage}`;
              } else {
                  // We are at the root, go down into 'menu/'
                  basePath = `./menu/${targetPage}`;
              }
          }

          querySnapshot.forEach((doc) => {
              const data = doc.data();
              if (!data.slug) return;

              const li = document.createElement('li');
              li.innerHTML = `<a href="${basePath}#${data.slug}" class="dropdown-item text-wrap border-0">${data.title}</a>`;
              dropdown.appendChild(li);
          });
            
        } catch (e) {
            console.error(`Error syncing nav for ${targetPage}:`, e);
        }
    }
};


// Function to kick off the logic once the page is ready
const init = () => {
    console.log("DOM fully loaded. Starting Firebase logic...");

    // Detect current filename
    let page = window.location.pathname.split("/").pop() || "index.html";
    if (page === "index" || page === "") page = "index.html";

    console.log("Current Page identified as:", page);

    // Start the Renderers
    SectionRenderer.loadSections(page);
    // Sync the Nav Bar dropdowns on every page
    NavManager.syncDropdown('research.html', 'nav-research-dropdown');
    NavManager.syncDropdown('teachings.html', 'nav-teachings-dropdown');
    loadAllVideos();
    syncFooterYear();

    // 3. THE FORCE-TEST: Let's see if the container is reachable
    const testContainer = document.getElementById('dynamic-sections-container');
    if (testContainer) {
        console.log("Container found! Attempting injection...");
    } else {
        console.error("CONTAINER NOT FOUND! Check index.html for ID='dynamic-sections-container'");
    }
};

// Listen for the page to be ready
window.addEventListener('DOMContentLoaded', init);

loadAllVideos();
syncFooterYear();