// Version Sync - Detects cache mismatches and forces reload
const VERSION_SYNC_KEY = 'ams_current_version';
const RELOAD_GUARD_KEY = 'ams_version_reloaded';
const STALE_GUARD_KEY = 'ams_stale_version_reloaded';
const CHECK_INTERVAL = 5000; // Check every 5 seconds
const SERVER_CHECK_MIN_GAP = 60000; // Don't re-ask the server more than once a minute

class VersionSync {
    constructor() {
        this.currentVersion = null;
        this.lastCheck = null;
        this.lastServerCheck = 0;
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

        // The check above only spots Safari and the Home Screen app disagreeing with
        // EACH OTHER. A single context sitting alone on a stale cache has nothing to
        // disagree with, so ask the server what it's actually publishing.
        this.checkAgainstServer();

        // A Home Screen app is rarely reloaded — re-check when it comes back to the
        // foreground, so a version published while it was backgrounded gets picked up.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.checkAgainstServer();
        });
    }

    // Reads the version the server is currently publishing. sw.js is the source
    // rather than a dedicated version file because it already has to be bumped on
    // every release — one more file to keep in sync is exactly how versions drift.
    async fetchServerVersion() {
        // A unique query each time: a controlled page's fetch still passes through
        // the service worker, and its cache-first handler would otherwise answer
        // from the very cache we're trying to test. 'vercheck' also tells the
        // service worker not to store the response (see sw.js).
        const url = 'sw.js?vercheck=' + Date.now();

        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) return null;

            const text = await response.text();
            const match = text.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
            return match ? match[1] : null;
        } catch (error) {
            // Offline is the normal case here, not a failure worth shouting about
            console.log('[VersionSync] Could not reach server for version check');
            return null;
        }
    }

    isServerNewer(serverVersion) {
        const server = parseFloat(serverVersion);
        const current = parseFloat(this.currentVersion);

        if (Number.isFinite(server) && Number.isFinite(current)) {
            return server > current;
        }
        return serverVersion !== this.currentVersion;
    }

    async checkAgainstServer() {
        const now = Date.now();
        if (now - this.lastServerCheck < SERVER_CHECK_MIN_GAP) return;
        this.lastServerCheck = now;

        const serverVersion = await this.fetchServerVersion();
        if (!serverVersion) return;

        if (!this.isServerNewer(serverVersion)) {
            // Up to date — let a future update trigger a reload again
            sessionStorage.removeItem(STALE_GUARD_KEY);
            return;
        }

        console.error(`[VersionSync] STALE! Server has v${serverVersion}, this copy is v${this.currentVersion}`);

        // Guard per server version: if v18 still doesn't arrive after a reload, stop
        // trying, but a later v19 is still allowed its own attempt.
        if (sessionStorage.getItem(STALE_GUARD_KEY) === serverVersion) {
            console.warn('[VersionSync] Still stale after reload — not reloading again.');
            return;
        }
        sessionStorage.setItem(STALE_GUARD_KEY, serverVersion);

        console.log('[VersionSync] Clearing caches to pick up the new version...');
        await this.purgeCaches();
        window.location.replace(this.reloadUrl());
    }

    // Drop every cached file and stop the service worker serving them, so the
    // reload has to fetch fresh copies from the server.
    async purgeCaches() {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map(key => caches.delete(key)));
        } catch (error) {
            console.error('[VersionSync] Cache purge failed:', error);
        }

        if ('serviceWorker' in navigator) {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(reg => reg.unregister()));
            } catch (error) {
                console.error('[VersionSync] Service worker unregister failed:', error);
            }
        }
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

        // Same purge as the stale-copy path: unregistering the service worker alone
        // leaves the cached files in place for the next one to serve straight back.
        this.purgeCaches().then(() => {
            window.location.replace(this.reloadUrl());
        });
    }
}

const versionSync = new VersionSync();

// Initialize when page loads
window.addEventListener('load', () => {
    versionSync.init();
});
