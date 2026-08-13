// Version Sync - Detects cache mismatches and forces reload
const VERSION_SYNC_KEY = 'ams_current_version';
const CHECK_INTERVAL = 5000; // Check every 5 seconds

class VersionSync {
    constructor() {
        this.currentVersion = null;
        this.lastCheck = null;
    }

    init() {
        // APP_VERSION is defined in js/ui.js, which loads after this script —
        // must not be read until the 'load' event, once every script has run.
        this.currentVersion = APP_VERSION;

        // Store version on load
        this.updateStoredVersion();
        
        // Check for version mismatch periodically
        setInterval(() => this.checkForMismatch(), CHECK_INTERVAL);
        
        console.log(`[VersionSync] Initialized with v${this.currentVersion}`);
    }

    updateStoredVersion() {
        localStorage.setItem(VERSION_SYNC_KEY, this.currentVersion);
    }

    checkForMismatch() {
        const stored = localStorage.getItem(VERSION_SYNC_KEY);
        
        if (stored && stored !== this.currentVersion) {
            console.error(`[VersionSync] MISMATCH! Stored: v${stored}, Current: v${this.currentVersion}`);
            this.forceReload();
        }
    }

    forceReload() {
        console.log('[VersionSync] Forcing reload to sync version...');
        
        // Clear service worker and reload
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then((registrations) => {
                registrations.forEach((reg) => {
                    reg.unregister();
                });
                
                // Hard reload after unregistering
                setTimeout(() => {
                    window.location.href = window.location.href + '?t=' + Date.now();
                }, 500);
            });
        } else {
            // Fallback: just hard reload
            window.location.href = window.location.href + '?t=' + Date.now();
        }
    }
}

const versionSync = new VersionSync();

// Initialize when page loads
window.addEventListener('load', () => {
    versionSync.init();
});
