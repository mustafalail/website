import { db, auth, storage } from './firebase-config.js';
// Updated Firestore Imports (Added collection, addDoc, serverTimestamp)
import { doc, updateDoc, getDocs, collection, addDoc, serverTimestamp, query, where, setDoc, orderBy, onSnapshot, deleteDoc} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
//  Imports (These are needed for the image upload)
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";



/**
 * -- Global Security -- 
 * This remains at the top level because it controls access to the entire page.
 */
// This function is used to refresh the staging preview iframe after changes are made.
const refreshSitePreview = () => {
    const previewFrame = document.getElementById('site-preview');
    if (previewFrame) {
        console.log("Refreshing staging preview...");
        
        // Give Firebase 1 second to finish the write operation
        setTimeout(() => {
            console.log("Refreshing staging preview now.");
            previewFrame.contentWindow.location.reload();
        }, 1000);
    }
};
// Listen for auth state changes
//this is the main gatekeeper that checks if the user is logged in or not, and redirects accordingly. It also initializes the managers if the user is authenticated.
onAuthStateChanged(auth, (user) => {
    const isLoginPage = window.location.pathname.includes("login.html");
    if (!user) {
        if (!isLoginPage) window.location.href = "login.html";
    } else {
        if (isLoginPage) {
            window.location.href = "admin.html";
        } else {
            console.log("User authenticated. Initializing managers...");
            // Wrap in a try-block to prevent script death
            try {
                FooterManager.init();
                SectionManager.init();
            } catch (err) {
                console.error("Manager Initialization Error:", err);
            }
        }
    }
});

/**
 * -- Footer Year Feature --
 * Has the Draft vs. Live logic and UI status indicators
 */
const FooterManager = {
    ref: doc(db, "global_config", "footer_year_info"),
    elements: {
        input: document.getElementById('year-input'),
        preview: document.getElementById('preview-year'),
        status: document.getElementById('sync-status')
    },
    //this function loads the current year from Firestore and populates the input and preview. 
    //It also sets the status indicator based on whether the draft and live years match.
    async init() {
        try {
            const docSnap = await getDoc(this.ref);
            if (docSnap.exists()) {
                const data = docSnap.data();
                // Default to draft_year, fallback to copyright_year
                const currentDraft = data.draft_year || data.copyright_year;
                
                if (this.elements.input) this.elements.input.value = currentDraft;
                if (this.elements.preview) this.elements.preview.innerText = currentDraft;
                
                this.updateStatusUI(data.draft_year === data.copyright_year);
            }
        } catch (e) { console.error("Footer Load Error:", e); }
    },

    async saveDraft() {
        const newVal = this.elements.input.value;
        try {
            await updateDoc(this.ref, { draft_year: newVal });
            
            this.elements.preview.innerText = newVal;
            this.updateStatusUI(false);

            refreshSitePreview();

            alert("Draft updated! Review the preview before publishing.");
        } catch (e) { console.error("Save Draft Error:", e); }
    
    },

    async publishLive() {
        try {
            const docSnap = await getDoc(this.ref);
            if (docSnap.exists()) {
                const draftVal = docSnap.data().draft_year;
                await updateDoc(this.ref, { copyright_year: draftVal });
                this.updateStatusUI(true);

                refreshSitePreview();

                alert("Success! The main website is now updated.");
            }
        } catch (e) { console.error("Publish Error:", e); }
    },

    updateStatusUI(isSynced) {
        // GUARD: If the status element doesn't exist, don't try to change it
        if (!this.elements.status) {
            console.warn("video-sync-status element not found. Skipping UI update.");
            return; 
        }
        if (isSynced) {
            this.elements.status.innerText = "Status: Synced with live site";
            this.elements.status.className = "form-text text-success mt-2";
        } else {
            this.elements.status.innerText = "Status: Changes pending (Not Live)";
            this.elements.status.className = "form-text text-warning mt-2 fw-bold";
        }
    }
};

/**
 * -- Profile Management --
 * this section handles the profile header
 */
const ProfileManager = {
    // Stores references to all the relevant DOM elements in one place for easy access and to prevent multiple lookups.
    elements: {
        name: document.getElementById('profile-name'),
        title: document.getElementById('profile-title'), 
        contact: document.getElementById('profile-contact'),
        picUpload: document.getElementById('profile-pic-upload'),
        bgUpload: document.getElementById('profile-bg-upload'),
        publishBtn: document.getElementById('publish-profile-btn')
    },

    // Store the current image URLs so that if the admin doesn't upload a new one, we can keep the old one when publishing.
    currentPicUrl: null,
    currentBgUrl: null,

    // The init function loads the current profile data and sets up the event listener for the publish button. 
    //It also checks if the publish button exists on the page before trying to add a listener, which prevents errors on pages that don't have this feature.
    async init() {
        if (!this.elements.publishBtn) return;
        await this.loadCurrentProfile();
        this.elements.publishBtn.addEventListener('click', () => this.publishLive());
    },
    // This function loads the current profile data from Firestore and populates the input fields. 
    //It also stores the current image URLs in case the admin doesn't upload new ones.
    async loadCurrentProfile() {
        try {
            const docRef = doc(db, "global_config", "profile_data");
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (this.elements.name) this.elements.name.value = data.name || "";
                if (this.elements.title) this.elements.title.value = data.title || "";
                if (this.elements.contact) this.elements.contact.value = data.contact_info || "";
                
                this.currentPicUrl = data.profile_pic_url || null;
                this.currentBgUrl = data.background_url || null;
            }
        } catch (e) {
            console.error("Error loading profile:", e);
        }
    },
    //this function handles the publishing of the profile changes. 
    //It checks if new images were uploaded, and if so, it uploads them to Firebase Storage and gets their URLs.
    async publishLive() {
        try {
            // Lock the publish button to prevent multiple clicks
            this.elements.publishBtn.disabled = true;
            this.elements.publishBtn.innerText = "Saving Profile...";

            // We start with the existing URLs, and only change them if new files are uploaded. 
            //This way, if the admin only updates the text, the images remain intact.
            let finalPicUrl = this.currentPicUrl;
            let finalBgUrl = this.currentBgUrl;

            // Check if new profile picture was uploaded
            const picFile = this.elements.picUpload.files[0];
            if (picFile) {
                const picRef = ref(storage, `profile_assets/profile_pic_${Date.now()}_${picFile.name}`);
                const picSnap = await uploadBytes(picRef, picFile);
                finalPicUrl = await getDownloadURL(picSnap.ref);
            }

            const bgFile = this.elements.bgUpload.files[0];
            if (bgFile) {
                const bgRef = ref(storage, `profile_assets/background_${Date.now()}_${bgFile.name}`);
                const bgSnap = await uploadBytes(bgRef, bgFile);
                finalBgUrl = await getDownloadURL(bgSnap.ref);
            }
            // Now we have the final URLs (either old or new), and we can save everything to Firestore in one go.
            const docRef = doc(db, "global_config", "profile_data");
            await setDoc(docRef, {
                name: this.elements.name.value,
                title: this.elements.title.value,
                contact_info: this.elements.contact.value,
                profile_pic_url: finalPicUrl,
                background_url: finalBgUrl,
                updatedAt: serverTimestamp()
            }, { merge: true });

            alert("Profile updated successfully!");
            
            this.elements.picUpload.value = "";
            this.elements.bgUpload.value = "";
            await this.loadCurrentProfile();

        } catch (error) {
            console.error("Profile Save Error:", error);
            alert("Error saving profile: " + error.message);
        } finally {
            this.elements.publishBtn.disabled = false;
            this.elements.publishBtn.innerText = "Publish Profile Changes";
        }
    }
};

