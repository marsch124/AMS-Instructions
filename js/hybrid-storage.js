// On-device backup layer.
//
// This is NOT a sync mechanism between Safari and the Home Screen app. On iOS
// those are separate storage areas, and trying to keep them in step is what let
// the two drift into different instruction lists. Its one job is to keep a
// recoverable copy of THIS app instance's data, on this device.
//
// Two slots are kept: the current backup, and a previous generation that is at
// least a day older, so a bad current backup is never the only copy left.

const BACKUP_CURRENT_KEY = 'ams_instructions_hybrid';       // existing installs already store here
const BACKUP_PREVIOUS_KEY = 'ams_instructions_hybrid_prev';
const BACKUP_FAILED_KEY = 'ams_backup_failed';
const GENERATION_GAP_MS = 24 * 60 * 60 * 1000;

function readBackupSlot(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && Array.isArray(parsed.instructions) ? parsed : null;
    } catch (error) {
        console.error('[Backup] Could not read slot ' + key + ':', error);
        return null;
    }
}

function backupIsEmpty(data) {
    return !data || (data.instructions || []).length === 0;
}

function backupCounts(data) {
    if (!data) return null;
    return {
        instructions: (data.instructions || []).length,
        people: (data.people || []).length,
        audits: (data.audits || []).length,
        actions: (data.actions || []).length,
        timestamp: data.timestamp || null
    };
}

class HybridStorage {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    async init(database) {
        if (this.initialized) return;
        this.db = database;
        this.initialized = true;
        console.log('[Backup] Initialized');

        await this.restoreIfEmpty();
    }

    // If the app has come up with no instructions but a backup holds some, put
    // them back. Must run BEFORE anything writes to the database — a write would
    // otherwise save an empty snapshot over the very backup being restored from.
    async restoreIfEmpty() {
        try {
            const existing = await getAllInstructions();
            if (existing.length > 0) return false;

            const backup = this.bestBackup();
            if (backupIsEmpty(backup)) return false;

            console.warn('[Backup] No instructions found — restoring from backup...');
            // importData() is deliberately not wrapped for mirroring, so restoring
            // cannot trigger a save back over the backup mid-restore.
            await importData(backup);
            console.log('[Backup] Restored ' + backup.instructions.length + ' instructions');
            return true;
        } catch (error) {
            console.error('[Backup] Restore failed:', error);
            return false;
        }
    }

    // Prefer the current slot, but fall back to the previous generation if the
    // current one is empty or unreadable.
    bestBackup() {
        const current = readBackupSlot(BACKUP_CURRENT_KEY);
        if (!backupIsEmpty(current)) return current;

        const previous = readBackupSlot(BACKUP_PREVIOUS_KEY);
        if (!backupIsEmpty(previous)) return previous;

        return null;
    }

    // Save a fresh backup. `allowEmpty` is set only by deliberate deletions —
    // everything else is refused if it would empty a backup that holds data.
    async mirrorToLocalStorage({ allowEmpty = false } = {}) {
        try {
            const data = await exportData();
            const existing = readBackupSlot(BACKUP_CURRENT_KEY);

            // The rule that was missing, and that cost real data: a backup holding
            // instructions is never replaced by an empty snapshot. An empty database
            // at save time means something went wrong, not that the data is gone.
            if (!allowEmpty && backupIsEmpty(data) && !backupIsEmpty(existing)) {
                console.warn('[Backup] Refused to overwrite a backup of ' +
                    existing.instructions.length + ' instructions with an empty one');
                return false;
            }

            this.rollGeneration(existing);
            const ok = this.persist(BACKUP_CURRENT_KEY, data);
            if (ok) {
                console.log('[Backup] Saved ' + data.instructions.length + ' instructions');
            }
            return ok;
        } catch (error) {
            console.error('[Backup] Save failed:', error);
            return false;
        }
    }

    // Keep the previous slot roughly a day behind the current one, so it is a
    // genuinely older copy rather than just one write ago.
    rollGeneration(existing) {
        if (backupIsEmpty(existing)) return;

        const previous = readBackupSlot(BACKUP_PREVIOUS_KEY);
        const previousTime = previous && previous.timestamp ? Date.parse(previous.timestamp) : NaN;
        if (Number.isFinite(previousTime) && Date.now() - previousTime < GENERATION_GAP_MS) return;

        this.persist(BACKUP_PREVIOUS_KEY, existing);
    }

