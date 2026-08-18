const DB_NAME = 'AMSInstructions';
const DB_VERSION = 2;
const STORE_INSTRUCTIONS = 'instructions';
const STORE_SETTINGS = 'settings';
const STORE_RECENT = 'recent';
const STORE_FAVORITES = 'favorites';
const STORE_PEOPLE = 'people';
const STORE_AUDITS = 'audits';
const STORE_ACTIONS = 'actions';

let db = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Instructions store
            if (!database.objectStoreNames.contains(STORE_INSTRUCTIONS)) {
                const instructionsStore = database.createObjectStore(STORE_INSTRUCTIONS, { keyPath: 'id' });
                instructionsStore.createIndex('number', 'number', { unique: true });
                instructionsStore.createIndex('category', 'category', { unique: false });
            }

            // Settings store
            if (!database.objectStoreNames.contains(STORE_SETTINGS)) {
                database.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
            }

            // Recent store
            if (!database.objectStoreNames.contains(STORE_RECENT)) {
                database.createObjectStore(STORE_RECENT, { keyPath: 'id', autoIncrement: true });
            }

            // Favorites store
            if (!database.objectStoreNames.contains(STORE_FAVORITES)) {
                database.createObjectStore(STORE_FAVORITES, { keyPath: 'id' });
            }

            // People store
            if (!database.objectStoreNames.contains(STORE_PEOPLE)) {
                database.createObjectStore(STORE_PEOPLE, { keyPath: 'id' });
            }

            // Audits store
            if (!database.objectStoreNames.contains(STORE_AUDITS)) {
                database.createObjectStore(STORE_AUDITS, { keyPath: 'id' });
            }

            // Actions store
            if (!database.objectStoreNames.contains(STORE_ACTIONS)) {
                database.createObjectStore(STORE_ACTIONS, { keyPath: 'id' });
            }
        };
    });
}

async function getInstruction(number) {
    const tx = db.transaction(STORE_INSTRUCTIONS, 'readonly');
    const store = tx.objectStore(STORE_INSTRUCTIONS);
    const index = store.index('number');

    return new Promise((resolve, reject) => {
        const request = index.get(number.toString().padStart(3, '0'));
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function getAllInstructions() {
    const tx = db.transaction(STORE_INSTRUCTIONS, 'readonly');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveInstructionDB(instruction) {
    instruction.number = instruction.number.toString().padStart(3, '0');

    const authorId = instruction.revisedById || null;
    const authorName = instruction.revisedByName || instruction.owner || 'System';
    delete instruction.revisedById;
    delete instruction.revisedByName;

    // Initialize missing fields with defaults
    if (!instruction.createdAt) {
        instruction.createdAt = Date.now();
        instruction.revisionHistory = [{
            version: 1,
            timestamp: Date.now(),
            authorId,
            authorName,
            changes: 'Created'
        }];
    } else {
        // Add to revision history
        if (!instruction.revisionHistory) {
            instruction.revisionHistory = [];
        }
        const lastVersion = instruction.revisionHistory[instruction.revisionHistory.length - 1];
        const newVersion = (lastVersion?.version || 0) + 1;
        instruction.revisionHistory.push({
            version: newVersion,
            timestamp: Date.now(),
            authorId,
            authorName,
            changes: instruction.lastChanges || 'Updated'
        });
        delete instruction.lastChanges;
    }

    // Auto-populate status based on completeness
    if (!instruction.status || instruction.status === 'Auto') {
        instruction.status = calculateStatus(instruction);
    }

    const tx = db.transaction(STORE_INSTRUCTIONS, 'readwrite');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        const request = store.put(instruction);
        request.onsuccess = () => resolve(instruction);
        request.onerror = () => reject(request.error);
    });
}

// Bare completion update — no revision history entry (see Mark Done bug, v11 plan)
async function recordCompletion(instruction) {
    instruction.completionCount = (instruction.completionCount || 0) + 1;
    instruction.lastCompleted = Date.now();

    const tx = db.transaction(STORE_INSTRUCTIONS, 'readwrite');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        const request = store.put(instruction);
        request.onsuccess = () => resolve(instruction);
        request.onerror = () => reject(request.error);
    });
}

// Writes a batch of instructions in one transaction, WITHOUT touching revision
// history. Setting the owner on two hundred instructions at once would otherwise
// write two hundred "Updated" entries and bury the real edits under bookkeeping.
// Everything goes in one transaction so a bulk fix either lands or doesn't.
async function bulkUpdateInstructions(instructions) {
    if (instructions.length === 0) return 0;

    const tx = db.transaction(STORE_INSTRUCTIONS, 'readwrite');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        instructions.forEach(instruction => store.put(instruction));
        tx.oncomplete = () => resolve(instructions.length);
        tx.onerror = () => reject(tx.error);
    });
}

