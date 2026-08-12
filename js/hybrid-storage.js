// Hybrid Storage Layer - Works across Safari and Home Screen App on iOS
// This synchronizes IndexedDB with localStorage for cross-context access

const HYBRID_STORAGE_KEY = 'ams_instructions_hybrid';

class HybridStorage {
    constructor() {
        this.db = null;
        this.initialized = false;
    }

    async init(database) {
        this.db = database;
        this.initialized = true;
        console.log('[HybridStorage] Initialized');
        
        // Check if we need to sync from localStorage
        await this.syncFromLocalStorage();
    }

    // Sync stored data to IndexedDB from localStorage
    async syncFromLocalStorage() {
        try {
            const stored = localStorage.getItem(HYBRID_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                if (data.instructions && data.instructions.length > 0) {
                    const dbInstructions = await getAllInstructions();
                    
                    // If DB is empty but localStorage has data, restore it
                    if (dbInstructions.length === 0) {
                        console.log('[HybridStorage] Restoring from localStorage...');
                        for (const instruction of data.instructions) {
                            await saveInstructionDB(instruction);
                        }
                        console.log('[HybridStorage] Restored ' + data.instructions.length + ' instructions');
                    }
                }
            }
        } catch (error) {
            console.error('[HybridStorage] Sync from localStorage failed:', error);
        }
    }

    // Mirror data to localStorage
    async mirrorToLocalStorage() {
        try {
            const allInstructions = await getAllInstructions();
            const favorites = await getFavorites();
            
            const data = {
                instructions: allInstructions,
                favorites: favorites,
                timestamp: new Date().toISOString(),
                version: APP_VERSION
            };
            
            localStorage.setItem(HYBRID_STORAGE_KEY, JSON.stringify(data));
            console.log('[HybridStorage] Mirrored ' + allInstructions.length + ' instructions to localStorage');
        } catch (error) {
            console.error('[HybridStorage] Mirror to localStorage failed:', error);
        }
    }
}

const hybridStorage = new HybridStorage();

// Override saveInstructionDB to also mirror to localStorage
const originalSaveInstructionDB = saveInstructionDB;
saveInstructionDB = async function(instruction) {
    const result = await originalSaveInstructionDB(instruction);
    await hybridStorage.mirrorToLocalStorage();
    return result;
};

// Initialize on app ready
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for DB to be initialized
    const waitForDB = setInterval(async () => {
        if (db) {
            clearInterval(waitForDB);
            await hybridStorage.init(db);
        }
    }, 100);
});
