// Data recovery checks.
//
// This file used to keep its OWN separate backup, written by a function nothing
// ever called — so that backup never existed, and the recovery below never had
// anything to recover from. It now reads the real backup slots kept by
// hybrid-storage.js, so there is one backup system rather than two, and this
// acts as a second chance if the restore at startup did not run.

const LAST_SAVE_KEY = 'ams_last_save_time';

function markDataChanged() {
    // Kept for callers below. Every database write now saves a backup
    // immediately (see hybrid-storage.js), so there is nothing to defer.
}

async function createLocalBackup() {
    const ok = await hybridStorage.mirrorToLocalStorage();
    if (ok) {
        localStorage.setItem(LAST_SAVE_KEY, new Date().getTime());
    }
    return ok;
}

async function getRecoveryData() {
    return hybridStorage.bestBackup();
}

async function recoverFromBackup() {
    try {
        const backup = await getRecoveryData();
        if (backup && (backup.instructions || []).length > 0) {
            console.log('[Recovery] Recovering from backup...');
            await importData(backup);
            console.log('[Recovery] Data recovered successfully');
            return true;
        }
    } catch (error) {
        console.error('[Recovery] Recovery failed:', error);
    }
    return false;
}

async function verifyDataIntegrity() {
    try {
        // The database may still be opening when this runs — that is not a
        // failure, and must not be reported as one.
        if (!db) {
            console.log('[Integrity] Database not open yet, skipping check');
            return true;
        }

        const allInstructions = await getAllInstructions();
        const backup = await getRecoveryData();

        const dbCount = allInstructions.length;
        const backupCount = backup ? (backup.instructions || []).length : 0;

        console.log(`[Integrity] DB: ${dbCount} instructions, Backup: ${backupCount} instructions`);

        if (dbCount === 0 && backupCount > 0) {
            console.warn('[Integrity] DB empty but backup exists! Attempting recovery...');
            return await recoverFromBackup();
        }

        return true;
    } catch (error) {
        console.error('[Integrity] Verification failed:', error);
        return false;
    }
}

// Enhanced save with verification
async function saveInstructionWithVerification(instruction) {
    try {
        // Save to IndexedDB
        await saveInstructionDB(instruction);
        markDataChanged();
        
        // Immediately backup
        await createLocalBackup();
        
        // Verify it was saved
        const saved = await getInstruction(instruction.number);
        if (saved) {
            console.log('[Save] Instruction saved and verified:', instruction.number);
            showSaveConfirmation(instruction.title);
            return true;
        } else {
            console.error('[Save] Verification failed - instruction not found after save');
            showSaveError('Verification failed');
            return false;
        }
    } catch (error) {
        console.error('[Save] Save failed:', error);
        showSaveError(error.message);
        return false;
    }
}

function showSaveConfirmation(title) {
    const msg = `✓ Saved: ${title}`;
    console.log('[UI] ' + msg);
    // Show in-app confirmation (brief toast-like message)
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-weight: 600;
        z-index: 1000;
        animation: slideUp 0.3s ease-out;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideDown 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

function showSaveError(message) {
    const msg = `⚠ Save failed: ${message}`;
    console.error('[UI] ' + msg);
    alert(msg + '\n\nTap "OK" and try again. Your work is in the recovery backup.');
}

// Initialize on app load
window.addEventListener('load', async () => {
    console.log('[Init] Starting recovery checks...');

    // Second chance, after the restore that runs at startup. Deliberately late,
    // so the database has finished opening.
    setTimeout(async () => {
        const isValid = await verifyDataIntegrity();
        if (!isValid) {
            console.warn('[Init] Data integrity check failed');
        }
    }, 1000);
});
