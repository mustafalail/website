import { db, auth, storage } from './firebase-config.js';
// Updated Firestore Imports (Added collection, addDoc, serverTimestamp)
import { doc, updateDoc, getDoc, collection, addDoc, serverTimestamp, query, where, setDoc, orderBy, onSnapshot, deleteDoc} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
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

const ProfileManager = {
    elements: {
        name: document.getElementById('profile-name'),
        title: document.getElementById('profile-title'), 
        contact: document.getElementById('profile-contact'),
        picUpload: document.getElementById('profile-pic-upload'),
        bgUpload: document.getElementById('profile-bg-upload'),
        publishBtn: document.getElementById('publish-profile-btn')
    },

    currentPicUrl: null,
    currentBgUrl: null,

    async init() {
        if (!this.elements.publishBtn) return;
        await this.loadCurrentProfile();
        this.elements.publishBtn.addEventListener('click', () => this.publishLive());
    },

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

    async publishLive() {
        try {
            this.elements.publishBtn.disabled = true;
            this.elements.publishBtn.innerText = "Saving Profile...";

            let finalPicUrl = this.currentPicUrl;
            let finalBgUrl = this.currentBgUrl;

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

            const docRef = doc(db, "global_config", "profile_data");
            await setDoc(docRef, {
                name: this.elements.name.value,
                // REMOVED university field from the database save
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
        const file = this.elements.image.files[0];

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

        const slugEl = document.getElementById('section-slug');
        const generatedSlug = slugEl ? slugEl.value : title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

        // Grab the Video URL safely
        const videoEl = document.getElementById('section-video');
        const videoUrl = videoEl ? videoEl.value.trim() : "";
        
        // Grab the PDF file safely
        const pdfInput = document.getElementById('section-pdf');
        const pdfFile = pdfInput && pdfInput.files.length > 0 ? pdfInput.files[0] : null;

        if (!title || !body) {
            alert("Please fill in the Heading and Description.");
            return;
        }

        try {
            

            this.elements.addBtn.disabled = true;
            this.elements.addBtn.innerText = "Processing...";

            let imageUrl = null;
            let pdfUrl = null;

            if (file) {
                console.log("Image found. Uploading to Storage...");
                const storageRef = ref(storage, `section_images/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                imageUrl = await getDownloadURL(snapshot.ref);
                console.log("Image Uploaded! URL:", imageUrl);
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
                image_url: imageUrl,
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

   // 1. Load and show the added sections
   async init() {
        const list = document.getElementById('manage-sections-list');
        if (!list) return;

        // --- ADD THE AUTO-SLUGGER HERE ---
        const titleInput = this.elements.title;
        const slugInput = document.getElementById('section-slug'); 
        const subpageGroup = document.getElementById('subpage-options');

        if (subpageGroup) {
            // We listen to ALL sections in the database
            onSnapshot(collection(db, "page_sections"), (snapshot) => {
                subpageGroup.innerHTML = ""; // Clear it out
                
                snapshot.forEach((doc) => {
                    const data = doc.data();
                    
                    // If this section has a "Learn More" button, it IS a subpage!
                    // So we add it to the dropdown using its slug as the destination.
                    if (data.has_subpage) {
                        const option = document.createElement('option');
                        option.value = data.slug; // The target becomes the slug!
                        option.textContent = `↳ Inside: ${data.title}`;
                        subpageGroup.appendChild(option);
                    }
                });
            });
        }
        
        if (titleInput && slugInput) {
            titleInput.addEventListener('input', () => {
                const slugValue = titleInput.value
                    .toLowerCase()
                    .trim()
                    .replace(/\s+/g, '-')           // Replace spaces with -
                    .replace(/[^\w-]/g, '');        // Remove special chars
                slugInput.value = slugValue;
            });
        }

        // Listen for data from Firestore
        onSnapshot(query(collection(db, "page_sections"), orderBy("createdAt", "desc")), (snapshot) => {
            list.innerHTML = ""; // Clear the "Loading..." text
            
            snapshot.forEach((doc) => {
                const data = doc.data();
                list.innerHTML += `
                    <div class="list-group-item d-flex justify-content-between align-items-center">
                        <div>
                            <strong>${data.title}</strong> 
                            <small class="text-muted ms-2">(${data.target_page})</small>
                        </div>
                        <button class="btn btn-danger btn-sm" onclick="deleteSection('${doc.id}')">
                            Delete
                        </button>
                    </div>`;
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
document.addEventListener('DOMContentLoaded', () => {
    // If you have other initializations here (like VideoManager.init()), leave them!
    CVManager.init();
    ProfileManager.init();
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