// Live Video Preview for "Add Section" (Reusing your Smart Passthrough logic!)
const addVideoInput = document.getElementById('section-video');
const addVideoPreviewContainer = document.getElementById('add-video-preview-container');
const addVideoPreviewIframe = document.getElementById('add-video-preview-iframe');

if (addVideoInput) {
    addVideoInput.addEventListener('input', (e) => {
        const url = e.target.value.trim();
        
        // If the box is empty, hide the preview window entirely
        if (!url) {
            addVideoPreviewContainer.classList.add('d-none');
            addVideoPreviewIframe.src = "";
            return;
        }
        
        let finalUrl = url;
        
        // YOUR Smart Passthrough Logic (Formats YouTube links, leaves Echo360 alone)
        if (finalUrl.includes("youtube.com/watch?v=")) {
            finalUrl = finalUrl.replace("watch?v=", "embed/").split("&")[0];
        } else if (finalUrl.includes("youtu.be/")) {
            finalUrl = finalUrl.replace("youtu.be/", "youtube.com/embed/").split("?")[0];
        }
        
        // Unhide the window and set the source
        addVideoPreviewIframe.src = finalUrl;
        addVideoPreviewContainer.classList.remove('d-none');
    });
};

// Section Manager -- This handles adding new sections to pages, including image uploads and draft vs. live logic for each section.
// It also loads the existing sections into the management list and allows deletion.
const SectionManager = {
    elements: {
        location: document.getElementById('section-location'),
        title: document.getElementById('section-title'),
        body: document.getElementById('section-body'),
        image: document.getElementById('section-image'),
        hasButton: document.getElementById('has-subpage-button'),
        addBtn: document.getElementById('add-section-btn')
    },

    async addSection() {
        console.log("Starting addSection function...");

        const title = this.elements.title.value;
        const body = this.elements.body.value;
        const location = this.elements.location.value;

        // Capture ALL files selected
        const imageInput = this.elements.image; 
        const files = imageInput && imageInput.files.length > 0 ? Array.from(imageInput.files) : [];

        // Grab the specific IDs with "Null Checks" (This stops the crash!)
        const buttonEl = document.getElementById('has-subpage-button');
        const hasButton = buttonEl ? (buttonEl.value === "true") : false;

        // Grabs the custom text, but use "Learn More" as a safe fallback if it's empty
        const btnTextEl = document.getElementById('custom-button-text');
        const customBtnText = btnTextEl && btnTextEl.value.trim() !== "" ? btnTextEl.value.trim() : "Learn More";

        // Grab the custom subpage title, but use the main section 'title' as a safe fallback
        const subpageTitleEl = document.getElementById('custom-subpage-title');
        const customSubpageTitle = subpageTitleEl && subpageTitleEl.value.trim() !== "" ? subpageTitleEl.value.trim() : title;

        const alignEl = document.getElementById('image-alignment');
        const imageAlignment = alignEl ? alignEl.value : "left"; // Defaults to left if HTML is missing

        // Grab the single image caption
        const imageCaption = document.getElementById('section-image-caption') ? document.getElementById('section-image-caption').value.trim() : "";

        const titleAlignEl = document.getElementById('title-alignment');
        const titleAlignment = titleAlignEl ? titleAlignEl.value : "text-start"; 

        const bodyAlignEl = document.getElementById('body-alignment');
        const bodyAlignment = bodyAlignEl ? bodyAlignEl.value : "text-start";

        const slugEl = document.getElementById('section-slug');
        let generatedSlug = slugEl ? slugEl.value.trim() : "";

        // Grab the Video URL safely
        const videoEl = document.getElementById('section-video');
        const videoUrl = videoEl ? videoEl.value.trim() : "";
        const videoCaption = document.getElementById('section-video-caption').value;
        
        
        // Grab the PDF file safely
        const pdfInput = document.getElementById('section-pdf');
        const pdfFile = pdfInput && pdfInput.files.length > 0 ? pdfInput.files[0] : null;

        const isCollapsible = document.getElementById('section-is-collapsible') ? document.getElementById('section-is-collapsible').checked : false;

        // Grab the captions and split them into an array based on line breaks
        const carouselCaptionsRaw = document.getElementById('section-carousel-captions') ? document.getElementById('section-carousel-captions').value : "";
        const carouselCaptions = carouselCaptionsRaw.split('\n').map(c => c.trim());


        // the Table Grid Data 
        // (This looks at the grid built and saves the rows/columns)
        let tableData = [];
        const tableGrid = document.getElementById('admin-table-grid');
        if (tableGrid) {
            const rowCount = parseInt(document.getElementById('table-rows').value);
            const colCount = parseInt(document.getElementById('table-cols').value);
            
            for (let r = 0; r < rowCount; r++) {
                let rowArray = [];
                for (let c = 0; c < colCount; c++) {
                    const input = document.querySelector(`input[data-row="${r}"][data-col="${c}"]`);
                    rowArray.push(input ? input.value.trim() : "");
                }
                
                // Only push the row if it's not completely blank
                if (rowArray.some(val => val !== "")) {
                    tableData.push({ cells: rowArray }); 
                }
            }
        }
        if (!generatedSlug) {
            if (title) {
                generatedSlug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
            } else {
                generatedSlug = "context-block-" + Math.floor(Math.random() * 100000);
            }
        }

        if (!title && !body && !pdfFile && files.length === 0 && !videoUrl) {
            alert("Please provide at least a Title, Description, Image, Video, or PDF to create a section.");
            return;
        }

        try {
            
            this.elements.addBtn.disabled = true;
            this.elements.addBtn.innerText = "Processing...";

            let carouselUrls = [];
            let pdfUrl = null;

            // Loop through each file and upload individually
            if (files.length > 0) {
                console.log(`Found ${files.length} images. Uploading to Storage...`);
                
                for (const file of files) {
                    const storageRef = ref(storage, `section_images/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const downloadUrl = await getDownloadURL(snapshot.ref);
                    carouselUrls.push(downloadUrl);
                }
                console.log("All images uploaded!", carouselUrls);
            }

            // Upload PDF with Metadata (If exists)
            if (pdfFile) {
                console.log("Uploading PDF...");
                const pdfStorageRef = ref(storage, `section_pdfs/${Date.now()}_${pdfFile.name}`);
                
                // The magic metadata that prevents the download loop!
                const pdfMetadata = { 
                    contentType: 'application/pdf',
                    contentDisposition: 'inline'
                };
                
                const pdfSnapshot = await uploadBytes(pdfStorageRef, pdfFile, pdfMetadata);
                pdfUrl = await getDownloadURL(pdfSnapshot.ref);
            }

            console.log(" Attempting Firestore write to 'page_sections'...");

            const docRef = await addDoc(collection(db, "page_sections"), {
                target_page: location,
                title: title,
                body_text: body,
                is_collapsible: isCollapsible,
                title_alignment: titleAlignment,
                body_alignment: bodyAlignment,
                carousel_images: carouselUrls,
                carousel_captions: carouselCaptions,
                image_alignment: imageAlignment,
                image_caption: imageCaption,
                video_url: videoUrl,
                video_caption: videoCaption,
                pdf_url: pdfUrl, 
                table_data: tableData,
                has_subpage: hasButton,
                button_text: customBtnText, // We'll use this key in main.js
                subpage_title: customSubpageTitle,
                slug: generatedSlug,
                createdAt: serverTimestamp()
            });

            console.log("Document created with ID:", docRef.id);
            alert("Section added successfully!");
            window.location.reload(); 

        } catch (e) {
            console.error("THE CRASH HAPPENED HERE:", e);
            alert("Error: " + e.message);
        } finally {
            this.elements.addBtn.disabled = false;
            this.elements.addBtn.innerText = "Add Section to Page";
        }
    },
    
    // 1. Load and show the added sections (Grouped by Page)
    async init() {
        const accordionContainer = document.getElementById('manage-sections-accordion');
        // Fallback check for your previous ID if you haven't renamed it in HTML yet
        const list = accordionContainer || document.getElementById('manage-sections-list');
        const subpageGroup = document.getElementById('subpage-options');
        if (!list) return;

        // --- Keep your Auto-Slugger Logic ---
        const titleInput = this.elements.title;
        const slugInput = document.getElementById('section-slug'); 

        if (titleInput && slugInput) {
            titleInput.addEventListener('input', () => {
                const slugValue = titleInput.value
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, '-')
                    .replace(/[^\w-]/g, '');
                slugInput.value = slugValue;
            });
        }

        onSnapshot(query(collection(db, "page_sections"), orderBy("createdAt", "desc")), (snapshot) => {
            // 1. Clear both containers before rebuilding
            list.innerHTML = ""; 
            if (subpageGroup) subpageGroup.innerHTML = ''; 
    
            const allSections = [];
            const sectionsBySlug = {};
            const groupedByMainPage = {};
            const childrenByParentSlug = {};
    
            // 2. Initial Data Pass: Collect all data and update the Add Section Dropdown
            snapshot.forEach((doc) => {
                const data = doc.data();
                data.id = doc.id;
                allSections.push(data);
                
                // Store by slug so we can easily check if a section is a parent
                if (data.slug) sectionsBySlug[data.slug] = data;
    
                // ---  Auto-Populate Subpage Dropdown Logic ---
                if (subpageGroup && data.has_subpage && data.title) {
                    const rawPage = data.target_page || "Other";
                    let prefix = "↳";
                    let pageIndicator = "";
    
                    // If the target is an HTML page, this is a standard Level 1 Subpage
                    if (rawPage.includes('.html')) {
                        const cleanPageName = rawPage.replace('.html', '').charAt(0).toUpperCase() + rawPage.replace('.html', '').slice(1);
                        pageIndicator = `(${cleanPageName} Subpage)`;
                    } else {
                        // If the target is NOT an HTML page (it's a slug), this is a Level 2 Mini-Subpage!
                        prefix = "↳↳";
                        pageIndicator = `(Mini-Subpage)`;
                    }
    
                    const displayName = data.subpage_title || data.title || data.slug;
                    const option = document.createElement('option');
                    option.value = data.slug;
                    option.textContent = `${prefix} ${pageIndicator} — ${displayName}`;
                    subpageGroup.appendChild(option);
                }
            });
    
            // 3. Organize the Hierarchy: Separate Top-Level Sections from Child Sections
            allSections.forEach(sec => {
                const target = sec.target_page || "Other";
                
                // If the section's target_page matches another section's slug, it's a child!
                if (sectionsBySlug[target]) {
                    if (!childrenByParentSlug[target]) childrenByParentSlug[target] = [];
                    childrenByParentSlug[target].push(sec);
                } else {
                    // Otherwise, it's a top-level section on a main page
                    if (!groupedByMainPage[target]) groupedByMainPage[target] = [];
                    groupedByMainPage[target].push(sec);
                }
            });
    
            // 4. Rebuild the Nested Accordion HTML
            Object.keys(groupedByMainPage).forEach((pageName, index) => {
                const topLevelSections = groupedByMainPage[pageName];
                const collapseId = `collapse-${index}`;
                
                const accordionItem = document.createElement('div');
                accordionItem.className = "accordion-item mb-2 border rounded shadow-sm";
                
                // Build the list of Top-Level Sections first
                const sectionsHtml = topLevelSections.map(sec => {
                    const children = childrenByParentSlug[sec.slug] || [];
                    const hasChildren = sec.has_subpage || children.length > 0;
                    
                    // Smarter Name Cleaner
                    const getCleanName = (item) => {
                        if (item.title) return item.title;
                        if (item.subpage_title) return item.subpage_title;
                        let clean = item.slug.replace(/[0-9]/g, '').replace(/-/g, ' ').trim();
                        return clean.replace(/\b\w/g, char => char.toUpperCase()) || "Unnamed Section";
                    };
    
                    const parentName = getCleanName(sec);
                    let displaySlug = sec.slug.includes('context-block') ? "" : `<code class="small text-muted">${sec.slug}</code>`;
    
                    return `
                        <div class="list-group-item py-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <span class="fw-bold d-block">${parentName}</span>
                                    ${displaySlug}
                                </div>
                                <div class="d-flex gap-2">
                                    ${hasChildren ? `
                                        <button class="btn btn-sm btn-outline-secondary shadow-sm" type="button" data-bs-toggle="collapse" data-bs-target="#nested-${sec.id}">
                                            Subpage ▾
                                        </button>
                                    ` : ''}
                                    <button class="btn btn-danger btn-sm px-3 shadow-sm" onclick="deleteSection('${sec.id}')">Delete</button>
                                </div>
                            </div>
                            
                            ${hasChildren ? `
                                <div id="nested-${sec.id}" class="collapse mt-3">
                                    <div class="list-group list-group-flush border-start border-3 border-secondary ms-4 rounded shadow-sm">
                                        ${children.length > 0 ? children.map(child => {
                                            const childName = getCleanName(child);
                                            let childSlugDisplay = child.slug.includes('context-block') ? "" : `<code class="small text-muted">${child.slug}</code>`;
                                            
                                            // LEVEL 3: Check for Mini-Subpages (Grandchildren)
                                            const grandChildren = childrenByParentSlug[child.slug] || [];
                                            const hasGrandChildren = child.has_subpage || grandChildren.length > 0;
                                            
                                            return `
                                                <div class="list-group-item bg-light py-2">
                                                    <div class="d-flex justify-content-between align-items-center">
                                                        <div>
                                                            <span class="fw-bold d-block text-secondary">↳ ${childName}</span>
                                                            ${childSlugDisplay}
                                                        </div>
                                                        <div class="d-flex gap-2">
                                                            ${hasGrandChildren ? `
                                                                <button class="btn btn-sm btn-outline-info shadow-sm py-0" type="button" data-bs-toggle="collapse" data-bs-target="#nested-${child.id}">
                                                                    Mini-Subpage ▾
                                                                </button>
                                                            ` : ''}
                                                            <button class="btn btn-danger btn-sm px-3 shadow-sm" onclick="deleteSection('${child.id}')">Delete</button>
                                                        </div>
                                                    </div>
    
                                                    ${hasGrandChildren ? `
                                                        <div id="nested-${child.id}" class="collapse mt-2">
                                                            <div class="list-group list-group-flush border-start border-3 border-info ms-4 rounded shadow-sm">
                                                                ${grandChildren.length > 0 ? grandChildren.map(grandChild => {
                                                                    const grandChildName = getCleanName(grandChild);
                                                                    let grandChildSlugDisplay = grandChild.slug.includes('context-block') ? "" : `<code class="small text-muted">${grandChild.slug}</code>`;
                                                                    return `
                                                                        <div class="list-group-item d-flex justify-content-between align-items-center py-2" style="background-color: #f8f9fa;">
                                                                            <div>
                                                                                <span class="fw-bold d-block text-info">↳↳ ${grandChildName}</span>
                                                                                ${grandChildSlugDisplay}
                                                                            </div>
                                                                            <button class="btn btn-danger btn-sm px-3 shadow-sm" onclick="deleteSection('${grandChild.id}')">Delete</button>
                                                                        </div>
                                                                    `;
                                                                }).join('') : '<div class="list-group-item text-muted small py-2">No sections added to this mini-subpage yet.</div>'}
                                                            </div>
                                                        </div>
                                                    ` : ''}
                                                </div>
                                            `;
                                        }).join('') : '<div class="list-group-item text-muted small bg-light py-2">No sections added to this subpage yet.</div>'}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('');
    
                // Wrap it all in the Main Page accordion
                accordionItem.innerHTML = `
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed fw-bold text-uppercase small" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                            <i class="bi bi-file-earmark-text me-2"></i> ${pageName} 
                        </button>
                    </h2>
                    <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#manage-sections-accordion">
                        <div class="accordion-body p-0">
                            <div class="list-group list-group-flush">
                                ${sectionsHtml}
                            </div>
                        </div>
                    </div>
                `;
                list.appendChild(accordionItem);
            });
        });

    }

};

// Generates the input grid for the Table Builder
window.generateTableEditor = function() {
    const cols = parseInt(document.getElementById('table-cols').value) || 0;
    const rows = parseInt(document.getElementById('table-rows').value) || 0;
    const container = document.getElementById('table-editor-container');

    if (cols === 0 || rows === 0) {
        container.innerHTML = "<p class='text-danger small'>Please enter both rows and columns.</p>";
        return;
    }

    let html = '<table class="table table-bordered table-sm bg-white" id="admin-table-grid">';
    for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
            // Make the first row stand out as the Header row
            const isHeader = r === 0 ? "fw-bold bg-light" : "";
            const placeholder = r === 0 ? `Header ${c+1}` : `Data`;
            
            html += `<td><input type="text" class="form-control form-control-sm ${isHeader}" data-row="${r}" data-col="${c}" placeholder="${placeholder}"></td>`;
        }
        html += '</tr>';
    }
    html += '</table>';
    container.innerHTML = html;
};

// This attaches the internal function to the global 'window' object
window.deleteSection = async (id) => {
    // 1. Confirm with the user
    if (confirm("Are you sure you want to delete this section?")) {
        try {
            console.log("Attempting to delete section:", id);
            
            // 2. The Firebase command
            await deleteDoc(doc(db, "page_sections", id));
            
            // Note: Since you use onSnapshot, the UI will update 
            // automatically. No need for a page reload!
        } catch (e) {
            console.error("Delete Error:", e);
            alert("Failed to delete section: " + e.message);
        }
    }
};

const CVManager = {
    elements: {
        input: document.getElementById('cv-upload-input'),
        previewBtn: document.getElementById('preview-cv-btn'),
        publishBtn: document.getElementById('publish-cv-btn'),
        status: document.getElementById('cv-upload-status'),
        iframe: document.getElementById('cv-preview-iframe')
    },
    
    // We store the local preview URL here so we can clean it up later
    localFileUrl: null, 

    async init() {
        if (!this.elements.input) return;

        // 1. Load the current live CV on startup
        await this.loadCurrentCV();

        // 2. Setup button listeners
        this.elements.previewBtn?.addEventListener('click', () => this.previewLocalFile());
        this.elements.publishBtn?.addEventListener('click', () => this.publishLive());
    },

    async loadCurrentCV() {
        try {
            const docRef = doc(db, "global_config", "cv_data");
            const docSnap = await getDoc(docRef);
            
            if (docSnap.exists() && docSnap.data().pdf_url) {
                this.elements.iframe.src = docSnap.data().pdf_url;
                this.updateStatusUI(true);
            } else {
                this.elements.status.innerText = "No CV currently uploaded.";
            }
        } catch (e) {
            console.error("Error loading CV:", e);
        }
    },

    previewLocalFile() {
        const file = this.elements.input.files[0];
        
        if (!file) {
            alert("Please select a PDF file first.");
            return;
        }

        if (file.type !== "application/pdf") {
            alert("Only PDF files are allowed!");
            return;
        }

        // Cleanup old local URL to prevent memory leaks in the browser
        if (this.localFileUrl) {
            URL.revokeObjectURL(this.localFileUrl);
        }

        // Generate a local temporary URL for the iframe to read
        this.localFileUrl = URL.createObjectURL(file);
        this.elements.iframe.src = this.localFileUrl;
        
        this.updateStatusUI(false);
    },

    async publishLive() {
        const file = this.elements.input.files[0];
        
        if (!file) {
            alert("There is no new file selected to publish!");
            return;
        }

        try {
            // Lock the UI to prevent double-clicks
            this.elements.publishBtn.disabled = true;
            this.elements.publishBtn.innerText = "Uploading & Publishing...";
            this.elements.status.innerText = "Uploading to secure storage, please wait...";

            // 1. Upload the file to Firebase Storage
            const storageRef = ref(storage, `cv_documents/Live_CV_${Date.now()}.pdf`);
            
            // --- NEW METADATA CODE ADDED HERE ---
            const metadata = {
                contentType: 'application/pdf',
                contentDisposition: 'inline'
            };
            
            // --- UPDATED THIS LINE to include the metadata variable ---
            const snapshot = await uploadBytes(storageRef, file, metadata);
            
            const downloadUrl = await getDownloadURL(snapshot.ref);

            // 2. Save the permanent URL to Firestore
            const docRef = doc(db, "global_config", "cv_data");
            await setDoc(docRef, { 
                pdf_url: downloadUrl,
                updatedAt: serverTimestamp() 
            }, { merge: true });

            // 3. Reset the UI back to a Live state
            this.updateStatusUI(true);
            this.elements.input.value = ""; // Clear the input box
            this.localFileUrl = null;

            alert("Your new CV is now LIVE on the website!");

        } catch (error) {
            console.error("CV Upload Error:", error);
            this.elements.status.innerHTML = `<span class="text-danger">Upload failed: ${error.message}</span>`;
        } finally {
            // Unlock the UI
            this.elements.publishBtn.disabled = false;
            this.elements.publishBtn.innerText = "Publish to Live Site";
        }
    },

    updateStatusUI(isLive) {
        if (!this.elements.status) return;
        
        if (isLive) {
            this.elements.status.innerHTML = `<span class="text-success fw-bold">Status: Viewing Live CV</span>`;
        } else {
            this.elements.status.innerHTML = `<span class="text-warning fw-bold">Status: Previewing Local Draft (Not Live)</span>`;
        }
    }
};


const SectionEditor = {
    // Array to hold all database sections in memory so it's super fast
    allSections: [],
    //This array will temporarily hold the existing images while we edit
    currentImages: [],

    // Track the currently saved PDF URL
    currentPdfUrl: null,

    //Track the currently saved Table Data
    currentTableData: [],

    elements: {
        pageSelect: document.getElementById('edit-page-selector'),
        sectionSelect: document.getElementById('edit-section-selector'),
        id: document.getElementById('edit-section-id'),
        title: document.getElementById('edit-section-title'),
        body: document.getElementById('edit-section-body'),
        isCollapsible: document.getElementById('edit-section-is-collapsible'),
        carouselCaptions: document.getElementById('edit-section-carousel-captions'),
        video: document.getElementById('edit-section-video'),
        videoCaption: document.getElementById('edit-section-video-caption'),
        videoContainer: document.getElementById('edit-video-preview-container'),
        videoPreview: document.getElementById('edit-video-preview-iframe'),
        imageAlignment: document.getElementById('edit-image-alignment'),
        imageCaption: document.getElementById('edit-section-image-caption'),
        imagePreviewContainer: document.getElementById('edit-image-preview-container'),
        imageInput: document.getElementById('edit-section-image'),
        pdfPreviewContainer: document.getElementById('edit-pdf-preview-container'),
        pdfInput: document.getElementById('edit-section-pdf'),
        tableGridContainer: document.getElementById('edit-table-grid-container'),
        tableColsInput: document.getElementById('edit-table-cols'),
        tableRowsInput: document.getElementById('edit-table-rows'),
        buildTableBtn: document.getElementById('edit-build-table-btn'),
        btnText: document.getElementById('edit-button-text'),
        subpageTitle: document.getElementById('edit-subpage-title'),
        saveBtn: document.getElementById('save-edit-btn')
    },

    async init() {
        await this.fetchAllSections();
        
        // Listeners to make the dropdowns trigger data changes
        if (this.elements.pageSelect) {
            this.elements.pageSelect.addEventListener('change', (e) => this.populateSectionsDropdown(e.target.value));
        }
        if (this.elements.sectionSelect) {
            this.elements.sectionSelect.addEventListener('change', (e) => this.loadSectionData(e.target.value));
        }
        if (this.elements.saveBtn) {
            this.elements.saveBtn.addEventListener('click', () => this.saveSectionEdits());
        }
        if (this.elements.video) {
            // Triggers the preview every time the text in the box changes!
            this.elements.video.addEventListener('input', (e) => this.updateVideoPreview(e.target.value));
        }
        if (this.elements.buildTableBtn) {
            this.elements.buildTableBtn.addEventListener('click', () => this.buildNewEditGrid());
        }
    },

    async fetchAllSections() {
        try {
            const querySnapshot = await getDocs(collection(db, "page_sections"));
            this.allSections = [];

            // 1. Store all the data in memory (super fast for filtering later!)
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id; 
                this.allSections.push(data);
            });

            // Clear the dropdown
            this.elements.pageSelect.innerHTML = '<option value="">-- Select a Page --</option>';

            // 2. Build the Hardcoded MAIN PAGES Group
            const mainOptGroup = document.createElement('optgroup');
            mainOptGroup.label = "---- MAIN PAGES ----";
            
            const mainPages = [
                { value: "index.html", text: "Home Page" },
                { value: "cv.html", text: "CV Page" },
                { value: "research.html", text: "Research Page" },
                { value: "teachings.html", text: "Teaching Page" },
                { value: "service.html", text: "Service Page" }
            ];
            
            mainPages.forEach(page => {
                const option = document.createElement('option');
                option.value = page.value;
                option.textContent = page.text;
                mainOptGroup.appendChild(option);
            });
            
            this.elements.pageSelect.appendChild(mainOptGroup);

            // 3. 🚀 UPGRADED: Build the Dynamic SUBPAGES Group
            const subOptGroup = document.createElement('optgroup');
            subOptGroup.label = "---- SUBPAGES ----";

            // Hunt through our memory for sections that act as parent subpages
            const subpages = this.allSections.filter(sec => sec.has_subpage && sec.title);

            if (subpages.length > 0) {
                subpages.forEach(sec => {
                    const rawPage = sec.target_page || "Other";
                    let prefix = "↳";
                    let pageIndicator = "";

                    // 🚀 NEW: Level 1 vs Level 2 detection logic
                    if (rawPage.includes('.html')) {
                        const cleanPageName = rawPage.replace('.html', '').charAt(0).toUpperCase() + rawPage.replace('.html', '').slice(1);
                        pageIndicator = `(${cleanPageName} Subpage)`;
                    } else {
                        // If it doesn't have .html, it's a child of another slug!
                        prefix = "↳↳";
                        pageIndicator = `(Mini-Subpage)`;
                    }

                    const displayName = sec.subpage_title || sec.title || sec.slug;

                    const option = document.createElement('option');
                    // The value MUST be the slug, because child sections use the parent's slug as their target_page!
                    option.value = sec.slug; 
                    option.textContent = `${prefix} ${pageIndicator} — ${displayName}`;
                    subOptGroup.appendChild(option);
                });
            } else {
                const noOption = document.createElement('option');
                noOption.disabled = true;
                noOption.textContent = "No subpages available";
                subOptGroup.appendChild(noOption);
            }

            this.elements.pageSelect.appendChild(subOptGroup);

        } catch (error) {
            console.error("Error loading sections:", error);
            this.elements.pageSelect.innerHTML = '<option value="">Error loading database.</option>';
        }
    },

    populateSectionsDropdown(selectedPage) {
        this.clearForm(); // Clear the text boxes
        
        if (!selectedPage) {
            this.elements.sectionSelect.innerHTML = '<option value="">-- Waiting for page selection --</option>';
            return;
        }

        // Filter sections that belong only to the chosen page
        const filteredSections = this.allSections.filter(sec => sec.target_page === selectedPage);

        if (filteredSections.length === 0) {
            this.elements.sectionSelect.innerHTML = '<option value="">No sections found on this page</option>';
            return;
        }

        // Populate Dropdown 2 (The Sections)
        this.elements.sectionSelect.innerHTML = '<option value="">-- Select a Section --</option>';
        filteredSections.forEach(sec => {
            const option = document.createElement('option');
            option.value = sec.id;
            option.textContent = sec.title || "Untitled Section";
            this.elements.sectionSelect.appendChild(option);
        });
    },

    loadSectionData(sectionId) {
        if (!sectionId) {
            this.clearForm();
            return;
        }       
        
        // Find the chosen section in memory and push text to the form
        const sectionData = this.allSections.find(sec => sec.id === sectionId);

        if (sectionData) {
            this.elements.id.value = sectionId;
            this.elements.title.value = sectionData.title || "";
            this.elements.body.value = sectionData.body_text || "";

            //  Removed the duplicate, unprotected lines from here!

            //Added safety checks! Now it won't crash if these boxes are missing from the HTML.
            if (this.elements.btnText) {
                this.elements.btnText.value = sectionData.button_text || "";
            }
            if (this.elements.subpageTitle) {
                this.elements.subpageTitle.value = sectionData.subpage_title || "";
            }
            if (this.elements.videoCaption) {
                this.elements.videoCaption.value = sectionData.video_caption || "";
            }
            if (this.elements.video) {
                this.elements.video.value = sectionData.video_url || "";
                this.updateVideoPreview(sectionData.video_url || ""); 
            }
            if (this.elements.isCollapsible) {
                this.elements.isCollapsible.checked = sectionData.is_collapsible || false;
            }
            
            this.currentImages = sectionData.carousel_images || [];
            this.renderImagePreviews();

            this.currentPdfUrl = sectionData.pdf_url || null;
            this.renderPdfPreview();
            
            // load existing table into memory and draw the grid
            this.currentTableData = sectionData.table_data || [];
            this.renderTableEditor();

            if (this.elements.imageAlignment) {
                this.elements.imageAlignment.value = sectionData.image_alignment || "left";
            }
            if (this.elements.imageCaption) {
                this.elements.imageCaption.value = sectionData.image_caption || "";
            }
            if (this.elements.carouselCaptions) {
                this.elements.carouselCaptions.value = (sectionData.carousel_captions || []).join('\n');
            }
        }
    },

    clearForm() {
        this.elements.id.value = "";
        this.elements.title.value = "";
        this.elements.body.value = "";

        // 🚀 FIXED: Removed the duplicate, unprotected lines from here too!

        // Added safety checks here 
        if (this.elements.btnText) this.elements.btnText.value = "";
        if (this.elements.subpageTitle) this.elements.subpageTitle.value = "";

        if (this.elements.video) {
            this.elements.video.value = "";
            this.updateVideoPreview(""); 
        }
        if (this.elements.videoCaption) {
            this.elements.videoCaption.value = "";
        }
        if (this.elements.isCollapsible) {
            this.elements.isCollapsible.checked = false;
        }
        if (this.elements.carouselCaptions){
            this.elements.carouselCaptions.value = "";
        }
        if (this.elements.imageAlignment) {
            this.elements.imageAlignment.value = "left";
        }
        if (this.elements.imageCaption) {
            this.elements.imageCaption.value = "";
        }

        this.currentImages = [];
        if (this.elements.imagePreviewContainer) this.elements.imagePreviewContainer.innerHTML = "";
        if (this.elements.imageInput) this.elements.imageInput.value = "";

        this.currentPdfUrl = null;
        if (this.elements.pdfPreviewContainer) this.elements.pdfPreviewContainer.innerHTML = "";
        if (this.elements.pdfInput) this.elements.pdfInput.value = "";

        // Clear the Table tracker
        this.currentTableData = [];
        if (this.elements.tableGridContainer) this.elements.tableGridContainer.innerHTML = "";
    },

    async saveSectionEdits() {
        const sectionId = this.elements.id.value;
        const updatedTitle = this.elements.title.value;
        const updatedBody = this.elements.body.value;

        // Grab the video URL from the Edit Modal input
        const videoInputEl = document.getElementById('edit-section-video');
        const updatedVideo = videoInputEl ? videoInputEl.value.trim() : "";

        // Safety check to ensure they actually picked a section first!
        if (!sectionId) {
            alert("Please select a Page and a Section from the dropdown menus before saving!");
            return;
        }

        try {
            this.elements.saveBtn.disabled = true;
            this.elements.saveBtn.innerText = "Saving to Database...";
            
            // Check if there are NEW images to upload
            let newUploadedUrls = [];
            const newFiles = this.elements.imageInput && this.elements.imageInput.files.length > 0 
                             ? Array.from(this.elements.imageInput.files) : [];

            if (newFiles.length > 0) {
                console.log(`Uploading ${newFiles.length} new images...`);
                for (const file of newFiles) {
                    const storageRef = ref(storage, `section_images/${Date.now()}_${file.name}`);
                    const snapshot = await uploadBytes(storageRef, file);
                    const downloadUrl = await getDownloadURL(snapshot.ref);
                    newUploadedUrls.push(downloadUrl);
                }
            }

            // Combine the old images we KEPT with the new images we UPLOADED
            const finalImageArray = [...this.currentImages, ...newUploadedUrls];

            //Handle the PDF Upload Logic
            let finalPdfUrl = this.currentPdfUrl; // Start by assuming we keep the old one (or null if they deleted it)
            const pdfFile = this.elements.pdfInput && this.elements.pdfInput.files.length > 0 
                            ? this.elements.pdfInput.files[0] : null;
            
            if (pdfFile) {
                console.log("Uploading NEW PDF...");
                const pdfStorageRef = ref(storage, `section_pdfs/${Date.now()}_${pdfFile.name}`);
                
                // The magic metadata that prevents the download loop
                const pdfMetadata = { 
                    contentType: 'application/pdf',
                    contentDisposition: 'inline'
                };
                
                const pdfSnapshot = await uploadBytes(pdfStorageRef, pdfFile, pdfMetadata);
                finalPdfUrl = await getDownloadURL(pdfSnapshot.ref); // Overwrite with the new link!
            }

            // Scrape the Edit Table Grid Data
            let updatedTableData = [];
            const editTableGrid = document.getElementById('edit-admin-table-grid');

            if (editTableGrid) {
                // Find out how big the grid is
                const allInputs = editTableGrid.querySelectorAll('input[data-edit-row]');
                if (allInputs.length > 0) {
                    let maxRow = 0; let maxCol = 0;
                    allInputs.forEach(input => {
                        const r = parseInt(input.getAttribute('data-edit-row'));
                        const c = parseInt(input.getAttribute('data-edit-col'));
                        if (r > maxRow) maxRow = r;
                        if (c > maxCol) maxCol = c;
                    });

                    // Scrape every box
                    for (let r = 0; r <= maxRow; r++) {
                        let rowArray = [];
                        for (let c = 0; c <= maxCol; c++) {
                            const input = document.querySelector(`input[data-edit-row="${r}"][data-edit-col="${c}"]`);
                            rowArray.push(input ? input.value.trim() : "");
                        }
                        // Only push the row if it's not completely empty
                        if (rowArray.some(val => val !== "")) {
                            updatedTableData.push({ cells: rowArray });
                        }
                    }
                }
            }
                            
            const docRef = doc(db, "page_sections", sectionId);
            const updatedCarouselCaptions = this.elements.carouselCaptions ? this.elements.carouselCaptions.value.split('\n').map(c => c.trim()) : [];
            const updatedImgAlign = this.elements.imageAlignment ? this.elements.imageAlignment.value : "left";
            const updatedImgCaption = this.elements.imageCaption ? this.elements.imageCaption.value.trim() : "";

            await updateDoc(docRef, {
                title: updatedTitle,
                body_text: updatedBody,
                is_collapsible: this.elements.isCollapsible.checked,
                image_alignment: updatedImgAlign,
                image_caption: updatedImgCaption,
                video_url: updatedVideo,
                video_caption: this.elements.videoCaption ? this.elements.videoCaption.value : "",
                carousel_images: finalImageArray,
                carousel_captions: updatedCarouselCaptions,
                pdf_url: finalPdfUrl,
                table_data: updatedTableData,
                button_text: this.elements.btnText ? this.elements.btnText.value : "Learn More",
                subpage_title: this.elements.subpageTitle ? this.elements.subpageTitle.value : "",
                updatedAt: serverTimestamp()
            });

            alert("Section text updated successfully!");
            window.location.reload(); 

        } catch (error) {
            console.error("Error updating section:", error);
            alert("Error saving updates: " + error.message);
            this.elements.saveBtn.disabled = false;
            this.elements.saveBtn.innerText = "Save Changes";
        }
    },

    // Formats the URL and updates the live iframe
    updateVideoPreview(url) {
        if (!this.elements.videoPreview || !this.elements.videoContainer) return;

        // If the box is empty, hide the preview window entirely
        if (!url || url.trim() === "") {
            this.elements.videoPreview.src = "";
            this.elements.videoContainer.classList.add('d-none');
            return;
        }

        let finalUrl = url;
        
        // Smart Passthrough (Formats YouTube links, leaves Echo360 alone)
        if (finalUrl.includes("youtube.com/watch?v=")) {
            finalUrl = finalUrl.replace("watch?v=", "embed/").split("&")[0];
        } else if (finalUrl.includes("youtu.be/")) {
            finalUrl = finalUrl.replace("youtu.be/", "youtube.com/embed/").split("?")[0];
        }

        this.elements.videoPreview.src = finalUrl;
        this.elements.videoContainer.classList.remove('d-none'); // Unhide the window
    },
    //  Draws the image thumbnails with a delete button
    renderImagePreviews() {
        if (!this.elements.imagePreviewContainer) return;
        this.elements.imagePreviewContainer.innerHTML = ""; // Clear existing thumbnails

        if (this.currentImages.length === 0) {
            this.elements.imagePreviewContainer.innerHTML = '<span class="text-muted small">No images currently saved.</span>';
            return;
        }

        this.currentImages.forEach((url, index) => {
            // Create a wrapper box for the image
            const wrapper = document.createElement('div');
            wrapper.className = "position-relative border rounded shadow-sm bg-white";
            wrapper.style.width = "120px";
            wrapper.style.height = "80px";

            // Create the image thumbnail
            const img = document.createElement('img');
            img.src = url;
            img.className = "w-100 h-100 rounded";
            img.style.objectFit = "cover";

            // Create the "X" Delete Button
            const deleteBtn = document.createElement('button');
            deleteBtn.type = "button"; // Prevents accidental form submission

            // 'X' icon
            deleteBtn.innerHTML = '&times;'; 
            
            // Added d-flex utilities to center the icon inside the circle
            deleteBtn.className = "btn btn-danger position-absolute top-0 end-0 m-1 rounded-circle shadow p-0 d-flex align-items-center justify-content-center";
            
            //  perfect circle: equal width and height
            deleteBtn.style.width = "20px";
            deleteBtn.style.height = "20px";
            deleteBtn.style.fontSize = "16px"; // Sized to fit the smaller circle
            deleteBtn.style.lineHeight = "1";  // Ensures the X stays perfectly vertically centered
            
            // When clicked, remove it from the array and re-draw the list
            deleteBtn.onclick = () => {
                this.currentImages.splice(index, 1); 
                this.renderImagePreviews(); 
            };

            wrapper.appendChild(img);
            wrapper.appendChild(deleteBtn);
            this.elements.imagePreviewContainer.appendChild(wrapper);
        });
    },

    // Shows the current PDF and a delete button
    renderPdfPreview() {
        if (!this.elements.pdfPreviewContainer) return;

        if (!this.currentPdfUrl) {
            this.elements.pdfPreviewContainer.innerHTML = '<span class="text-muted small">No PDF currently saved.</span>';
            return;
        }

        // Create a visual badge for the current PDF
        this.elements.pdfPreviewContainer.innerHTML = `
            <div class="d-flex align-items-center justify-content-between border rounded p-2 bg-white shadow-sm">
                <div class="text-truncate me-3">
                    <i class="bi bi-file-earmark-pdf text-danger me-2"></i>
                    <a href="${this.currentPdfUrl}" target="_blank" class="small text-decoration-none">View Current PDF</a>
                </div>
                <button type="button" id="remove-pdf-btn" class="btn btn-sm btn-outline-danger shadow-sm">
                    <i class="bi bi-trash"></i> Remove
                </button>
            </div>
        `;

        // Make the remove button actually work!
        document.getElementById('remove-pdf-btn').addEventListener('click', () => {
            this.currentPdfUrl = null; // Clear from memory
            this.renderPdfPreview(); // Re-draw the UI to show "No PDF"
        });
    },

    // Draws the existing table with pre-filled text boxes
    renderTableEditor() {
        if (!this.elements.tableGridContainer) return;

        if (!this.currentTableData || this.currentTableData.length === 0) {
            this.elements.tableGridContainer.innerHTML = '<span class="text-muted small">No table currently saved.</span>';
            return;
        }

        const rowCount = this.currentTableData.length;
        const colCount = this.currentTableData[0].cells.length;

        let html = '<table class="table table-bordered table-sm bg-white" id="edit-admin-table-grid">';
        for (let r = 0; r < rowCount; r++) {
            html += '<tr>';
            for (let c = 0; c < colCount; c++) {
                const isHeader = r === 0 ? "fw-bold bg-light" : "";
                const cellValue = this.currentTableData[r].cells[c] || "";
                
                // Replace quotes so they don't break the HTML attribute
                const safeValue = cellValue.replace(/"/g, '&quot;'); 
                
                // We use data-edit-row so our scraper knows exactly where this data goes!
                html += `<td><input type="text" class="form-control form-control-sm ${isHeader}" data-edit-row="${r}" data-edit-col="${c}" value="${safeValue}"></td>`;
            }
            html += '</tr>';
        }
        html += '</table>';
        this.elements.tableGridContainer.innerHTML = html;
    },

    // Overwrites the table with a blank grid if you want to start fresh or change dimensions
    buildNewEditGrid() {
        const cols = parseInt(this.elements.tableColsInput.value) || 0;
        const rows = parseInt(this.elements.tableRowsInput.value) || 0;

        if (cols === 0 || rows === 0) {
            alert("Please enter both rows and columns to build a grid.");
            return;
        }

        // Generate a blank array of objects to act as our new table
        let newTable = [];
        for (let r = 0; r < rows; r++) {
            let newRow = [];
            for (let c = 0; c < cols; c++) {
                newRow.push("");
            }
            newTable.push({ cells: newRow });
        }

        // Save it and tell the renderer to draw it
        this.currentTableData = newTable;
        this.renderTableEditor();

        // Clear the inputs
        this.elements.tableColsInput.value = "";
        this.elements.tableRowsInput.value = "";
    },
    
};

document.addEventListener('DOMContentLoaded', () => {
    // If you have other initializations here (like VideoManager.init()), leave them!
    CVManager.init();
    ProfileManager.init();
    SectionEditor.init();
});

/**
 * -- Event Listeners -- 
 */

// Footer Feature Listeners
document.getElementById('save-draft')?.addEventListener('click', () => FooterManager.saveDraft());
document.getElementById('publish-live')?.addEventListener('click', () => FooterManager.publishLive());


// New Section Listeners
document.getElementById('add-section-btn')?.addEventListener('click', () => SectionManager.addSection());

// Sign Out Logic
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        console.log("User signed out.");
    } catch (e) { console.error("Logout Error:", e); }
});