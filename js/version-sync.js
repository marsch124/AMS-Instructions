// Version Sync - Detects cache mismatches and forces reload
const VERSION_SYNC_KEY = 'ams_current_version';
const RELOAD_GUARD_KEY = 'ams_version_reloaded';
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

        // Arriving already in sync means any earlier corrective reload worked,
        // so clear the guard and let a future genuine mismatch trigger again.
        if (localStorage.getItem(VERSION_SYNC_KEY) === this.currentVersion) {
            sessionStorage.removeItem(RELOAD_GUARD_KEY);
        }

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

    // Builds the reload URL by REPLACING any existing cache-bust param.
    // Appending instead would grow the URL on every cycle (?t=1?t=2?t=3…) until
    // the server rejects it with 414 and the app looks broken.
    reloadUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set('t', Date.now());
        return url.toString();
    }

    forceReload() {
        // Guard against a reload loop: if the mismatch somehow survives a reload
        // (e.g. a cache that keeps serving stale files), stop rather than spin.
        // Showing a stale version beats leaving the app stuck on an error page.
        if (sessionStorage.getItem(RELOAD_GUARD_KEY)) {
            console.warn('[VersionSync] Version mismatch persists after reload — not reloading again.');
            return;
        }
        sessionStorage.setItem(RELOAD_GUARD_KEY, '1');

        console.log('[VersionSync] Forcing reload to sync version...');

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations().then((registrations) => {
                registrations.forEach((reg) => {
                    reg.unregister();
                });

                setTimeout(() => {
                    window.location.replace(this.reloadUrl());
                }, 500);
            });
        } else {
            window.location.replace(this.reloadUrl());
        }
    }
}

const versionSync = new VersionSync();

// Initialize when page loads
window.addEventListener('load', () => {
    versionSync.init();
});
