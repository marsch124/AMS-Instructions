const APP_VERSION = '11.0';

let currentInstruction = null;
let allInstructions = [];
let currentPhotos = [];

function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (seconds < 60) return 'Just now';
    if (minutes < 60) return minutes === 1 ? '1 minute ago' : minutes + ' minutes ago';
    if (hours < 24) return hours === 1 ? '1 hour ago' : hours + ' hours ago';
    if (days === 1) return 'Yesterday';
    if (days < 7) return days + ' days ago';
    if (weeks === 1) return '1 week ago';
    if (weeks < 4) return weeks + ' weeks ago';
    if (months === 1) return '1 month ago';
    if (months < 12) return months + ' months ago';

    const date = new Date(timestamp);
    return date.toLocaleDateString();
}

function shareViaSMS(instruction) {
    const title = instruction.title;
    const where = instruction.where ? ` @ ${instruction.where}` : '';
    const completed = instruction.completionCount ? ` (completed ${instruction.completionCount}x)` : '';
    const message = `✓ Just completed: ${title}${where}${completed}`;

    // Use SMS URL scheme (works on iOS and Android)
    const smsUrl = `sms:?body=${encodeURIComponent(message)}`;

    // Check if SMS API is available (Web Share API)
    if (navigator.share && navigator.canShare({ text: message })) {
        navigator.share({
            title: `Completed: ${title}`,
            text: message
        }).catch(err => console.log('Share cancelled'));
    } else {
        // Fallback to SMS URL
        window.location.href = smsUrl;
    }
}

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
    document.getElementById('instructionDescription').textContent = instruction.description || '--';

    const categoryEl = document.getElementById('instructionCategory');
    categoryEl.textContent = instruction.category;
    categoryEl.className = 'category-badge ' + instruction.category.toLowerCase();

    // Metadata
    const statusEl = document.getElementById('instructionStatus');
    statusEl.textContent = instruction.status || 'Active';
    statusEl.className = 'status-badge ' + (instruction.status === 'Draft' ? 'draft' : instruction.status === 'Review Needed' ? 'review' : instruction.status === 'Archived' ? 'archived' : '');

    const diffEl = document.getElementById('instructionDifficulty');
    const stars = ['', '⭐', '⭐⭐', '⭐⭐⭐'];
    diffEl.textContent = stars[instruction.difficulty || 0];

    // Quick info
    document.getElementById('instructionOwner').textContent = instruction.owner || '--';
    document.getElementById('instructionFrequency').textContent = instruction.frequency || '--';
    document.getElementById('instructionTime').textContent = instruction.timeEstimate ? instruction.timeEstimate + ' min' : '--';

    // Completion tracking
    const completionCount = instruction.completionCount || 0;
    document.getElementById('instructionCompletionCount').textContent = completionCount === 1 ? '1 time' : completionCount + ' times';

    if (instruction.lastCompleted) {
        document.getElementById('instructionLastCompleted').textContent = formatRelativeTime(instruction.lastCompleted);
    } else {
        document.getElementById('instructionLastCompleted').textContent = 'Never';
    }

    // Location display
    const locationRow = document.getElementById('locationRow');
    if (instruction.where) {
        locationRow.style.display = 'flex';
        document.getElementById('instructionWhere').textContent = instruction.where;
        document.getElementById('instructionWhereDetailed').textContent = instruction.whereDetailed || '--';
    } else {
        locationRow.style.display = 'none';
    }

    // Sections with toggle setup
    setupSection('warnings', instruction.warnings);
    setupSection('equipment', instruction.equipment);
    setupSection('preparations', instruction.preparations);
    setupSection('afterUse', instruction.afterUse);
    setupSection('maintenance', instruction.maintenance);
    setupSection('notes', instruction.notes);

    // Instructions with checkboxes
    const stepsList = document.getElementById('instructionSteps');
    stepsList.innerHTML = '';
    (instruction.steps || []).forEach((step, i) => {
        const li = document.createElement('li');
        li.innerHTML = `<label><input type="checkbox" data-step="${i}"> ${step}</label>`;
        stepsList.appendChild(li);
    });

    // Photos
    if (instruction.photos && instruction.photos.length > 0) {
        document.getElementById('photosSection').style.display = 'flex';
        const photosGal = document.getElementById('instructionPhotos');
        photosGal.innerHTML = '';
        instruction.photos.forEach(photo => {
            const img = document.createElement('img');
            img.src = photo.data;
            img.className = 'photo-thumbnail';
            photosGal.appendChild(img);
        });
        updatePreviewIndicator('photosPreview', instruction.photos.length > 0);
    } else {
        document.getElementById('photosSection').style.display = 'none';
    }

    // Links
    if (instruction.links && instruction.links.length > 0) {
        document.getElementById('linksSection').style.display = 'flex';
        const linksList = document.getElementById('instructionLinks');
        linksList.innerHTML = '';
        instruction.links.forEach(link => {
            const a = document.createElement('a');
            a.href = link.url;
            a.target = '_blank';
            a.className = 'link-item';
            a.textContent = link.title;
            linksList.appendChild(a);
        });
        updatePreviewIndicator('linksPreview', instruction.links.length > 0);
    } else {
        document.getElementById('linksSection').style.display = 'none';
    }

    // Related instructions
    if (instruction.related && instruction.related.length > 0) {
        document.getElementById('relatedSection').style.display = 'flex';
        const relList = document.getElementById('instructionRelated');
        relList.innerHTML = '';
        instruction.related.forEach(relNum => {
            const div = document.createElement('div');
            div.className = 'related-item';
            div.innerHTML = `<span class="related-number">${relNum}</span> - Related instruction`;
            div.addEventListener('click', () => navigateToInstruction(relNum));
            relList.appendChild(div);
        });
    } else {
        document.getElementById('relatedSection').style.display = 'none';
    }

    // Revision history
    const historyList = document.getElementById('instructionHistory');
    historyList.innerHTML = '';
    (instruction.revisionHistory || []).reverse().forEach(rev => {
        const div = document.createElement('div');
        div.className = 'history-entry';
        const date = new Date(rev.timestamp).toLocaleString();
        div.innerHTML = `
            <div class="history-version">v${rev.version}</div>
            <div class="history-date">${date}</div>
            <div class="history-author">By: ${rev.author}</div>
            <div class="history-changes">${rev.changes}</div>
        `;
        historyList.appendChild(div);
    });

    // Favorites
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