// How long an instruction stays done before it comes round again.
//
// Only the frequencies that describe a clock appear here. "Before each trip",
// "Every session" and "As-needed" are triggered by an event, not by a date, so
// they can never fall due and are deliberately absent rather than guessed at.
const FREQUENCY_DAYS = {
    'Daily': 1,
    'Weekly': 7,
    'Monthly': 30,
    'Seasonally': 91,
    'Yearly': 365
};

const DAY_MS = 24 * 60 * 60 * 1000;

// When an instruction next falls due, or null if it never can.
//
// An instruction that has never been marked Done has no clock to start from, so
// it is NOT due. That is a deliberate choice: the starter library is 205
// instructions with frequencies and no completions, and treating those as
// overdue would bury the Home screen under a hundred red items on day one.
// Never-done instructions are still worth surfacing, but somewhere quieter.
function nextDueAt(instruction) {
    if (!instruction || !instruction.lastCompleted) return null;
    if (instruction.status === 'Archived') return null;

    const days = FREQUENCY_DAYS[instruction.frequency];
    if (!days) return null;

    return instruction.lastCompleted + days * DAY_MS;
}

// Everything that has fallen due, most overdue first. Filtered in memory like
// getOpenActions() — a couple of hundred rows is nothing to sift through here,
// and it avoids an index that would have to be kept in step with completions.
async function getDueInstructions() {
    const instructions = await getAllInstructions();
    const now = Date.now();

    return instructions
        .map(instruction => ({ instruction, dueAt: nextDueAt(instruction) }))
        .filter(entry => entry.dueAt !== null && entry.dueAt <= now)
        .sort((a, b) => a.dueAt - b.dueAt);
}

function calculateStatus(instruction) {
    const hasCore = instruction.title && instruction.description && instruction.steps?.length > 0;
    const hasDetails = instruction.frequency && instruction.timeEstimate && instruction.owner;
    const hasSafety = instruction.warnings && instruction.warnings.trim().length > 0;
    const isComplete = hasCore && hasDetails && hasSafety;

    if (!hasCore) return 'Draft';
    if (isComplete) return 'Active';
    return 'Review Needed';
}

