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
        person.id = 'person_' + Date.now();
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
            await navigator.serviceWorker.register('/AMS-Instructions/sw.js?v=' + APP_VERSION + '&t=1786615962-724b9ce8', {
                scope: '/AMS-Instructions/'
            });
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}