    // Photos are stored inside the data, so a large library can fill the storage
    // allowance. Rather than failing silently, drop the older generation to make
    // room, and record the failure so the Data Safety screen can report it.
    persist(key, data) {
        const json = JSON.stringify(data);
        try {
            localStorage.setItem(key, json);
            localStorage.removeItem(BACKUP_FAILED_KEY);
            return true;
        } catch (error) {
            console.warn('[Backup] Storage full — dropping the older generation to make room');
            try {
                localStorage.removeItem(BACKUP_PREVIOUS_KEY);
                localStorage.setItem(key, json);
                localStorage.removeItem(BACKUP_FAILED_KEY);
                return true;
            } catch (retryError) {
                localStorage.setItem(BACKUP_FAILED_KEY, new Date().toISOString());
                console.error('[Backup] Could not save backup:', retryError);
                return false;
            }
        }
    }

    // What the Data Safety screen reports on.
    status() {
        return {
            current: backupCounts(readBackupSlot(BACKUP_CURRENT_KEY)),
            previous: backupCounts(readBackupSlot(BACKUP_PREVIOUS_KEY)),
            failedAt: localStorage.getItem(BACKUP_FAILED_KEY)
        };
    }

    getSlot(which) {
        return readBackupSlot(which === 'previous' ? BACKUP_PREVIOUS_KEY : BACKUP_CURRENT_KEY);
    }
}

const hybridStorage = new HybridStorage();

// Every function that writes to the database also refreshes the backup.
const originalSaveInstructionDB = saveInstructionDB;
saveInstructionDB = async function(instruction) {
    const result = await originalSaveInstructionDB(instruction);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalBulkUpdateInstructions = bulkUpdateInstructions;
bulkUpdateInstructions = async function(instructions) {
    const result = await originalBulkUpdateInstructions(instructions);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

// Note the pass-through of every argument rather than just the instruction:
// recordCompletion takes the person who did it as a second argument, and a
// wrapper that named only the first would drop them without a word.
const originalRecordCompletion = recordCompletion;
recordCompletion = async function(...args) {
    const result = await originalRecordCompletion(...args);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalAmendLastCompletion = amendLastCompletion;
amendLastCompletion = async function(...args) {
    const result = await originalAmendLastCompletion(...args);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

// Deleting the last instruction is a deliberate act, so it is allowed to leave
// an empty backup — otherwise the deleted instructions would reappear on restart.
const originalDeleteInstruction = deleteInstruction;
deleteInstruction = async function(id) {
    const result = await originalDeleteInstruction(id);
    await hybridStorage.mirrorToLocalStorage({ allowEmpty: true });
    return result;
};

const originalSavePersonDB = savePersonDB;
savePersonDB = async function(person) {
    const result = await originalSavePersonDB(person);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalDeletePerson = deletePerson;
deletePerson = async function(id) {
    const result = await originalDeletePerson(id);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalSaveAuditDB = saveAuditDB;
saveAuditDB = async function(audit) {
    const result = await originalSaveAuditDB(audit);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalDeleteAudit = deleteAudit;
deleteAudit = async function(id) {
    const result = await originalDeleteAudit(id);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalMarkAuditConverted = markAuditConverted;
markAuditConverted = async function(auditId, actionId) {
    const result = await originalMarkAuditConverted(auditId, actionId);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalSaveActionDB = saveActionDB;
saveActionDB = async function(action) {
    const result = await originalSaveActionDB(action);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalSetActionStatus = setActionStatus;
setActionStatus = async function(id, status) {
    const result = await originalSetActionStatus(id, status);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

const originalDeleteAction = deleteAction;
deleteAction = async function(id) {
    const result = await originalDeleteAction(id);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

// "Clear All Data" is deliberate, so it may empty the backup — but the copy it
// replaces is rolled into the previous slot first, so it stays undoable from
// the Data Safety screen.
const originalClearAllData = clearAllData;
clearAllData = async function() {
    const existing = readBackupSlot(BACKUP_CURRENT_KEY);
    if (!backupIsEmpty(existing)) {
        hybridStorage.persist(BACKUP_PREVIOUS_KEY, existing);
    }
    const result = await originalClearAllData();
    await hybridStorage.mirrorToLocalStorage({ allowEmpty: true });
    return result;
};

// Fallback initialiser. initializeApp() normally does this itself, immediately
// after opening the database and before any seeding, so the restore always wins
// the race against the first write. init() is idempotent, so this is harmless.
document.addEventListener('DOMContentLoaded', async () => {
    const waitForDB = setInterval(async () => {
        if (db) {
            clearInterval(waitForDB);
            await hybridStorage.init(db);
        }
    }, 100);
});
