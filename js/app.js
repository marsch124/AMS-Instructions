// AMS Instructions - Main App Logic
// This file ensures all initialization is complete and handles any app-wide state

console.log('AMS Instructions v1.0 initializing...');

// Ensure app is properly initialized on startup
window.addEventListener('load', () => {
    // Any additional app-wide initialization can go here
    // UI initialization happens in ui.js via DOMContentLoaded
});

// Handle app visibility changes for camera cleanup
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopQRScanning();
    }
});

// Prevent zoom on iOS
document.addEventListener('touchmove', (e) => {
    if (e.scale !== 1) {
        e.preventDefault();
    }
}, { passive: false });

// Prevent pull-to-refresh on mobile
document.body.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });
