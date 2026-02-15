import { db, auth } from './firebase-config.js';
import { doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

/**
 * -- Global Security -- 
 * This remains at the top level because it controls access to the entire page.
 */

onAuthStateChanged(auth, (user) => {
    const isLoginPage = window.location.pathname.includes("login.html");
    if (!user) {
        if (!isLoginPage) window.location.href = "login.html";
    } else {
        if (isLoginPage) {
            window.location.href = "admin.html";
        } else {
            // Kick off all features once user is logged in
            FooterManager.init();
            VideoManager.init();
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
                alert("Success! The main website is now updated.");
            }
        } catch (e) { console.error("Publish Error:", e); }
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
        await updateDoc(videoRef, { draft_url: newVal });
        this.updatePreview(newVal);
        this.updateStatusUI(false);
        alert(`Draft saved for ${this.activeDocId}!`);
    },

    async publishLive() {
        const videoRef = doc(db, "video_content", this.activeDocId);
        const docSnap = await getDoc(videoRef);
        if (docSnap.exists()) {
            const draftVal = docSnap.data().draft_url;
            await updateDoc(videoRef, { live_url: draftVal });
            this.updateStatusUI(true);
            alert("This video is now LIVE on the website.");
        }
    },

    updateStatusUI(isSynced) {
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

// Sign Out Logic
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        console.log("User signed out.");
    } catch (e) { console.error("Logout Error:", e); }
});