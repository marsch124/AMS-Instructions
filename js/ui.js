const APP_VERSION = '1.0';
const CACHE_VERSION = 'v1';

let currentInstruction = null;
let allInstructions = [];

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.add('active');
    }
}

function showModal(title, message, callback) {
    const modal = document.getElementById('modal');
    const titleEl = document.getElementById('modalTitle');
    const messageEl = document.getElementById('modalMessage');
    const confirmBtn = document.getElementById('modalConfirm');
    const cancelBtn = document.getElementById('modalCancel');

    titleEl.textContent = title;
    messageEl.textContent = message;

    const handler = (confirmed) => {
        modal.hidden = true;
        confirmBtn.removeEventListener('click', confirm);
        cancelBtn.removeEventListener('click', cancel);
        if (callback) callback(confirmed);
    };

    const confirm = () => handler(true);
    const cancel = () => handler(false);

    confirmBtn.addEventListener('click', confirm);
    cancelBtn.addEventListener('click', cancel);

    modal.hidden = false;
}

async function navigateToInstruction(number) {
    const instruction = await getInstruction(number);

    if (!instruction) {
        alert('Instruction not found: ' + number);
        return;
    }

    currentInstruction = instruction;
    await addToRecent(instruction);
    displayInstruction(instruction);
    showScreen('instructionScreen');
}

function displayInstruction(instruction) {
    document.getElementById('instructionNumber').textContent = instruction.number;
    document.getElementById('instructionTitle').textContent = instruction.title;

    const categoryEl = document.getElementById('instructionCategory');
    categoryEl.textContent = instruction.category;
    categoryEl.className = 'category-badge ' + instruction.category.toLowerCase();

    const stepsList = document.getElementById('instructionSteps');
    stepsList.innerHTML = '';
    instruction.steps.forEach(step => {
        const li = document.createElement('li');
        li.textContent = step;
        stepsList.appendChild(li);
    });

    // Check if favorited
    isFavorited(instruction.id).then(favorited => {
        const btn = document.getElementById('favoriteBtn');
        if (favorited) {
            btn.textContent = '★';
            btn.classList.add('favorited');
        } else {
            btn.textContent = '☆';
            btn.classList.remove('favorited');
        }
    });
}

async function toggleFavorite() {
    if (!currentInstruction) return;

    const isFav = await isFavorited(currentInstruction.id);

    if (isFav) {
        await removeFromFavorites(currentInstruction.id);
    } else {
        await addToFavorites(currentInstruction.id);
    }

    displayInstruction(currentInstruction);
    await renderHomeScreen();
}

async function renderHomeScreen() {
    // Render favorites
    const favorites = await getFavorites();
    const instructions = await getAllInstructions();
    const favoritesList = document.getElementById('favoritesList');

    if (favorites.length === 0) {
        favoritesList.innerHTML = '<p class="empty-state">No favorites yet. Tap ★ on an instruction to add.</p>';
    } else {
        favoritesList.innerHTML = '';
        for (const id of favorites) {
            const instr = instructions.find(i => i.id === id);
            if (instr) {
                const card = createInstructionCard(instr);
                card.addEventListener('click', () => navigateToInstruction(instr.number));
                favoritesList.appendChild(card);
            }
        }
    }

    // Render recent
    const recent = await getRecent(5);
    const recentList = document.getElementById('recentList');

    if (recent.length === 0) {
        recentList.innerHTML = '<p class="empty-state">Scanned instructions appear here.</p>';
    } else {
        recentList.innerHTML = '';
        recent.forEach(item => {
            const card = createInstructionCard(item);
            card.addEventListener('click', () => navigateToInstruction(item.number));
            recentList.appendChild(card);
        });
    }

    allInstructions = instructions;
}

function createInstructionCard(instruction) {
    const card = document.createElement('div');
    card.className = 'instruction-card ' + instruction.category.toLowerCase();

    const number = document.createElement('div');
    number.className = 'instruction-card-number';
    number.textContent = instruction.number;

    const textDiv = document.createElement('div');
    textDiv.className = 'instruction-card-text';

    const title = document.createElement('div');
    title.className = 'instruction-card-title';
    title.textContent = instruction.title;

    const category = document.createElement('div');
    category.className = 'instruction-card-category';
    category.textContent = instruction.category;

    textDiv.appendChild(title);
    textDiv.appendChild(category);

    card.appendChild(number);
    card.appendChild(textDiv);

    return card;
}

async function renderInstructionsList(filter = '') {
    const list = document.getElementById('instructionsList');
    const instructions = await getAllInstructions();

    const filtered = instructions.filter(i =>
        i.title.toLowerCase().includes(filter.toLowerCase()) ||
        i.number.includes(filter) ||
        i.category.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
        list.innerHTML = '<p class="empty-state">No instructions found.</p>';
        return;
    }

    list.innerHTML = '';
    filtered.forEach(instr => {
        const item = document.createElement('div');
        item.className = 'list-item';

        const info = document.createElement('div');
        info.className = 'list-item-info';
        info.addEventListener('click', () => navigateToInstruction(instr.number));

        const numberEl = document.createElement('div');
        numberEl.className = 'list-item-number';
        numberEl.textContent = instr.number;

        const titleEl = document.createElement('div');
        titleEl.className = 'list-item-title';
        titleEl.textContent = instr.title;

        const categoryEl = document.createElement('div');
        categoryEl.className = 'list-item-category';
        categoryEl.textContent = instr.category;

        info.appendChild(numberEl);
        info.appendChild(titleEl);
        info.appendChild(categoryEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'list-item-edit';
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editInstruction(instr);
        });

        item.appendChild(info);
        item.appendChild(editBtn);
        list.appendChild(item);
    });
}

