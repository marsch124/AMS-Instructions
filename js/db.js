const DB_NAME = 'AMSInstructions';
const DB_VERSION = 1;
const STORE_INSTRUCTIONS = 'instructions';
const STORE_SETTINGS = 'settings';
const STORE_RECENT = 'recent';
const STORE_FAVORITES = 'favorites';

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

    // Initialize missing fields with defaults
    if (!instruction.createdAt) {
        instruction.createdAt = Date.now();
        instruction.revisionHistory = [{
            version: 1,
            timestamp: Date.now(),
            author: instruction.owner || 'System',
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
            author: instruction.owner || 'System',
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
        const request = store.add({
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

async function exportData() {
    const instructions = await getAllInstructions();
    const favorites = await getFavorites();
    return {
        version: 1,
        timestamp: new Date().toISOString(),
        instructions,
        favorites
    };
}

async function importData(data) {
    const tx = db.transaction([STORE_INSTRUCTIONS, STORE_FAVORITES], 'readwrite');

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

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        } catch (error) {
            reject(error);
        }
    });
}

async function clearAllData() {
    return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_INSTRUCTIONS, STORE_RECENT, STORE_FAVORITES, STORE_SETTINGS], 'readwrite');

        tx.objectStore(STORE_INSTRUCTIONS).clear();
        tx.objectStore(STORE_RECENT).clear();
        tx.objectStore(STORE_FAVORITES).clear();
        tx.objectStore(STORE_SETTINGS).clear();

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
            await navigator.serviceWorker.register('sw.js');
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
}
