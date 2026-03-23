import { db, auth, storage } from './firebase-config.js';
// Updated Firestore Imports (Added collection, addDoc, serverTimestamp)
import { doc, updateDoc, getDoc, collection, addDoc, serverTimestamp, query, where, orderBy, onSnapshot, deleteDoc} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
//  Imports (These are needed for the image upload)
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js";



/**
 * -- Global Security -- 
 * This remains at the top level because it controls access to the entire page.
 */

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
 * -- Video Settings --
 * Handles multiple video entries, each with its own draft vs. live logic and preview.
 */
const VideoManager = {
    activeDocId: 'home_grad_video', // Default selection

    elements: {
        selector: document.getElementById('video-selector'),
        input: document.getElementById('video-input'),
        iframe: document.getElementById('video-preview-iframe'),
        status: document.getElementById('video-sync-status')
    },

    async init() {
        if (!this.elements.selector) return;

        // Load default data
        await this.loadVideoData();

        // Listen for when the professor picks a different video to edit
        this.elements.selector.addEventListener('change', (e) => {
            this.activeDocId = e.target.value;
            this.loadVideoData();
        });
    },

    async loadVideoData() {
        const videoRef = doc(db, "video_content", this.activeDocId);
        const docSnap = await getDoc(videoRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            const currentDraft = data.draft_url || data.live_url;
            this.elements.input.value = currentDraft || "";
            this.updatePreview(currentDraft);
            this.updateStatusUI(data.draft_url === data.live_url);
        }
    },

    updatePreview(url) {
        // GUARD: If the iframe doesn't exist on this page, just stop here.
        if (!this.elements.iframe) {
            console.warn("⚠️ Video preview iframe not found in HTML. Skipping preview update.");
            return;
        }
        if (!url) {
            this.elements.iframe.src = "";
            return;
        }
        // Regex to pull the ID from various YouTube URL formats
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = url.match(regExp);
        const videoId = (match && match[2].length === 11) ? match[2] : null;
        
        this.elements.iframe.src = videoId ? `https://www.youtube.com/embed/${videoId}` : "";
    },

    async saveDraft() {
        const videoRef = doc(db, "video_content", this.activeDocId);
        const newVal = this.elements.input.value;
        try {
            await updateDoc(videoRef, { draft_url: newVal });
            this.updatePreview(newVal);
            this.updateStatusUI(false);
            
            // Call our helper function
            refreshSitePreview();
            
            alert(`Draft saved for ${this.activeDocId}!`);
        } catch (e) { console.error("Video Save Draft Error:", e); }
    },

    async publishLive() {
        const videoRef = doc(db, "video_content", this.activeDocId);
        const docSnap = await getDoc(videoRef);
        if (docSnap.exists()) {
            const draftVal = docSnap.data().draft_url;
            await updateDoc(videoRef, { live_url: draftVal });
            this.updateStatusUI(true);

            refreshSitePreview();

            alert("This video is now LIVE on the website.");
        }
    },

    updateStatusUI(isSynced) {
        // GUARD: If the status element doesn't exist, don't try to change it
        if (!this.elements.status) {
            console.warn("⚠️ video-sync-status element not found. Skipping UI update.");
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
// Section Manager -- This handles adding new sections to pages, including image uploads and draft vs. live logic for each section.
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
        const hasButton = document.getElementById('has-subpage-button').value === "true";

        //const slug = document.getElementById('section-slug').value; // We need this for the URL!

        if (!title || !body) {
            alert("Please fill in the Heading and Description.");
            return;
        }

        try {
            this.elements.addBtn.disabled = true;
            this.elements.addBtn.innerText = "Processing...";

            let imageUrl = null;

            if (file) {
                console.log("Image found. Uploading to Storage...");
                const storageRef = ref(storage, `section_images/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                imageUrl = await getDownloadURL(snapshot.ref);
                console.log("Image Uploaded! URL:", imageUrl);
            }

            console.log(" Attempting Firestore write to 'page_sections'...");

            //GENERATE THE SLUG - This converts "My Project Title" -> "my-project-title"
            const generatedSlug = title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]/g, '');

            const docRef = await addDoc(collection(db, "page_sections"), {
                target_page: location,
                title: title,
                body_text: body,
                image_url: imageUrl,
                has_subpage: hasButton, // We'll use this key in main.js
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