function setupSection(sectionId, content) {
    const contentEl = document.getElementById(sectionId.charAt(0).toUpperCase() + sectionId.slice(1) + 'Content');
    const contentText = document.getElementById('instruction' + sectionId.charAt(0).toUpperCase() + sectionId.slice(1));
    contentText.textContent = content || '--';
    updatePreviewIndicator(sectionId + 'Preview', content && content.trim().length > 0);
}

function updatePreviewIndicator(id, filled) {
    const el = document.getElementById(id);
    if (el) {
        el.className = 'preview-indicator ' + (filled ? 'filled' : 'empty');
    }
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
    currentPhotos = [...(instruction.photos || [])];

    document.getElementById('editorTitle').textContent = 'Edit Instruction';
    document.getElementById('editorNumber').value = instruction.number;
    document.getElementById('editorName').value = instruction.title;
    document.getElementById('editorCategory').value = instruction.category;
    document.getElementById('editorWhere').value = instruction.where || '';
    document.getElementById('editorWhereDetailed').value = instruction.whereDetailed || '';
    document.getElementById('editorSteps').value = (instruction.steps || []).join('\n');
    document.getElementById('editorDescription').value = instruction.description || '';
    document.getElementById('editorOwner').value = instruction.owner || '';
    document.getElementById('editorStatus').value = instruction.status || 'Auto';
    document.getElementById('editorFrequency').value = instruction.frequency || '';
    document.getElementById('editorTimeEstimate').value = instruction.timeEstimate || '';
    document.getElementById('editorDifficulty').value = instruction.difficulty || '';
    document.getElementById('editorTags').value = (instruction.tags || []).join(', ');
    document.getElementById('editorWarnings').value = instruction.warnings || '';
    document.getElementById('editorEquipment').value = instruction.equipment || '';
    document.getElementById('editorPreparations').value = instruction.preparations || '';
    document.getElementById('editorAfterUse').value = instruction.afterUse || '';
    document.getElementById('editorMaintenance').value = instruction.maintenance || '';
    document.getElementById('editorNotes').value = instruction.notes || '';
    document.getElementById('editorLinks').value = (instruction.links || []).map(l => l.title + '|' + l.url).join('\n');
    document.getElementById('editorRelated').value = (instruction.related || []).join(', ');

    renderPhotosList();

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
    document.getElementById('editorWhere').value = '';
    document.getElementById('editorWhereDetailed').value = '';
    document.getElementById('editorSteps').value = '';
    document.getElementById('editorDescription').value = '';
    document.getElementById('editorOwner').value = '';
    document.getElementById('editorStatus').value = 'Auto';
    document.getElementById('editorFrequency').value = '';
    document.getElementById('editorTimeEstimate').value = '';
    document.getElementById('editorDifficulty').value = '';
    document.getElementById('editorTags').value = '';
    document.getElementById('editorWarnings').value = '';
    document.getElementById('editorEquipment').value = '';
    document.getElementById('editorPreparations').value = '';
    document.getElementById('editorAfterUse').value = '';
    document.getElementById('editorMaintenance').value = '';
    document.getElementById('editorNotes').value = '';
    document.getElementById('editorLinks').value = '';
    document.getElementById('editorRelated').value = '';
    document.getElementById('deleteEditorBtn').style.display = 'none';
    currentPhotos = [];
    renderPhotosList();
    window.currentEditingId = null;
}

