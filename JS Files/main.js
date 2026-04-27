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
        const title = data.title || "";
        const rawBody = data.body_text || "";
        const sectionId = data.slug || "section";
        const images = data.carousel_images || [];
        // Extract the custom text (with a fallback for older sections)
        const btnText = data.button_text || "Learn More";

        let formattedBody = rawBody;

        // Convert bullet points: Finds lines starting with "- " or "* " and turns them into <li> tags
        formattedBody = formattedBody.replace(/(?:^|\n)(?:-|\*)\s+(.*)/g, '\n<li>$1</li>');

        // Wrap consecutive <li> tags in an indented <ul> wrapper
        formattedBody = formattedBody.replace(/(?:\n<li>.*?<\/li>)+/g, function(match) {
            return '\n<ul class="ms-4 mb-3 mt-2">' + match + '\n</ul>';
        });

        // Convert all remaining normal newlines to <br> (Standard paragraph spacing)
        formattedBody = formattedBody.replace(/\n/g, '<br>');

        // Cleanup: Remove awkward <br> tags that get generated directly inside the lists
        formattedBody = formattedBody.replace(/<br><ul/g, '<ul');
        formattedBody = formattedBody.replace(/<\/ul><br>/g, '</ul>');
        formattedBody = formattedBody.replace(/<br><li>/g, '<li>');
        formattedBody = formattedBody.replace(/<\/li><br>/g, '</li>');

        // Hunts for **text** and turns it into Bootstrap-styled bold text
        formattedBody = formattedBody.replace(/\*\*(.*?)\*\*/g, '<strong class="fw-bold">$1</strong>');

        // The Hyperlink Formatter
        formattedBody = formattedBody.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" class="text-primary text-decoration-underline fw-bold">$1</a>');

        // Logic to decide layout
        const isCarousel = images.length > 1;
        const hasSingleImg = images.length === 1;
        // Logic for image ordering
        const alignment = data.image_alignment || "left"; // Default to left if missing
        const imgOrderClass = alignment === "right" ? "order-md-2" : "order-md-1";
        const textOrderClass = alignment === "right" ? "order-md-1" : "order-md-2";
   
        const titleAlignClass = data.title_alignment || "text-start";
        const bodyAlignClass = data.body_alignment || "text-start";


        // Build the Single Image HTML
        let singleImageHtml = "";
        if (hasSingleImg) {
            singleImageHtml = `
                <div class="col-md-5 mb-4 mb-md-0 ${imgOrderClass}">
                    <img src="${images[0]}" class="d-block mx-auto img-fluid rounded" alt="${title}">
                </div>
            `;
        }

        // Build the Carousel HTML (Full Width)
        let carouselHtml = "";
        if (isCarousel) {
            let indicators = "";
            let slides = "";
            images.forEach((imgUrl, index) => {
                const isActive = index === 0 ? "active" : "";
                indicators += `<button type="button" data-bs-target="#carousel-${sectionId}" data-bs-slide-to="${index}" class="${isActive} bg-dark" style="width: 30px; height: 5px;"></button>`;
                
                slides += `
                    <div class="carousel-item ${isActive}">
                        <img src="${imgUrl}" class="d-block w-100 rounded shadow-sm object-fit-contain" style="max-height: 600px; background-color: #f8f9fa;" alt="Slide ${index}">
                    </div>
                `;
            });

            carouselHtml = `
                <div class="row mt-4">
                    <div class="col-12">
                        <div id="carousel-${sectionId}" class="carousel slide" data-bs-ride="carousel">
                            <div class="carousel-indicators">${indicators}</div>
                            <div class="carousel-inner rounded">${slides}</div>
                            <button class="carousel-control-prev" type="button" data-bs-target="#carousel-${sectionId}" data-bs-slide="prev">
                                <span class="carousel-control-prev-icon bg-dark rounded-circle p-2" aria-hidden="true" style="width: 45px; height: 45px; background-size: 60%;"></span>
                            </button>
                            <button class="carousel-control-next" type="button" data-bs-target="#carousel-${sectionId}" data-bs-slide="next" >
                                <span class="carousel-control-next-icon bg-dark rounded-circle p-2" aria-hidden="true" style="width: 45px; height: 45px; background-size: 60%;"></span>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

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
                <div class="ratio ratio-16x9 my-4 mx-auto shadow-sm rounded overflow-hidden" style="max-width: 760px">
                    <iframe src="${finalVidUrl}" title="Video player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                </div>
            `;
        }

        // PDF Formatting Logic
        let pdfHtml = "";
        if (data.pdf_url) {
            pdfHtml = `
                <div class="mt-1 mb-4 w-100">
                    <object data="${data.pdf_url}" type="application/pdf" width="100%" style="height: 80vh; min-height: 600px;" class="border rounded shadow-sm">
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

        // Table Formatting Logic
        let tableHtml = "";
        if (data.table_data && data.table_data.length > 0) {
            
            tableHtml += `<div class="d-flex flex-wrap justify-content-center table-responsive medium mt-4">
                            <table class="table table-striped table-sm table-responsive align-right">`;
            
            // Loop through our array of row objects
            data.table_data.forEach((rowData, rowIndex) => {
                tableHtml += `<tr>`;
                
                // Look inside the '.cells' wrapper to get the actual data array
                rowData.cells.forEach(cell => {
                    if (rowIndex === 0) {
                        tableHtml += `<th>${cell}</th>`; 
                    } else {
                        tableHtml += `<td>${cell}</td>`; 
                    }
                });
                
                tableHtml += `</tr>`;
            });
            tableHtml += `</table></div>`;
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

        const hasMiddleContent = singleImageHtml || (titleAlignClass !== 'text-center' && title) || formattedBody || tableHtml || videoHtml || data.has_subpage;

        return `
        <section id="${sectionId}" class="container p-2">
            <div class="container">
                
                ${(titleAlignClass === 'text-center' && title) ? `
                    <div class="row mb-4">
                        <div class="col-12">
                            <h2 class="fw-light ${titleAlignClass}">${title}</h2>
                        </div>
                    </div>
                ` : ''}

                ${hasMiddleContent ? `
                    <div class="row align-items-center p-3">
                        
                        ${singleImageHtml}

                        <div class="${hasSingleImg ? 'col-md-7' : 'col-12'} ${textOrderClass}">
                            
                            ${(titleAlignClass !== 'text-center' && title) ? `
                                <h2 class="mb-3 text-start fw-light">${title}</h2>
                            ` : ''}

                            <p class="lead text-start ${bodyAlignClass}">${formattedBody}</p>
                            
                            ${tableHtml}

                            ${videoHtml}
                            
                            ${data.has_subpage ? `
                                <div class="mt-4 text-start">
                                    <a href="${buttonLink}" class="btn btn-outline-secondary px-4">${btnText}</a>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}

                ${carouselHtml}

                ${pdfHtml}
                <hr>
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
    loadProfileData();

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
                // Use the custom subpage title, or fallback to the main section title for older posts
                const headerTitle = data.subpage_title || data.title;
                // Update the text on the screen
                document.getElementById('detail-header-title').innerText = headerTitle;
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

// --- LOAD PROFILE DATA ---
//this function is responsible for loading all the flexible profile data (name, title, contact info, profile pic, background) from firebase and injecting it into the live site.
async function loadProfileData() {
    const profileNameEl = document.getElementById('live-profile-name');
    if (!profileNameEl) return;
    
    try {
        const docRef = doc(db, "global_config", "profile_data");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();

            // Inject Name
            profileNameEl.innerText = data.name || "";
            
            // Format flexible Title info (Converts line breaks to <br>)
            const titleEl = document.getElementById('live-profile-title');
            if (titleEl && data.title) {
                titleEl.innerHTML = data.title.replace(/\n/g, '<br>');
            } else if (titleEl) {
                titleEl.innerHTML = "";
            }
            
            // Format flexible contact info (Converts line breaks to <br>)
            if (data.contact_info) {
                const formattedContact = data.contact_info.replace(/\n/g, '<br>');
                document.getElementById('live-profile-contact').innerHTML = `<p>${formattedContact}</p>`;
            }

            // Inject Images
            if (data.profile_pic_url) {
                document.getElementById('live-profile-pic').src = data.profile_pic_url;
            }
            if (data.background_url) {
                document.getElementById('profile-background-section').style.backgroundImage = `url('${data.background_url}')`;
            }
        }
    } catch (error) {
        console.error("Failed to load profile data:", error);
    }
}


// Listen for the page to be ready
window.addEventListener('DOMContentLoaded', init);

loadAllVideos();
syncFooterYear();