import { db } from './firebase-config.js';
import { doc, getDoc, collection, getDocs, query, where, orderBy} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

// --- PREVIEW MODE  ---
// Returns true if the site is sitting inside an <iframe> (like your Admin Dashboard)
const isPreviewMode = window.self !== window.top;
if (isPreviewMode) {
    console.log("Admin Preview Mode Active: Loading Draft Data...");
}

// --- 1. SYNC FOOTER YEAR ---
// Fetches a single document that contains the current year for the footer. 
async function syncFooterYear() {
    try {
        // Point specifically to the "footer_year_info" document inside the "global_config" 
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
// Iterates through the video_content collection and pairs database URLS with the matching HTML iframes
async function loadAllVideos() {
    try {
        console.log("Attempting to fetch videos from 'video_content'...");
        const querySnapshot = await getDocs(collection(db, "video_content"));
        
        querySnapshot.forEach((doc) => {
            // Looks for an HTML ID that matches the database document ID
            const videoElement = document.getElementById(doc.id);
            
            if (videoElement) {
                const data = doc.data();
                const urlToShow = isPreviewMode ? (data.draft_url || data.live_url) : data.live_url;

                if (urlToShow) {
                    let finalUrl = urlToShow;
                    
                    // Formats youtube links to embed mode if they arent already in that format
                    // if the link is not a youtube link (echo260) it skips and just uses the URL as is.
                    if (finalUrl.includes("youtube.com/watch?v=")) {
                        finalUrl = finalUrl.replace("watch?v=", "embed/").split("&")[0];
                    } else if (finalUrl.includes("youtu.be/")) {
                        finalUrl = finalUrl.replace("youtu.be/", "youtube.com/embed/").split("?")[0];
                    }
                    // assigns the final URL to the iframe src, which will load the video
                    videoElement.src = finalUrl;
                }
            }
        });
    } catch (error) {
        console.error("Video Load Error:", error);
    }
}

// --- 3. Section Adder -- 
// an object responsible for fetching content sections from firebase and building the html layout
const SectionRenderer = {
    // queries the database for sections that belong on the current page
    async loadSections(pageName) {
        const container = document.getElementById('dynamic-sections-container');
        if (!container) {
            console.error("Could not find the container div in HTML!");
            return;
        }

        try {
            //build a query asking firebase for all documents where the targetpage matches the current URL
            const q = query(
                collection(db, "page_sections"),
                where("target_page", "==", pageName),
                orderBy("createdAt", "asc")
            );

            const querySnapshot = await getDocs(q);
            console.log(`Found ${querySnapshot.size} sections for ${pageName}`); // Add this!
            
            querySnapshot.forEach((doc) => {
                console.log("Rendering section:", doc.id); 
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
    // This function takes in the data for a section and returns a formatted HTML string. 
    //It includes logic for handling missing data, image alignment, video formatting, and button linking based on the section's target page.
    createSectionTemplate(data) {
        console.log("Checking section data for button:", data.title, "| has_subpage:", data.has_subpage);
        // Safety check for missing fields
        const title = data.title || "Untitled Section";
        const body = data.body_text || "";
        const img = data.image_url || "";
        const sectionId = data.slug || "section";

        // Logic for image ordering
        const alignment = data.image_alignment || "left"; // Default to left if missing
        const imgOrderClass = alignment === "right" ? "order-md-2" : "order-md-1";
        const textOrderClass = alignment === "right" ? "order-md-1" : "order-md-2";

        // Video Formatting Logic
        let videoHtml = "";
        if (data.video_url) {
            let finalVidUrl = data.video_url;
            
            // Auto-convert standard YouTube links to Embed links
            if (finalVidUrl.includes("youtube.com/watch?v=")) {
                finalVidUrl = finalVidUrl.replace("watch?v=", "embed/");
                // Strip out any extra playlist parameters that might break the embed
                finalVidUrl = finalVidUrl.split("&")[0]; 
            } else if (finalVidUrl.includes("youtu.be/")) {
                finalVidUrl = finalVidUrl.replace("youtu.be/", "youtube.com/embed/");
                finalVidUrl = finalVidUrl.split("?")[0];
            }

            // Creates the responsive, centered video iframe
            videoHtml = `
                <div class="ratio ratio-16x9 my-4 mx-auto shadow-sm rounded overflow-hidden" style="max-width: 100%;">
                    <iframe src="${finalVidUrl}" title="Video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
            `;
        }

        // PDF Formatting Logic
        let pdfHtml = "";
        if (data.pdf_url) {
            pdfHtml = `
                <div class="mt-4 mb-3 w-100">
                    <object data="${data.pdf_url}" type="application/pdf" width="100%" height="600px" class="border rounded shadow-sm">
                        <p class="text-muted p-3">Your browser does not support viewing PDFs directly. <br>
                        <a href="${data.pdf_url}" target="_blank" class="fw-bold">Download the document here.</a></p>
                    </object>
                    <div class="mt-3 text-center">
                        <a href="${data.pdf_url}" target="_blank" class="btn btn-secondary px-5 shadow-sm">
                            <i class="bi bi-box-arrow-up-right"></i> Open PDF in Full Screen
                        </a>
                    </div>
                </div>
            `;
        }

        // Identify the base name (e.g., 'research' or 'teaching')
        let pageBase = data.target_page.replace('.html', ''); 
        // Explicitly handle the 'teachings' vs 'teaching' mismatch
        if (pageBase === "teachings") {
            pageBase = "teaching";
        }
        // Determine current location to set the correct relative path
        const currentPath = window.location.pathname;
        const isInMenuFolder = currentPath.includes('/menu/');
        const isSubpage = currentPath.includes('-subpages');
        
        let buttonLink = "";

        if (isSubpage) {
            // We are already in a subpage, just link to siblings
            buttonLink = `./details.html?id=${data.slug}`;
        } else if (isInMenuFolder) {
            // We are in 'menu/', go UP then DOWN to sibling folder
            buttonLink = `../${pageBase}-subpages/details.html?id=${data.slug}`;
        } else {
            // We are at root, go DOWN into the subpage folder
            buttonLink = `./${pageBase}-subpages/details.html?id=${data.slug}`;
        }
        return `
        <section id="${sectionId}" class="py-5 container border-bottom">
            <div class="container">
                <div class="row align-items-center">
                    ${img ? `
                        <div class="col-md-5 mb-3 mb-md-0 ${imgOrderClass}">
                            <img src="${img}" class="img-fluid rounded shadow-sm w-100" alt="${title}">
                        </div>
                    ` : ''}
                    
                    <div class="${img ? 'col-md-7' : 'col-12'} ${textOrderClass}">
                        <h2 class="fw-light mb-3">${title}</h2>
                        <p class="lead text-muted">${body}</p>

                        ${videoHtml}

                        ${pdfHtml}

                        ${data.has_subpage ? `
                            <div class="d-grid gap-2 d-md-flex justify-content-md-start mt-4">
                                <a href="${buttonLink}" class="btn btn-outline-secondary btn-lg px-4">
                                    Learn More
                                </a>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </section>
    `;
    }
};

// -- NAVIGATION Menu Bar SYNCING ---
// Responsible for fetching the section titles and slugs for each main page and injecting them into the corresponding dropdown menu in the nav bar.
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
// This function detects the current page, decides what content to load, and ensures that the nav bars are synced on every page. 
//It also includes logging to help trace the flow of execution and identify any issues.
const init = () => {
    console.log("DOM fully loaded. Starting Firebase logic...");

    // Detect current filename
    let page = window.location.pathname.split("/").pop() || "index.html";
    if (page === "index" || page === "") page = "index.html";

    console.log("Current Page identified as:", page);

    // THE ROUTER: Decide what to render
    if (page === "details.html") {
        console.log("Detail Page detected. Loading project details...");
        DetailRenderer.loadProjectDetails();
    } else {
        console.log("Standard Page detected. Loading dynamic sections...");
        SectionRenderer.loadSections(page);
    }

  
    // Sync the Nav Bar dropdowns on every page
    NavManager.syncDropdown('research.html', 'nav-research-dropdown');
    NavManager.syncDropdown('teachings.html', 'nav-teachings-dropdown');
    NavManager.syncDropdown('service.html', 'nav-service-dropdown');

    loadAllVideos();
    syncFooterYear();
    loadLiveCV();

    // LOGGING: Only check for the container if we AREN'T on a details page
    if (page !== "details.html") {
        const testContainer = document.getElementById('dynamic-sections-container');
        if (testContainer) {
            console.log("Container found! Injecting content...");
        } else {
            console.warn("Container 'dynamic-sections-container' not found on this page.");
        }
    }
};
// --- DETAIL PAGE RENDERER ---
// Responsible for loading the main project details and then invoking the SectionRenderer to load the child sections.
//It also handles the loading state and error handling for the details page.
const DetailRenderer = {
    async loadProjectDetails() {
        const contentDiv = document.getElementById('detail-content');
        const loader = document.getElementById('detail-loading');
        if (!contentDiv) return;

        const params = new URLSearchParams(window.location.search);
        const projectSlug = params.get('id');

        try {
            // 1. Load the main details if it's a dynamic page
            const q = query(collection(db, "page_sections"), where("slug", "==", projectSlug));
            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                const data = querySnapshot.docs[0].data();
                // We only set the title. We skip the image and body text entirely!
                document.getElementById('detail-header-title').innerText = data.title;
            }

            // 2. Add the "Parking Spot" for the new sections
            let sectionContainer = document.getElementById('dynamic-sections-container');
            if (!sectionContainer) {
                sectionContainer = document.createElement('div');
                sectionContainer.id = 'dynamic-sections-container';
                contentDiv.appendChild(sectionContainer); 
            }

            // 3. Load the child sections
            SectionRenderer.loadSections(projectSlug);

            loader.classList.add('d-none');
            contentDiv.classList.remove('d-none');

        } catch (e) {
            console.error("Detail Load Error:", e);
        }
    }
};

// --- LOAD CV PDF ---
async function loadLiveCV() {
    const cvObject = document.getElementById('live-cv-object');
    const cvDownload = document.getElementById('live-cv-download');
    
    // Guard: Only run if we are actually on the CV page
    if (!cvObject) return;

    try {
        const docRef = doc(db, "global_config", "cv_data");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().pdf_url) {
            const pdfUrl = docSnap.data().pdf_url;
            
            // Inject the Firebase URL into the <object> and the <a> tag
            cvObject.data = pdfUrl;
            if (cvDownload) cvDownload.href = pdfUrl;
        } else {
            console.log("No live CV found in the database.");
        }
    } catch (error) {
        console.error("Failed to load CV:", error);
    }
}

// Add this inside your existing init() function in main.js:
// loadLiveCV();


// Listen for the page to be ready
window.addEventListener('DOMContentLoaded', init);

loadAllVideos();
syncFooterYear();