function renderPhotosList() {
    const list = document.getElementById('editorPhotosList');
    list.innerHTML = '';
    currentPhotos.forEach((photo, i) => {
        const div = document.createElement('div');
        div.className = 'photo-item';
        div.innerHTML = `
            <img src="${photo.data}">
            <div class="photo-item-info">
                <div class="photo-item-name">${photo.name}</div>
                <div class="photo-item-size">${(photo.data.length / 1024).toFixed(1)} KB</div>
            </div>
        `;
        const delBtn = document.createElement('button');
        delBtn.className = 'photo-item-delete';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
            currentPhotos.splice(i, 1);
            renderPhotosList();
        });
        div.appendChild(delBtn);
        list.appendChild(div);
    });
}

async function handleSaveInstruction() {
    const number = document.getElementById('editorNumber').value.padStart(3, '0');
    const title = document.getElementById('editorName').value.trim();
    const stepsText = document.getElementById('editorSteps').value.trim();

    if (!number || !title || !stepsText) {
        alert('Please fill in: Number, Title, and Instructions');
        return;
    }

    const steps = stepsText.split('\n').map(s => s.trim()).filter(s => s);
    const links = document.getElementById('editorLinks').value.trim()
        .split('\n')
        .filter(s => s.trim())
        .map(line => {
            const [title, url] = line.split('|');
            return { title: title.trim(), url: url.trim() };
        });
    const related = document.getElementById('editorRelated').value
        .split(',')
        .map(s => s.trim())
        .filter(s => s);

    const instruction = {
        id: window.currentEditingId || 'instr_' + Date.now(),
        number,
        title,
        category: document.getElementById('editorCategory').value,
        where: document.getElementById('editorWhere').value,
        whereDetailed: document.getElementById('editorWhereDetailed').value,
        description: document.getElementById('editorDescription').value,
        owner: document.getElementById('editorOwner').value,
        status: document.getElementById('editorStatus').value,
        frequency: document.getElementById('editorFrequency').value,
        timeEstimate: parseInt(document.getElementById('editorTimeEstimate').value) || 0,
        difficulty: parseInt(document.getElementById('editorDifficulty').value) || 0,
        tags: document.getElementById('editorTags').value.split(',').map(t => t.trim()).filter(t => t),
        warnings: document.getElementById('editorWarnings').value,
        equipment: document.getElementById('editorEquipment').value,
        preparations: document.getElementById('editorPreparations').value,
        steps,
        afterUse: document.getElementById('editorAfterUse').value,
        maintenance: document.getElementById('editorMaintenance').value,
        notes: document.getElementById('editorNotes').value,
        photos: currentPhotos,
        links,
        related,
        lastChanges: window.currentEditingId ? 'Updated instruction' : 'Created'
    };

    await saveInstructionDB(instruction);
    resetEditor();
    await renderInstructionsList();
    showScreen('instructionsListScreen');
}

