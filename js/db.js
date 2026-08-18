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

// How many "who did it" entries an instruction keeps. Twenty is several years
// of an annual job and a season of a weekly one — long enough to answer "was it
// me or you last time", short enough that the log never becomes the bulk of an
// instruction, which would matter: instructions travel whole inside every backup.
const DONE_LOG_LIMIT = 20;

// Bare completion update — no revision history entry (see Mark Done bug, v11 plan)
//
// `person` is optional. Marking something done without saying who still records
// the completion, because the date is worth having on its own; the entry simply
// carries no name. The name is stored alongside the id so a completion still
// reads properly after that person has been deleted from People.
async function recordCompletion(instruction, person) {
    instruction.completionCount = (instruction.completionCount || 0) + 1;
    instruction.lastCompleted = Date.now();

    const entry = {
        at: instruction.lastCompleted,
        byId: person ? person.id : null,
        byName: person ? person.name : ''
    };

    // Newest first, so the head of the list is "who did it last" without a sort.
    instruction.completionLog = [entry, ...(instruction.completionLog || [])]
        .slice(0, DONE_LOG_LIMIT);

    const tx = db.transaction(STORE_INSTRUCTIONS, 'readwrite');
    const store = tx.objectStore(STORE_INSTRUCTIONS);

    return new Promise((resolve, reject) => {
        const request = store.put(instruction);
        request.onsuccess = () => resolve(instruction);
        request.onerror = () => reject(request.error);
    });
}

// Put a different name on the most recent completion — the "actually, that was
// Anna" correction offered straight after marking something done. Deliberately
// touches nothing else: no second completion is recorded, the count does not
// move, and an instruction with no log is left alone rather than given one.
async function amendLastCompletion(instruction, person) {
    const log = instruction.completionLog || [];
    if (log.length === 0) return instruction;

    log[0] = {
        at: log[0].at,
        byId: person ? person.id : null,
        byName: person ? person.name : ''
    };
    instruction.completionLog = log;

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

// ---------------------------------------------------------------------------
// Checking a backup — by actually restoring it, somewhere harmless.
//
// Twice now a safety net in this app turned out to have been dead from the day
// it was written, and both times it was only discovered when it was needed. So
// this does not inspect a backup and pronounce it healthy: it opens a second,
// throwaway database with exactly the same shape as the real one, restores the
// backup into it, counts what came back, and throws the database away. What it
// reports is what a real restore would actually do.
//
// The unique index on `number` is the point of doing it for real: two
// instructions sharing a number abort the whole import in one go, and that is
// invisible to any amount of counting.
// ---------------------------------------------------------------------------

const VERIFY_DB_NAME = 'ams-instructions-verify';

function deleteVerifyDatabase() {
    return new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(VERIFY_DB_NAME);
        // A blocked delete is not worth failing a check over — the next run
        // deletes it first anyway. Resolve either way.
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
    });
}

function openVerifyDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(VERIFY_DB_NAME, 1);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            // Same stores and — crucially — the same unique index as the real
            // database, or the rehearsal would be easier than the performance.
            const instructionsStore = database.createObjectStore(STORE_INSTRUCTIONS, { keyPath: 'id' });
            instructionsStore.createIndex('number', 'number', { unique: true });
            instructionsStore.createIndex('category', 'category', { unique: false });
            database.createObjectStore(STORE_FAVORITES, { keyPath: 'id' });
            database.createObjectStore(STORE_PEOPLE, { keyPath: 'id' });
            database.createObjectStore(STORE_AUDITS, { keyPath: 'id' });
            database.createObjectStore(STORE_ACTIONS, { keyPath: 'id' });
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function countStore(database, storeName) {
    return new Promise((resolve, reject) => {
        const request = database.transaction(storeName, 'readonly').objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Restores `data` into the throwaway database and reports what arrived. Always
// cleans up after itself, including when the restore fails — which is the case
// that matters most, since that is when something is actually wrong.
async function dryRunRestore(data) {
    await deleteVerifyDatabase();

    let database = null;
    try {
        database = await openVerifyDatabase();

        await new Promise((resolve, reject) => {
            const tx = database.transaction(
                [STORE_INSTRUCTIONS, STORE_FAVORITES, STORE_PEOPLE, STORE_AUDITS, STORE_ACTIONS],
                'readwrite'
            );

            // An aborted transaction reports no error of its own — the useful one
            // belongs to the request that failed, and is only reachable while it
            // bubbles past. Caught here so the report can say what went wrong
            // rather than the word "null".
            let firstError = null;
            tx.addEventListener('error', (event) => {
                if (!firstError && event.target) firstError = event.target.error;
            }, true);

            // Deliberately the same writes, in the same single transaction, as
            // importData(). If this diverges from importData, the check stops
            // being a rehearsal of anything.
            (data.instructions || []).forEach(item => tx.objectStore(STORE_INSTRUCTIONS).put(item));
            (data.favorites || []).forEach(id => tx.objectStore(STORE_FAVORITES).put({ id, favorited: true }));
            (data.people || []).forEach(item => tx.objectStore(STORE_PEOPLE).put(item));
            (data.audits || []).forEach(item => tx.objectStore(STORE_AUDITS).put(item));
            (data.actions || []).forEach(item => tx.objectStore(STORE_ACTIONS).put(item));

            const failure = () => reject(firstError || tx.error ||
                new Error('the restore was stopped part-way through'));

            tx.oncomplete = () => resolve();
            tx.onerror = failure;
            tx.onabort = failure;
        });

        return {
            instructions: await countStore(database, STORE_INSTRUCTIONS),
            favorites: await countStore(database, STORE_FAVORITES),
            people: await countStore(database, STORE_PEOPLE),
            audits: await countStore(database, STORE_AUDITS),
            actions: await countStore(database, STORE_ACTIONS)
        };
    } finally {
        if (database) database.close();
        await deleteVerifyDatabase();
    }
}

function countPhotos(instructions) {
    let total = 0;
    let broken = 0;

    instructions.forEach(instruction => {
        (instruction.photos || []).forEach(photo => {
            total++;
            // A photo is a data: URI. Anything else is a photo that will come
            // back as a blank square — which looks like the app's fault later.
            if (!photo || typeof photo.data !== 'string' || !photo.data.startsWith('data:')) broken++;
        });
    });

    return { total, broken };
}

// The whole check: what is in the file, what is wrong with it, and what a real
// restore would actually put back. `problems` is written to be read by somebody
// who has no interest in databases.
async function verifyBackup(data) {
    const problems = [];

    if (!data || typeof data !== 'object') {
        return { readable: false, problems: ['This file is not a backup the app can read.'] };
    }

    if (!Array.isArray(data.instructions)) {
        return { readable: false, problems: ['This file has no list of instructions in it at all.'] };
    }

    const instructions = data.instructions;

    if (instructions.length === 0) {
        problems.push('This backup contains no instructions. Restoring it would put nothing back.');
    }

    const seenNumbers = new Map();
    const duplicates = new Set();
    let missingFields = 0;

    instructions.forEach(instruction => {
        if (!instruction || !instruction.id || !instruction.number || !instruction.title) {
            missingFields++;
            return;
        }
        if (seenNumbers.has(instruction.number)) duplicates.add(instruction.number);
        seenNumbers.set(instruction.number, true);
    });

    if (missingFields > 0) {
        problems.push(missingFields + (missingFields === 1
            ? ' instruction is missing its number, title or identity, and would come back damaged.'
            : ' instructions are missing their number, title or identity, and would come back damaged.'));
    }

    if (duplicates.size > 0) {
        const list = [...duplicates].sort().join(', ');
        problems.push('Two instructions share the same number (' + list +
            '). A number has to be unique, so this would stop the whole restore.');
    }

    const photos = countPhotos(instructions);
    if (photos.broken > 0) {
        problems.push(photos.broken + (photos.broken === 1
            ? ' photo is damaged and would come back blank.'
            : ' photos are damaged and would come back blank.'));
    }

    const counts = {
        instructions: instructions.length,
        people: (data.people || []).length,
        audits: (data.audits || []).length,
        actions: (data.actions || []).length,
        favorites: (data.favorites || []).length,
        photos: photos.total,
        timestamp: data.timestamp || null
    };

    let restored = null;
    try {
        restored = await dryRunRestore(data);
    } catch (error) {
        problems.push('A test restore of this backup failed: ' + (error && error.message ? error.message : error));
        return { readable: true, restorable: false, counts, restored: null, problems };
    }

    if (restored.instructions !== instructions.length) {
        problems.push('A test restore put back ' + restored.instructions + ' of ' +
            instructions.length + ' instructions.');
    }

    return {
        readable: true,
        // A backup that restores everything it holds passes, even if it is a
        // backup of very little — an empty backup is reported as a problem
        // above rather than pretended to be a success.
        restorable: restored.instructions === instructions.length && instructions.length > 0,
        counts,
        restored,
        problems
    };
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
            await navigator.serviceWorker.register('/AMS-Instructions/sw.js?v=' + APP_VERSION + '&t=1787075583-02569d81', {
                scope: '/AMS-Instructions/'
            });
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}