async function deleteInstruction(id) {
    const tx = db.transaction(STORE_INSTRUCTIONS, 'readwrite');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function addToRecent(instruction) {
    const tx = db.transaction(STORE_RECENT, 'readwrite');
    const store = tx.objectStore(STORE_RECENT);

    return new Promise((resolve, reject) => {
        const request = store.put({
            id: instruction.id,
            number: instruction.number,
            title: instruction.title,
            category: instruction.category,
            timestamp: Date.now()
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getRecent(limit = 5) {
    const tx = db.transaction(STORE_RECENT, 'readonly');
    const store = tx.objectStore(STORE_RECENT);

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => {
            const recent = request.result
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, limit);
            resolve(recent);
        };
        request.onerror = () => reject(request.error);
    });
}

async function clearRecent() {
    const tx = db.transaction(STORE_RECENT, 'readwrite');
    const store = tx.objectStore(STORE_RECENT);

    return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function addToFavorites(id) {
    const tx = db.transaction(STORE_FAVORITES, 'readwrite');
    const store = tx.objectStore(STORE_FAVORITES);

    return new Promise((resolve, reject) => {
        const request = store.put({ id, favorited: true });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function removeFromFavorites(id) {
    const tx = db.transaction(STORE_FAVORITES, 'readwrite');
    const store = tx.objectStore(STORE_FAVORITES);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function isFavorited(id) {
    const tx = db.transaction(STORE_FAVORITES, 'readonly');
    const store = tx.objectStore(STORE_FAVORITES);

    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(!!request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getFavorites() {
    const tx = db.transaction(STORE_FAVORITES, 'readonly');
    const store = tx.objectStore(STORE_FAVORITES);

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.map(fav => fav.id));
        request.onerror = () => reject(request.error);
    });
}

async function savePersonDB(person) {
    if (!person.id) {
        person.id = 'person_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
    if (!person.createdAt) {
        person.createdAt = Date.now();
    }
    person.updatedAt = Date.now();

    const tx = db.transaction(STORE_PEOPLE, 'readwrite');
    const store = tx.objectStore(STORE_PEOPLE);

    return new Promise((resolve, reject) => {
        const request = store.put(person);
        request.onsuccess = () => resolve(person);
        request.onerror = () => reject(request.error);
    });
}

async function getAllPeople() {
    return getAllFromStore(STORE_PEOPLE);
}

// Small named values that belong to the app rather than to the library — at the
// moment, just the snapshot behind "Undo last bulk change".
//
// Deliberately in IndexedDB rather than localStorage: localStorage is where the
// photo-heavy safety mirror lives, and its budget is not something to spend on
// anything that can live elsewhere. Just as deliberately outside exportData(),
// so a half-undone change never travels inside a backup file — and inside
// clearAllData()'s store list, so wiping the app doesn't leave an undo pointing
// at instructions that no longer exist.
async function saveSetting(key, value) {
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve, reject) => {
        const request = store.put({ ...value, key });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getSetting(key) {
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function deleteSetting(key) {
    const tx = db.transaction(STORE_SETTINGS, 'readwrite');
    const store = tx.objectStore(STORE_SETTINGS);

    return new Promise((resolve, reject) => {
        const request = store.delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

const PEOPLE_SEEDED_KEY = 'ams_people_seeded';
const DEFAULT_PEOPLE = ['Anna', 'Martin'];

// Give the People list a starting point, so the Owner / Revised by / Audited by
// pickers aren't empty the first time they're opened. Runs once ever, and only
// when the list is genuinely empty — deleting a seeded person won't bring them back.
async function seedDefaultPeople() {
    if (localStorage.getItem(PEOPLE_SEEDED_KEY)) return;

    const existing = await getAllPeople();
    if (existing.length === 0) {
        for (const name of DEFAULT_PEOPLE) {
            await savePersonDB({ name, phone: '', email: '', handles: [] });
        }
    }

    localStorage.setItem(PEOPLE_SEEDED_KEY, '1');
}

async function getPerson(id) {
    if (!id) return null;
    const tx = db.transaction(STORE_PEOPLE, 'readonly');
    const store = tx.objectStore(STORE_PEOPLE);

    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function deletePerson(id) {
    const tx = db.transaction(STORE_PEOPLE, 'readwrite');
    const store = tx.objectStore(STORE_PEOPLE);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function saveAuditDB(audit) {
    if (!audit.id) {
        audit.id = 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
    if (!audit.createdAt) {
        audit.createdAt = Date.now();
    }

    const tx = db.transaction(STORE_AUDITS, 'readwrite');
    const store = tx.objectStore(STORE_AUDITS);

    return new Promise((resolve, reject) => {
        const request = store.put(audit);
        request.onsuccess = () => resolve(audit);
        request.onerror = () => reject(request.error);
    });
}

async function getAllAudits() {
    return getAllFromStore(STORE_AUDITS);
}

async function getAuditsForInstruction(instructionId) {
    const audits = await getAllAudits();
    return audits
        .filter(a => a.instructionId === instructionId)
        .sort((a, b) => b.timestamp - a.timestamp);
}

async function deleteAudit(id) {
    const tx = db.transaction(STORE_AUDITS, 'readwrite');
    const store = tx.objectStore(STORE_AUDITS);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Link an audit finding to the action it produced, so the same finding can't be
// converted twice. Read-modify-write in one transaction; a missing audit is a no-op.
async function markAuditConverted(auditId, actionId) {
    const tx = db.transaction(STORE_AUDITS, 'readwrite');
    const store = tx.objectStore(STORE_AUDITS);

    return new Promise((resolve, reject) => {
        const getRequest = store.get(auditId);
        getRequest.onsuccess = () => {
            const audit = getRequest.result;
            if (!audit) {
                resolve(null);
                return;
            }
            audit.convertedToActionId = actionId;
            const putRequest = store.put(audit);
            putRequest.onsuccess = () => resolve(audit);
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function saveActionDB(action) {
    if (!action.id) {
        action.id = 'action_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
    if (!action.createdAt) {
        action.createdAt = Date.now();
    }
    if (!action.status) {
        action.status = 'open';
    }

    const tx = db.transaction(STORE_ACTIONS, 'readwrite');
    const store = tx.objectStore(STORE_ACTIONS);

    return new Promise((resolve, reject) => {
        const request = store.put(action);
        request.onsuccess = () => resolve(action);
        request.onerror = () => reject(request.error);
    });
}

async function getAllActions() {
    return getAllFromStore(STORE_ACTIONS);
}

async function getAction(id) {
    if (!id) return null;
    const tx = db.transaction(STORE_ACTIONS, 'readonly');
    const store = tx.objectStore(STORE_ACTIONS);

    return new Promise((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

// Open actions, most pressing first: high priority, then soonest due
// (undated last), then oldest. Client-side like favorites/recent — dozens of rows.
async function getOpenActions() {
    const actions = await getAllActions();
    return actions
        .filter(a => a.status !== 'done')
        .sort((a, b) => {
            const priorityA = a.priority === 'high' ? 0 : 1;
            const priorityB = b.priority === 'high' ? 0 : 1;
            if (priorityA !== priorityB) return priorityA - priorityB;

            const dueA = a.dueDate ? new Date(a.dueDate + 'T00:00:00').getTime() : Infinity;
            const dueB = b.dueDate ? new Date(b.dueDate + 'T00:00:00').getTime() : Infinity;
            if (dueA !== dueB) return dueA - dueB;

            return a.createdAt - b.createdAt;
        });
}

async function getDoneActions() {
    const actions = await getAllActions();
    return actions
        .filter(a => a.status === 'done')
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
}

async function setActionStatus(id, status) {
    const tx = db.transaction(STORE_ACTIONS, 'readwrite');
    const store = tx.objectStore(STORE_ACTIONS);

    return new Promise((resolve, reject) => {
        const getRequest = store.get(id);
        getRequest.onsuccess = () => {
            const action = getRequest.result;
            if (!action) {
                resolve(null);
                return;
            }
            action.status = status;
            action.completedAt = status === 'done' ? Date.now() : null;
            const putRequest = store.put(action);
            putRequest.onsuccess = () => resolve(action);
            putRequest.onerror = () => reject(putRequest.error);
        };
        getRequest.onerror = () => reject(getRequest.error);
    });
}

async function completeAction(id) {
    return setActionStatus(id, 'done');
}

async function reopenAction(id) {
    return setActionStatus(id, 'open');
}

async function deleteAction(id) {
    const tx = db.transaction(STORE_ACTIONS, 'readwrite');
    const store = tx.objectStore(STORE_ACTIONS);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getAllFromStore(storeName) {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function exportData() {
    const instructions = await getAllInstructions();
    const favorites = await getFavorites();
    const people = await getAllFromStore(STORE_PEOPLE);
    const audits = await getAllFromStore(STORE_AUDITS);
    const actions = await getAllFromStore(STORE_ACTIONS);
    return {
        version: 1,
        timestamp: new Date().toISOString(),
        instructions,
        favorites,
        people,
        audits,
        actions
    };
}

async function importData(data) {
    const tx = db.transaction([STORE_INSTRUCTIONS, STORE_FAVORITES, STORE_PEOPLE, STORE_AUDITS, STORE_ACTIONS], 'readwrite');

    return new Promise((resolve, reject) => {
        try {
            if (data.instructions && Array.isArray(data.instructions)) {
                const instStore = tx.objectStore(STORE_INSTRUCTIONS);
                data.instructions.forEach(inst => instStore.put(inst));
            }

            if (data.favorites && Array.isArray(data.favorites)) {
                const favStore = tx.objectStore(STORE_FAVORITES);
                data.favorites.forEach(favId => favStore.put({ id: favId, favorited: true }));
            }

            if (data.people && Array.isArray(data.people)) {
                const peopleStore = tx.objectStore(STORE_PEOPLE);
                data.people.forEach(person => peopleStore.put(person));
            }

            if (data.audits && Array.isArray(data.audits)) {
                const auditsStore = tx.objectStore(STORE_AUDITS);
                data.audits.forEach(audit => auditsStore.put(audit));
            }

            if (data.actions && Array.isArray(data.actions)) {
                const actionsStore = tx.objectStore(STORE_ACTIONS);
                data.actions.forEach(action => actionsStore.put(action));
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        } catch (error) {
            reject(error);
        }
    });
}

async function clearAllData() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_INSTRUCTIONS, STORE_RECENT, STORE_FAVORITES, STORE_SETTINGS, STORE_AUDITS, STORE_ACTIONS], 'readwrite');

        tx.objectStore(STORE_INSTRUCTIONS).clear();
        tx.objectStore(STORE_RECENT).clear();
        tx.objectStore(STORE_FAVORITES).clear();
        tx.objectStore(STORE_SETTINGS).clear();
        tx.objectStore(STORE_AUDITS).clear();
        tx.objectStore(STORE_ACTIONS).clear();
        // STORE_PEOPLE intentionally not cleared — contacts are configuration, not data-to-nuke

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getDBSize() {
    if (!navigator.storage || !navigator.storage.estimate) {
        return 'Unknown';
    }

    try {
        const estimate = await navigator.storage.estimate();
        const usage = estimate.usage || 0;
        const mb = (usage / 1024 / 1024).toFixed(2);
        return `${mb} MB`;
    } catch {
        return 'Unknown';
    }
}

// Register service worker
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            await navigator.serviceWorker.register('/AMS-Instructions/sw.js?v=' + APP_VERSION + '&t=1787059082-a5aca4a5', {
                scope: '/AMS-Instructions/'
            });
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}
