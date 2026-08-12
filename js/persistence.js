// Enhanced Data Persistence Layer with Auto-Backup and Recovery
const BACKUP_KEY = 'ams_instructions_backup';
const LAST_SAVE_KEY = 'ams_last_save_time';
const RECOVERY_KEY = 'ams_recovery_data';

// Auto-backup every 5 seconds if data has changed
let hasUnsavedChanges = false;
let autoBackupInterval;

async function enableAutoBackup() {
    autoBackupInterval = setInterval(async () => {
        if (hasUnsavedChanges) {
            console.log('[AutoBackup] Backing up data...');
            await createLocalBackup();
            hasUnsavedChanges = false;
        }
    }, 5000);
}

function markDataChanged() {
    hasUnsavedChanges = true;
}

async function createLocalBackup() {
    try {
        const data = await exportData();
        const backup = {
            data: data,
            timestamp: new Date().toISOString(),
            version: APP_VERSION
        };
        localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
        localStorage.setItem(LAST_SAVE_KEY, new Date().getTime());
        console.log('[Backup] Data backed up to localStorage');
        return true;
    } catch (error) {
        console.error('[Backup] Failed to backup:', error);
        return false;
    }
}

async function getRecoveryData() {
    try {
        const backup = localStorage.getItem(BACKUP_KEY);
        if (backup) {
            const parsed = JSON.parse(backup);
            return parsed;
        }
    } catch (error) {
        console.error('[Recovery] Failed to parse backup:', error);
    }
    return null;
}

async function recoverFromBackup() {
    try {
        const backup = await getRecoveryData();
        if (backup && backup.data) {
            console.log('[Recovery] Recovering from backup...');
            await importData(backup.data);
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
        const allInstructions = await getAllInstructions();
        const backup = await getRecoveryData();
        
        const dbCount = allInstructions.length;
        const backupCount = backup?.data?.instructions?.length || 0;
        
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
    console.log('[Init] Starting persistence layer...');
    enableAutoBackup();
    
    // Check if we need recovery
    setTimeout(async () => {
        const isValid = await verifyDataIntegrity();
        if (!isValid) {
            console.warn('[Init] Data integrity check failed');
        }
    }, 1000);
});

// Cleanup on unload
window.addEventListener('beforeunload', async () => {
    if (hasUnsavedChanges) {
        await createLocalBackup();
    }
});