// Photo upload
document.addEventListener('DOMContentLoaded', () => {
    const photoInput = document.getElementById('editorPhotoInput');
    const addPhotoBtn = document.getElementById('addPhotoBtn');

    if (addPhotoBtn) {
        addPhotoBtn.addEventListener('click', () => {
            photoInput.click();
        });

        photoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && currentPhotos.length < 5) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    currentPhotos.push({
                        name: file.name,
                        data: event.target.result
                    });
                    renderPhotosList();
                    photoInput.value = '';
                };
                reader.readAsDataURL(file);
            } else if (currentPhotos.length >= 5) {
                alert('Maximum 5 photos per instruction');
            }
        });
    }
});

// Setup toggles for instruction viewer
document.addEventListener('click', (e) => {
    if (e.target.closest('.section-toggle')) {
        const toggle = e.target.closest('.section-toggle');
        const content = toggle.nextElementSibling;
        if (content && content.classList.contains('section-content')) {
            content.classList.toggle('expanded');
            toggle.classList.toggle('collapsed');
        }
    }
});

async function initializeApp() {
    document.getElementById('versionNumber').textContent = APP_VERSION;
    document.getElementById('homeVersion').textContent = 'v' + APP_VERSION;

    // Navigation
    document.getElementById('settingsBtn').addEventListener('click', () => showScreen('settingsScreen'));
    document.getElementById('backFromSettingsBtn').addEventListener('click', async () => {
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('scanBtn').addEventListener('click', async () => {
        showScreen('scanScreen');
        const statusEl = document.getElementById('scanStatus');
        statusEl.textContent = 'Loading scanner… (first time may take a moment)';
        await loadQRLibrary();
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

    document.getElementById('captureBtn').addEventListener('click', () => {
        captureAndScan();
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

    document.getElementById('doneBtn').addEventListener('click', async () => {
        if (currentInstruction) {
            currentInstruction.completionCount = (currentInstruction.completionCount || 0) + 1;
            currentInstruction.lastCompleted = Date.now();
            await saveInstructionDB(currentInstruction);

            document.getElementById('instructionCompletionCount').textContent =
                currentInstruction.completionCount === 1 ? '1 time' : currentInstruction.completionCount + ' times';
            document.getElementById('instructionLastCompleted').textContent = 'Just now';
        }

        document.getElementById('doneBtn').textContent = '✓ Done!';
        setTimeout(() => {
            document.getElementById('doneBtn').textContent = '✓ Mark Done';
        }, 1500);
    });

    document.getElementById('shareBtn').addEventListener('click', () => {
        if (currentInstruction) {
            shareViaSMS(currentInstruction);
        }
    });

    document.getElementById('editInstructionBtn').addEventListener('click', () => {
        if (currentInstruction) {
            editInstruction(currentInstruction);
        }
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
        
        // iOS-friendly export: open JSON in new window for user to save
        const w = window.open();
        w.document.write('<html><head><title>AMS Instructions Backup</title><style>body{font-family:monospace;padding:1rem;white-space:pre-wrap;word-wrap:break-word;background:#0a1f1f;color:#fff;}</style></head><body>');
        w.document.write('<h2>AMS Instructions Backup</h2>');
        w.document.write('<p>Date: ' + new Date().toISOString() + '</p>');
        w.document.write('<p><strong>On iPhone:</strong> Tap Share → Save to Files or Notes</p>');
        w.document.write('<hr>');
        w.document.write(json.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
        w.document.write('</body></html>');
        w.document.close();
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

    try {
        await initDB();
        await registerServiceWorker();
        await renderHomeScreen();
        showScreen('homeScreen');

        const size = await getDBSize();
        document.getElementById('dbSize').textContent = size;
    } catch (error) {
        console.error('Initialization error:', error);
        alert('Failed to initialize app: ' + error.message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