function editInstruction(instruction) {
    document.getElementById('editorTitle').textContent = 'Edit Instruction';
    document.getElementById('editorNumber').value = instruction.number;
    document.getElementById('editorName').value = instruction.title;
    document.getElementById('editorCategory').value = instruction.category;
    document.getElementById('editorSteps').value = instruction.steps.join('\n');

    const deleteBtn = document.getElementById('deleteEditorBtn');
    deleteBtn.style.display = 'block';
    deleteBtn.onclick = () => {
        showModal('Delete Instruction', `Delete "${instruction.title}"?`, async (confirmed) => {
            if (confirmed) {
                await deleteInstruction(instruction.id);
                await renderInstructionsList();
                showScreen('instructionsListScreen');
            }
        });
    };

    window.currentEditingId = instruction.id;
    showScreen('editorScreen');
}

function resetEditor() {
    document.getElementById('editorTitle').textContent = 'New Instruction';
    document.getElementById('editorNumber').value = '';
    document.getElementById('editorName').value = '';
    document.getElementById('editorCategory').value = 'General';
    document.getElementById('editorSteps').value = '';
    document.getElementById('deleteEditorBtn').style.display = 'none';
    window.currentEditingId = null;
}

async function handleSaveInstruction() {
    const number = document.getElementById('editorNumber').value.padStart(3, '0');
    const title = document.getElementById('editorName').value.trim();
    const category = document.getElementById('editorCategory').value;
    const stepsText = document.getElementById('editorSteps').value.trim();

    if (!number || !title || !stepsText) {
        alert('Please fill in all fields');
        return;
    }

    const steps = stepsText.split('\n').map(s => s.trim()).filter(s => s);

    const instruction = {
        id: window.currentEditingId || 'instr_' + Date.now(),
        number,
        title,
        category,
        steps
    };

    await saveInstructionDB(instruction);
    resetEditor();
    await renderInstructionsList();
    showScreen('instructionsListScreen');
}

async function initializeApp() {
    document.getElementById('versionNumber').textContent = APP_VERSION;
    document.getElementById('homeVersion').textContent = 'v' + APP_VERSION;

    // Event listeners for navigation
    document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settingsScreen'));
    document.getElementById('backFromSettingsBtn').addEventListener('click', async () => {
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('scanBtn').addEventListener('click', async () => {
        await loadQRLibrary();
        showScreen('scanScreen');
        setTimeout(() => {
            startQRScanning((number, error) => {
                stopQRScanning();
                if (error) {
                    alert(error);
                } else if (number) {
                    navigateToInstruction(number);
                }
            });
        }, 100);
    });

    document.getElementById('backFromScanBtn').addEventListener('click', () => {
        stopQRScanning();
        showScreen('homeScreen');
    });

    document.getElementById('manualSubmitBtn').addEventListener('click', () => {
        const number = document.getElementById('manualNumber').value.trim();
        if (number) {
            stopQRScanning();
            navigateToInstruction(number);
        }
    });

    document.getElementById('backFromInstructionBtn').addEventListener('click', async () => {
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('doneBtn').addEventListener('click', () => {
        // Visual feedback for completing a step
        document.getElementById('doneBtn').textContent = '✓ Done!';
        setTimeout(() => {
            document.getElementById('doneBtn').textContent = '✓ Mark Done';
        }, 1500);
    });

    document.getElementById('favoriteBtn').addEventListener('click', toggleFavorite);

    // Settings
    document.getElementById('allInstructionsBtn').addEventListener('click', async () => {
        await renderInstructionsList();
        showScreen('instructionsListScreen');
    });

    document.getElementById('addInstructionBtn').addEventListener('click', () => {
        resetEditor();
        showScreen('editorScreen');
    });

    document.getElementById('backFromListBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
        renderInstructionsList(e.target.value);
    });

    document.getElementById('backFromEditorBtn').addEventListener('click', async () => {
        await renderInstructionsList();
        showScreen('instructionsListScreen');
    });

    document.getElementById('saveBtn').addEventListener('click', handleSaveInstruction);

    document.getElementById('exportBtn').addEventListener('click', async () => {
        const data = await exportData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ams-instructions-' + new Date().toISOString().split('T')[0] + '.json';
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });

    document.getElementById('importFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                await importData(data);
                alert('Data imported successfully');
                await renderInstructionsList();
                showScreen('instructionsListScreen');
            } catch (error) {
                alert('Failed to import data: ' + error.message);
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('howItWorksBtn').addEventListener('click', () => {
        showScreen('howItWorksScreen');
    });

    document.getElementById('backFromHowBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('clearDataBtn').addEventListener('click', () => {
        showModal('Clear All Data', 'This will delete all instructions and settings. This cannot be undone.', async (confirmed) => {
            if (confirmed) {
                await clearAllData();
                await renderHomeScreen();
                showScreen('homeScreen');
                alert('All data cleared');
            }
        });
    });

    // Initialize DB and render home screen
    try {
        await initDB();
        await registerServiceWorker();
        await renderHomeScreen();
        showScreen('homeScreen');

        // Update DB size
        const size = await getDBSize();
        document.getElementById('dbSize').textContent = size;
    } catch (error) {
        console.error('Initialization error:', error);
        alert('Failed to initialize app: ' + error.message);
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
