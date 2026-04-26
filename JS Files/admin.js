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
                VideoManager.init();
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

/**
 * -- Video Settings --
 * Handles multiple video entries, each with its own draft vs. live logic and preview.
 */
const VideoManager = {
    activeDocId: 'video_content|home_grad_video', 
    
    elements: {
        selector: document.getElementById('video-selector'),
        input: document.getElementById('video-input'),
        iframe: document.getElementById('video-preview-iframe'),
        status: document.getElementById('video-sync-status')
    },

    async init() {
        if (!this.elements.selector) return;

        const dynamicVideoGroup = document.getElementById('dynamic-video-options');
        if (dynamicVideoGroup) {
            onSnapshot(collection(db, "page_sections"), (snapshot) => {
                dynamicVideoGroup.innerHTML = ""; 
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    if (data.video_url) {
                        const option = document.createElement('option');
                        option.value = `page_sections|${doc.id}`; 
                        option.textContent = `↳ Section: ${data.title}`;
                        dynamicVideoGroup.appendChild(option);
                    }
                });
            });
        }

        await this.loadVideoData();

        this.elements.selector.addEventListener('change', (e) => {
            this.activeDocId = e.target.value;
            this.loadVideoData();
        });

        document.getElementById('save-video-draft')?.addEventListener('click', () => this.saveDraft());
        document.getElementById('publish-video-live')?.addEventListener('click', () => this.publishLive());
    },

    async loadVideoData() {
        const [collectionName, docId] = this.activeDocId.split('|');
        const videoRef = doc(db, collectionName, docId);
        const docSnap = await getDoc(videoRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            let currentVideo = "";
            
            if (collectionName === "video_content") {
                currentVideo = data.draft_url || data.live_url || "";
                this.updateStatusUI(data.draft_url === data.live_url);
            } else {
                currentVideo = data.video_url || "";
                this.updateStatusUI(true); 
            }
            
            this.elements.input.value = currentVideo;
            this.updatePreview(currentVideo);
        } else {
            //  If the document doesn't exist yet, clear the boxes so it doesn't look stuck!
            this.elements.input.value = "";
            this.updatePreview("");
            this.updateStatusUI(false);
        }
    },

    updatePreview(url) {
        if (!this.elements.iframe) return;
        if (!url) {
            this.elements.iframe.src = "";
            return;
        }

        let finalUrl = url;
        // Smart Passthrough (Allows Echo360 and formats YouTube)
        if (finalUrl.includes("youtube.com/watch?v=")) {
            finalUrl = finalUrl.replace("watch?v=", "embed/").split("&")[0];
        } else if (finalUrl.includes("youtu.be/")) {
            finalUrl = finalUrl.replace("youtu.be/", "youtube.com/embed/").split("?")[0];
        }

        this.elements.iframe.src = finalUrl;
    },

    async saveDraft() {
        const [collectionName, docId] = this.activeDocId.split('|');
        const newVal = this.elements.input.value;

        if (collectionName === "video_content") {
            const videoRef = doc(db, collectionName, docId);
            // setDoc with merge prevents the crash/freeze!
            await setDoc(videoRef, { draft_url: newVal }, { merge: true });
            this.updateStatusUI(false);
            alert(`Draft saved!`);
        } else {
            this.updateStatusUI(false); 
        }
        
        this.updatePreview(newVal);
    },

    async publishLive() {
        const [collectionName, docId] = this.activeDocId.split('|');
        const videoRef = doc(db, collectionName, docId);

        if (collectionName === "video_content") {
            const docSnap = await getDoc(videoRef);
            const draftVal = (docSnap.exists() && docSnap.data().draft_url) 
                             ? docSnap.data().draft_url 
                             : this.elements.input.value;
            //Doc prevents crash
            await setDoc(videoRef, { live_url: draftVal }, { merge: true });
        } else {
            const newVal = this.elements.input.value;
            // setDoc prevents crash
            await setDoc(videoRef, { video_url: newVal }, { merge: true });
        }

        this.updateStatusUI(true);
        alert("This video is now LIVE on the website.");
    },

    updateStatusUI(isSynced) {
        if (!this.elements.status) return;
        if (isSynced) {
            this.elements.status.innerText = "Status: Synced with live site";
            this.elements.status.className = "form-text text-success mt-2";
        } else {
            this.elements.status.innerText = "Status: Changes pending (Not Live)";
            this.elements.status.className = "form-text text-warning mt-2 fw-bold";
        }
    }
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

        const titleAlignEl = document.getElementById('title-alignment');
        const titleAlignment = titleAlignEl ? titleAlignEl.value : "text-start"; 

        const bodyAlignEl = document.getElementById('body-alignment');
        const bodyAlignment = bodyAlignEl ? bodyAlignEl.value : "text-start";

        const slugEl = document.getElementById('section-slug');
        let generatedSlug = slugEl ? slugEl.value.trim() : "";

        // Grab the Video URL safely
        const videoEl = document.getElementById('section-video');
        const videoUrl = videoEl ? videoEl.value.trim() : "";
        
        // Grab the PDF file safely
        const pdfInput = document.getElementById('section-pdf');
        const pdfFile = pdfInput && pdfInput.files.length > 0 ? pdfInput.files[0] : null;

        if (!generatedSlug) {
            if (title) {
                generatedSlug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
            } else {
                generatedSlug = "text-block-" + Math.floor(Math.random() * 100000);
            }
        }

        if (!title && !body) {
            alert("Please fill in at least a Heading or a Description.");
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
                title_alignment: titleAlignment,
                body_alignment: bodyAlignment,
                carousel_images: carouselUrls,
                image_alignment: imageAlignment,
                video_url: videoUrl,
                pdf_url: pdfUrl, // Saves the PDF link
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
        
        if (!list) return;

        // --- Keep your Auto-Slugger Logic ---
        const titleInput = this.elements.title;
        const slugInput = document.getElementById('section-slug'); 
        const subpageGroup = document.getElementById('subpage-options');

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

        // --- NEW: Grouped Accordion Logic ---
        // We listen for data and group it by 'target_page'
        onSnapshot(query(collection(db, "page_sections"), orderBy("createdAt", "desc")), (snapshot) => {
            list.innerHTML = ""; // Clear current list
            
            const grouped = {};
            // 1. Group the data
            snapshot.forEach((doc) => {
                const data = doc.data();
                data.id = doc.id;
                const page = data.target_page || "Other";
                if (!grouped[page]) grouped[page] = [];
                grouped[page].push(data);
            });

            // 2. Build the Accordion
            Object.keys(grouped).forEach((pageName, index) => {
                const sections = grouped[pageName];
                const collapseId = `collapse-${index}`;
                
                const accordionItem = document.createElement('div');
                accordionItem.className = "accordion-item mb-2 border rounded shadow-sm";
                
                accordionItem.innerHTML = `
                    <h2 class="accordion-header">
                        <button class="accordion-button collapsed fw-bold text-uppercase small" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                            <i class="bi bi-file-earmark-text me-2"></i> ${pageName} 
                        </button>
                    </h2>
                    <div id="${collapseId}" class="accordion-collapse collapse" data-bs-parent="#manage-sections-accordion">
                        <div class="accordion-body p-0">
                            <div class="list-group list-group-flush">
                                ${sections.map(sec => `
                                    <div class="list-group-item d-flex justify-content-between align-items-center py-3">
                                        <div>
                                            <span class="fw-bold d-block">${sec.title || "<em class='text-muted'>No Title (Text Block)</em>"}</span>
                                            <code class="small text-muted">${sec.slug}</code>
                                        </div>
                                        
                                        <button class="btn btn-danger btn-sm px-3 shadow-sm" onclick="deleteSection('${sec.id}')">
                                            Delete
                                        </button>
                                        
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
                list.appendChild(accordionItem);
            });
        });
    }

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

    elements: {
        pageSelect: document.getElementById('edit-page-selector'),
        sectionSelect: document.getElementById('edit-section-selector'),
        id: document.getElementById('edit-section-id'),
        title: document.getElementById('edit-section-title'),
        body: document.getElementById('edit-section-body'),
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
    },

    async fetchAllSections() {
        try {
            const querySnapshot = await getDocs(collection(db, "page_sections"));
            this.allSections = [];
            const uniquePages = new Set();

            // Store the data in memory and find all unique pages
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.id = docSnap.id; 
                this.allSections.push(data);
                
                if (data.target_page) {
                    uniquePages.add(data.target_page);
                }
            });

            // Populate Dropdown 1 (The Pages)
            this.elements.pageSelect.innerHTML = '<option value="">-- Select a Page --</option>';
            uniquePages.forEach(page => {
                const option = document.createElement('option');
                option.value = page;
                option.textContent = page; // E.g., 'index.html' or 'details.html'
                this.elements.pageSelect.appendChild(option);
            });

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
            this.elements.btnText.value = sectionData.button_text || "";
            this.elements.subpageTitle.value = sectionData.subpage_title || "";
        }
    },

    clearForm() {
        this.elements.id.value = "";
        this.elements.title.value = "";
        this.elements.body.value = "";
        this.elements.btnText.value = "";
        this.elements.subpageTitle.value = "";
    },

    async saveSectionEdits() {
        const sectionId = this.elements.id.value;
        const updatedTitle = this.elements.title.value;
        const updatedBody = this.elements.body.value;

        // Safety check to ensure they actually picked a section first!
        if (!sectionId) {
            alert("Please select a Page and a Section from the dropdown menus before saving!");
            return;
        }

        if (!updatedTitle || !updatedBody) {
            alert("Title and Description cannot be empty.");
            return;
        }

        try {
            this.elements.saveBtn.disabled = true;
            this.elements.saveBtn.innerText = "Saving to Database...";

            const docRef = doc(db, "page_sections", sectionId);
            await updateDoc(docRef, {
                title: updatedTitle,
                body_text: updatedBody,
                button_text: this.elements.btnText.value,
                subpage_title: this.elements.subpageTitle.value,
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
    }
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

// Video Content Listeners
// 1. Update Preview (Save Draft)
document.getElementById('save-video-draft')?.addEventListener('click', () => { VideoManager.saveDraft();});
// 2. Publish to Live Site
document.getElementById('publish-video-live')?.addEventListener('click', () => {VideoManager.publishLive();});

// New Section Listeners
document.getElementById('add-section-btn')?.addEventListener('click', () => SectionManager.addSection());

// Sign Out Logic
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        console.log("User signed out.");
    } catch (e) { console.error("Logout Error:", e); }
});