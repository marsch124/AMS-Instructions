const APP_VERSION = '22.0';
const LAST_REVISED_BY_KEY = 'ams_last_revised_by';

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

    // Safety Warnings sits above the steps, so it only appears when there is
    // actually something to warn about — and it opens already expanded, since a
    // warning folded away behind a tap is not a warning.
    const hasWarnings = !!(instruction.warnings && instruction.warnings.trim());
    document.getElementById('warningsSection').style.display = hasWarnings ? 'flex' : 'none';
    document.getElementById('warningsContent').classList.toggle('expanded', hasWarnings);

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
    (instruction.revisionHistory || []).slice().reverse().forEach((rev, i) => {
        const div = document.createElement('div');
        div.className = 'history-entry';
        const date = new Date(rev.timestamp).toLocaleString();
        const authorName = rev.authorName || rev.author || 'Unknown';
        const contactId = 'historyContact-' + i;
        div.innerHTML = `
            <div class="history-version">v${rev.version}</div>
            <div class="history-date">${date}</div>
            <div class="history-author">By: ${authorName}</div>
            <div class="history-contact" id="${contactId}"></div>
            <div class="history-changes">${rev.changes}</div>
        `;
        historyList.appendChild(div);

        if (rev.authorId) {
            getPerson(rev.authorId).then(person => {
                if (!person) return;
                const parts = [];
                if (person.phone) parts.push('📞 ' + person.phone);
                if (person.email) parts.push('✉️ ' + person.email);
                const contactEl = document.getElementById(contactId);
                if (contactEl) contactEl.textContent = parts.join('  ·  ');
            });
        }
    });

    // Audit log
    renderAuditLog(instruction);
    populateAuditForm();

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
    await renderBackupNudge();
    await renderActionsNudge();

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

// Populates the Owner and Revised-by selects from the People store.
// selectedOwnerId pre-selects Owner (matches nothing for legacy instructions without an ownerId — by design, see plan).
// Revised-by always defaults to the last person used, for one-tap convenience on repeat edits.
async function populateOwnerAndRevisedBySelects(selectedOwnerId) {
    const people = await getAllPeople();
    people.sort((a, b) => a.name.localeCompare(b.name));

    const ownerSelect = document.getElementById('editorOwner');
    ownerSelect.innerHTML = '<option value="">-- Select --</option>';
    people.forEach(person => {
        const opt = document.createElement('option');
        opt.value = person.id;
        opt.textContent = person.name;
        ownerSelect.appendChild(opt);
    });
    ownerSelect.value = selectedOwnerId || '';

    const revisedBySelect = document.getElementById('editorRevisedBy');
    revisedBySelect.innerHTML = '<option value="">-- Select --</option>';
    people.forEach(person => {
        const opt = document.createElement('option');
        opt.value = person.id;
        opt.textContent = person.name;
        revisedBySelect.appendChild(opt);
    });
    const lastRevisedBy = localStorage.getItem(LAST_REVISED_BY_KEY);
    revisedBySelect.value = people.some(p => p.id === lastRevisedBy) ? lastRevisedBy : '';
}

async function editInstruction(instruction) {
    currentPhotos = [...(instruction.photos || [])];
    window.currentEditingInstruction = instruction;

    document.getElementById('editorTitle').textContent = 'Edit Instruction';
    document.getElementById('editorNumber').value = instruction.number;
    document.getElementById('editorName').value = instruction.title;
    document.getElementById('editorCategory').value = instruction.category;
    document.getElementById('editorWhere').value = instruction.where || '';
    document.getElementById('editorWhereDetailed').value = instruction.whereDetailed || '';
    document.getElementById('editorSteps').value = (instruction.steps || []).join('\n');
    document.getElementById('editorDescription').value = instruction.description || '';
    await populateOwnerAndRevisedBySelects(instruction.ownerId || '');
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
    window.currentEditingInstruction = null;
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

    const ownerSelect = document.getElementById('editorOwner');
    const ownerId = ownerSelect.value || null;
    const ownerName = ownerId ? ownerSelect.options[ownerSelect.selectedIndex].textContent : '';

    const revisedBySelect = document.getElementById('editorRevisedBy');
    const revisedById = revisedBySelect.value || null;
    const revisedByName = revisedById ? revisedBySelect.options[revisedBySelect.selectedIndex].textContent : null;
    if (revisedById) {
        localStorage.setItem(LAST_REVISED_BY_KEY, revisedById);
    }

    const instruction = {
        id: window.currentEditingId || 'instr_' + Date.now(),
        number,
        title,
        category: document.getElementById('editorCategory').value,
        where: document.getElementById('editorWhere').value,
        whereDetailed: document.getElementById('editorWhereDetailed').value,
        description: document.getElementById('editorDescription').value,
        owner: ownerName,
        ownerId,
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
        lastChanges: window.currentEditingId ? 'Updated instruction' : 'Created',
        revisedById,
        revisedByName
    };

    // Editing an existing instruction: carry forward fields the form doesn't touch,
    // so saving an edit doesn't reset completion tracking or wipe prior revision history.
    if (window.currentEditingId && window.currentEditingInstruction) {
        const existing = window.currentEditingInstruction;
        instruction.createdAt = existing.createdAt;
        instruction.completionCount = existing.completionCount;
        instruction.lastCompleted = existing.lastCompleted;
        instruction.revisionHistory = existing.revisionHistory;
    }

    await saveInstructionDB(instruction);
    resetEditor();
    await renderInstructionsList();
    showScreen('instructionsListScreen');
}

async function renderPeopleList() {
    const list = document.getElementById('peopleList');
    const people = await getAllPeople();
    people.sort((a, b) => a.name.localeCompare(b.name));

    if (people.length === 0) {
        list.innerHTML = '<p class="empty-state">No people yet.</p>';
        return;
    }

    list.innerHTML = '';
    people.forEach(person => {
        const item = document.createElement('div');
        item.className = 'list-item';

        const info = document.createElement('div');
        info.className = 'list-item-info';
        info.addEventListener('click', () => editPerson(person));

        const nameEl = document.createElement('div');
        nameEl.className = 'list-item-title';
        nameEl.textContent = person.name;

        const contactEl = document.createElement('div');
        contactEl.className = 'list-item-category';
        contactEl.textContent = [person.phone, person.email].filter(Boolean).join('  ·  ') || '--';

        info.appendChild(nameEl);
        info.appendChild(contactEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'list-item-edit';
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editPerson(person);
        });

        item.appendChild(info);
        item.appendChild(editBtn);
        list.appendChild(item);
    });
}

function editPerson(person) {
    document.getElementById('personEditorTitle').textContent = 'Edit Person';
    document.getElementById('personEditorName').value = person.name || '';
    document.getElementById('personEditorPhone').value = person.phone || '';
    document.getElementById('personEditorEmail').value = person.email || '';
    document.getElementById('personEditorHandles').value = (person.handles || [])
        .map(h => h.label + '|' + h.value).join('\n');

    const deleteBtn = document.getElementById('deletePersonBtn');
    deleteBtn.style.display = 'block';
    deleteBtn.onclick = () => {
        showModal('Delete Person', `Delete "${person.name}"? This does not remove them from past revision history.`, async (confirmed) => {
            if (confirmed) {
                await deletePerson(person.id);
                await renderPeopleList();
                showScreen('peopleScreen');
            }
        });
    };

    window.currentEditingPersonId = person.id;
    window.personEditorReturn = null;
    showScreen('personEditorScreen');
}

function resetPersonEditor() {
    document.getElementById('personEditorTitle').textContent = 'New Person';
    document.getElementById('personEditorName').value = '';
    document.getElementById('personEditorPhone').value = '';
    document.getElementById('personEditorEmail').value = '';
    document.getElementById('personEditorHandles').value = '';
    document.getElementById('deletePersonBtn').style.display = 'none';
    window.currentEditingPersonId = null;
}

async function handleSavePerson() {
    const name = document.getElementById('personEditorName').value.trim();
    if (!name) {
        alert('Please enter a name');
        return;
    }

    const handles = document.getElementById('personEditorHandles').value.trim()
        .split('\n')
        .filter(s => s.trim())
        .map(line => {
            const [label, value] = line.split('|');
            return { label: (label || '').trim(), value: (value || '').trim() };
        });

    const person = {
        id: window.currentEditingPersonId || undefined,
        name,
        phone: document.getElementById('personEditorPhone').value.trim(),
        email: document.getElementById('personEditorEmail').value.trim(),
        handles
    };

    const saved = await savePersonDB(person);
    resetPersonEditor();

    // Opened from the audit form's "+ Person" shortcut: go straight back to the
    // instruction with the new person already picked, instead of the People list.
    if (window.personEditorReturn === 'audit') {
        window.personEditorReturn = null;

        // populateAuditForm() resets the date and findings, so keep whatever was
        // already typed before stepping away to add the person.
        const keptDate = document.getElementById('auditDate').value;
        const keptFindings = document.getElementById('auditFindings').value;

        await populateAuditForm();

        document.getElementById('auditAuditor').value = saved.id;
        if (keptDate) document.getElementById('auditDate').value = keptDate;
        document.getElementById('auditFindings').value = keptFindings;

        showScreen('instructionScreen');
        return;
    }

    await renderPeopleList();
    showScreen('peopleScreen');
}

async function renderAuditLog(instruction) {
    const list = document.getElementById('instructionAudits');
    const audits = await getAuditsForInstruction(instruction.id);

    updatePreviewIndicator('auditPreview', audits.length > 0);

    if (audits.length === 0) {
        list.innerHTML = '<p class="empty-state">No audits recorded yet.</p>';
        return;
    }

    list.innerHTML = '';
    audits.forEach(audit => {
        const div = document.createElement('div');
        div.className = 'history-entry';

        const date = new Date(audit.timestamp).toLocaleDateString();
        const auditorName = audit.auditorName || 'Unknown';

        const dateEl = document.createElement('div');
        dateEl.className = 'history-date';
        dateEl.textContent = date;

        const authorEl = document.createElement('div');
        authorEl.className = 'history-author';
        authorEl.textContent = 'Audited by: ' + auditorName;

        const contactEl = document.createElement('div');
        contactEl.className = 'history-contact';

        const findingsEl = document.createElement('div');
        findingsEl.className = 'audit-findings';
        findingsEl.textContent = audit.findings || '--';

        div.appendChild(dateEl);
        div.appendChild(authorEl);
        div.appendChild(contactEl);
        div.appendChild(findingsEl);

        const actions = document.createElement('div');
        actions.className = 'audit-entry-actions';

        if (audit.convertedToActionId) {
            const badge = document.createElement('span');
            badge.className = 'audit-converted-badge';
            badge.textContent = '✓ Already actioned';
            actions.appendChild(badge);
        } else {
            const convertBtn = document.createElement('button');
            convertBtn.className = 'btn-secondary';
            convertBtn.textContent = '→ Convert to Action';
            convertBtn.addEventListener('click', () => convertAuditToAction(audit));
            actions.appendChild(convertBtn);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
            showModal('Delete Audit Entry', `Delete this audit entry by ${auditorName}?`, async (confirmed) => {
                if (confirmed) {
                    await deleteAudit(audit.id);
                    await renderAuditLog(instruction);
                }
            });
        });
        actions.appendChild(deleteBtn);

        div.appendChild(actions);
        list.appendChild(div);

        if (audit.auditorId) {
            getPerson(audit.auditorId).then(person => {
                if (!person) return;
                const parts = [];
                if (person.phone) parts.push('📞 ' + person.phone);
                if (person.email) parts.push('✉️ ' + person.email);
                contactEl.textContent = parts.join('  ·  ');
            });
        }
    });
}

async function populateAuditForm() {
    const people = await getAllPeople();
    people.sort((a, b) => a.name.localeCompare(b.name));

    const select = document.getElementById('auditAuditor');
    select.innerHTML = '<option value="">-- Select --</option>';
    people.forEach(person => {
        const opt = document.createElement('option');
        opt.value = person.id;
        opt.textContent = person.name;
        select.appendChild(opt);
    });

    const lastUsed = localStorage.getItem(LAST_REVISED_BY_KEY);
    select.value = people.some(p => p.id === lastUsed) ? lastUsed : '';

    // Default the date to today, in the yyyy-mm-dd form the date input expects
    const now = new Date();
    const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 10);
    document.getElementById('auditDate').value = localToday;

    document.getElementById('auditFindings').value = '';
}

async function handleAddAudit() {
    if (!currentInstruction) return;

    const auditorSelect = document.getElementById('auditAuditor');
    const auditorId = auditorSelect.value || null;
    const auditorName = auditorId ? auditorSelect.options[auditorSelect.selectedIndex].textContent : '';
    const dateValue = document.getElementById('auditDate').value;
    const findings = document.getElementById('auditFindings').value.trim();

    if (!auditorId) {
        alert('Please select who did the audit');
        return;
    }
    if (!findings) {
        alert('Please enter what the audit found');
        return;
    }

    // Parse as local midnight rather than UTC, so the date shown back matches what was picked
    const timestamp = dateValue ? new Date(dateValue + 'T00:00:00').getTime() : Date.now();

    await saveAuditDB({
        instructionId: currentInstruction.id,
        instructionNumber: currentInstruction.number,
        auditorId,
        auditorName,
        timestamp,
        findings,
        convertedToActionId: null
    });

    localStorage.setItem(LAST_REVISED_BY_KEY, auditorId);

    await renderAuditLog(currentInstruction);
    await populateAuditForm();
}

function formatDueDate(dueDate) {
    if (!dueDate) return '';
    // Parse as local midnight, not UTC, so the date shown matches the one picked
    return new Date(dueDate + 'T00:00:00').toLocaleDateString();
}

function isOverdue(dueDate) {
    if (!dueDate) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dueDate + 'T00:00:00').getTime() < today.getTime();
}

function createActionRow(action, done) {
    const item = document.createElement('div');
    item.className = 'list-item action-item' + (done ? ' done' : '');

    const tickBtn = document.createElement('button');
    tickBtn.className = 'action-tick' + (done ? ' ticked' : '');
    tickBtn.textContent = done ? '☑' : '☐';
    tickBtn.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
    tickBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (done) {
            await reopenAction(action.id);
        } else {
            await completeAction(action.id);
        }
        await renderActionsList();
    });

    const info = document.createElement('div');
    info.className = 'list-item-info';
    info.addEventListener('click', () => editAction(action));

    const titleEl = document.createElement('div');
    titleEl.className = 'list-item-title';
    titleEl.textContent = action.title;
    info.appendChild(titleEl);

    const meta = document.createElement('div');
    meta.className = 'action-meta';

    if (!done && action.priority === 'high') {
        const chip = document.createElement('span');
        chip.className = 'action-chip high';
        chip.textContent = 'High';
        meta.appendChild(chip);
    }

    if (action.dueDate) {
        const chip = document.createElement('span');
        chip.className = 'action-chip' + (!done && isOverdue(action.dueDate) ? ' overdue' : '');
        chip.textContent = '📅 ' + formatDueDate(action.dueDate);
        meta.appendChild(chip);
    }

    if (action.instructionNumber) {
        const chip = document.createElement('span');
        chip.className = 'action-chip link';
        chip.textContent = '#' + action.instructionNumber;
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            navigateToInstruction(action.instructionNumber);
        });
        meta.appendChild(chip);
    }

    if (action.sourceAuditId) {
        const chip = document.createElement('span');
        chip.className = 'action-chip';
        chip.textContent = '🔍 From audit';
        meta.appendChild(chip);
    }

    if (meta.children.length > 0) {
        info.appendChild(meta);
    }

    if (action.notes) {
        const notesEl = document.createElement('div');
        notesEl.className = 'list-item-category action-notes';
        notesEl.textContent = action.notes;
        info.appendChild(notesEl);
    }

    const editBtn = document.createElement('button');
    editBtn.className = 'list-item-edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editAction(action);
    });

    item.appendChild(tickBtn);
    item.appendChild(info);
    item.appendChild(editBtn);
    return item;
}

async function renderActionsList() {
    const openList = document.getElementById('openActionsList');
    const doneList = document.getElementById('doneActionsList');
    const doneSection = document.getElementById('doneActionsSection');

    const open = await getOpenActions();
    const done = await getDoneActions();

    if (open.length === 0) {
        openList.innerHTML = '<p class="empty-state">Nothing to do. Tap ＋ to add a to-do.</p>';
    } else {
        openList.innerHTML = '';
        open.forEach(action => openList.appendChild(createActionRow(action, false)));
    }

    if (done.length === 0) {
        doneSection.style.display = 'none';
        doneList.innerHTML = '';
    } else {
        doneSection.style.display = 'block';
        doneList.innerHTML = '';
        done.forEach(action => doneList.appendChild(createActionRow(action, true)));
    }
}

async function populateActionInstructionSelect(selectedId) {
    const select = document.getElementById('actionEditorInstruction');
    const instructions = await getAllInstructions();
    instructions.sort((a, b) => a.number.localeCompare(b.number));

    select.innerHTML = '<option value="">-- None (general to-do) --</option>';
    instructions.forEach(instruction => {
        const opt = document.createElement('option');
        opt.value = instruction.id;
        opt.textContent = instruction.number + ' — ' + instruction.title;
        select.appendChild(opt);
    });

    select.value = instructions.some(i => i.id === selectedId) ? selectedId : '';
}

async function resetActionEditor() {
    document.getElementById('actionEditorTitle').textContent = 'New Action';
    document.getElementById('actionEditorTitleInput').value = '';
    document.getElementById('actionEditorNotes').value = '';
    document.getElementById('actionEditorPriority').value = 'normal';
    document.getElementById('actionEditorDueDate').value = '';
    document.getElementById('deleteActionBtn').style.display = 'none';
    document.getElementById('actionSourceNote').style.display = 'none';
    await populateActionInstructionSelect(null);
    window.currentEditingAction = null;
}

async function editAction(action) {
    document.getElementById('actionEditorTitle').textContent = 'Edit Action';
    document.getElementById('actionEditorTitleInput').value = action.title || '';
    document.getElementById('actionEditorNotes').value = action.notes || '';
    document.getElementById('actionEditorPriority').value = action.priority || 'normal';
    document.getElementById('actionEditorDueDate').value = action.dueDate || '';
    await populateActionInstructionSelect(action.instructionId);

    const sourceNote = document.getElementById('actionSourceNote');
    if (action.sourceAuditId) {
        sourceNote.textContent = 'Created from an audit finding' +
            (action.instructionNumber ? ' on instruction ' + action.instructionNumber : '') + '.';
        sourceNote.style.display = 'block';
    } else {
        sourceNote.style.display = 'none';
    }

    const deleteBtn = document.getElementById('deleteActionBtn');
    deleteBtn.style.display = 'block';
    deleteBtn.onclick = () => {
        showModal('Delete Action', `Delete "${action.title}"?`, async (confirmed) => {
            if (confirmed) {
                await deleteAction(action.id);
                await renderActionsList();
                showScreen('actionsScreen');
            }
        });
    };

    window.currentEditingAction = action;
    window.actionEditorReturn = 'actions';
    showScreen('actionEditorScreen');
}

async function handleSaveAction() {
    const title = document.getElementById('actionEditorTitleInput').value.trim();
    if (!title) {
        alert('Please enter a title');
        return;
    }

    const existing = window.currentEditingAction || {};
    const instructionSelect = document.getElementById('actionEditorInstruction');
    const instructionId = instructionSelect.value || null;

    let instructionNumber = null;
    if (instructionId) {
        const instructions = await getAllInstructions();
        const linked = instructions.find(i => i.id === instructionId);
        instructionNumber = linked ? linked.number : null;
    }

    const action = {
        id: existing.id || undefined,
        title,
        notes: document.getElementById('actionEditorNotes').value.trim(),
        priority: document.getElementById('actionEditorPriority').value,
        dueDate: document.getElementById('actionEditorDueDate').value || null,
        status: existing.status || 'open',
        instructionId,
        instructionNumber,
        sourceAuditId: existing.sourceAuditId || null,
        createdAt: existing.createdAt || undefined,
        completedAt: existing.completedAt || null
    };

    const saved = await saveActionDB(action);

    // Came from an audit finding's "Convert to Action": stamp the audit so the
    // same finding can't be converted twice, then go back to the instruction.
    if (window.actionEditorReturn === 'audit' && saved.sourceAuditId) {
        window.actionEditorReturn = null;
        await markAuditConverted(saved.sourceAuditId, saved.id);
        await resetActionEditor();
        if (currentInstruction) {
            await renderAuditLog(currentInstruction);
        }
        showScreen('instructionScreen');
        return;
    }

    window.actionEditorReturn = null;
    await resetActionEditor();
    await renderActionsList();
    showScreen('actionsScreen');
}

// Pre-fill a new action from an audit finding. The first line becomes the title,
// the full finding text stays in the notes so nothing is lost.
async function convertAuditToAction(audit) {
    await resetActionEditor();

    const firstLine = (audit.findings || '').split('\n')[0].trim();
    const title = firstLine.length > 60 ? firstLine.slice(0, 57) + '…' : firstLine;

    document.getElementById('actionEditorTitle').textContent = 'New Action from Audit';
    document.getElementById('actionEditorTitleInput').value = title;
    document.getElementById('actionEditorNotes').value = audit.findings || '';
    await populateActionInstructionSelect(audit.instructionId);

    const sourceNote = document.getElementById('actionSourceNote');
    sourceNote.textContent = 'From the audit by ' + (audit.auditorName || 'Unknown') +
        ' on ' + new Date(audit.timestamp).toLocaleDateString() + '.';
    sourceNote.style.display = 'block';

    window.currentEditingAction = {
        instructionId: audit.instructionId,
        instructionNumber: audit.instructionNumber,
        sourceAuditId: audit.id
    };
    window.actionEditorReturn = 'audit';
    showScreen('actionEditorScreen');
}

async function renderActionsNudge() {
    const nudge = document.getElementById('actionsNudge');
    const detail = document.getElementById('actionsNudgeDetail');
    const open = await getOpenActions();

    if (open.length === 0) {
        nudge.style.display = 'none';
        return;
    }

    const high = open.filter(a => a.priority === 'high').length;
    detail.textContent = open.length + ' open' + (high ? ' · ' + high + ' high-priority' : '');
    nudge.style.display = 'flex';
}

const LAST_EXPORT_KEY = 'ams_last_export_time';
const BACKUP_NUDGE_AFTER_DAYS = 7;

function backupFileName() {
    const now = new Date();
    const stamp = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    return `AMS-Instructions-backup-${stamp}.json`;
}

function formatBackupDate(value) {
    if (!value) return null;
    const date = new Date(typeof value === 'string' ? value : Number(value));
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function describeCounts(counts) {
    if (!counts) return 'Nothing stored';
    const parts = [
        counts.instructions + (counts.instructions === 1 ? ' instruction' : ' instructions'),
        counts.people + (counts.people === 1 ? ' person' : ' people'),
        counts.audits + (counts.audits === 1 ? ' audit' : ' audits'),
        counts.actions + (counts.actions === 1 ? ' to-do' : ' to-dos')
    ];
    return parts.join('  ·  ');
}

// iOS only opens the share sheet if navigator.share() is reached directly from
// the tap that triggered it. Reading the database first is an await, which loses
// that permission and makes the sheet silently refuse. So the backup is prepared
// in advance — whenever a screen with a backup button is opened — and the tap
// itself does no waiting at all.
let preparedBackup = null;
const PREPARED_BACKUP_MAX_AGE = 5 * 60 * 1000;

async function prepareBackup() {
    try {
        const data = await exportData();
        preparedBackup = {
            json: JSON.stringify(data, null, 2),
            fileName: backupFileName(),
            at: Date.now(),
            counts: {
                instructions: data.instructions.length,
                people: data.people.length,
                audits: data.audits.length,
                actions: data.actions.length
            }
        };
    } catch (error) {
        console.warn('[Backup] Could not prepare backup in advance:', error);
        preparedBackup = null;
    }
}

// The click handler itself: deliberately NOT async, so the user gesture survives.
function handleExportTap() {
    const ready = preparedBackup && (Date.now() - preparedBackup.at) < PREPARED_BACKUP_MAX_AGE;
    if (!ready) {
        // Nothing prepared — do it the slow way and accept that iOS may fall
        // back to a download rather than the share sheet.
        handleExport();
        return;
    }

    const { json, fileName, counts } = preparedBackup;

    let file;
    try {
        file = new File([json], fileName, { type: 'application/json' });
    } catch (error) {
        handleExport();
        return;
    }

    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files: [file] }))) {
        if (downloadBackupFile(json, fileName)) {
            afterSuccessfulBackup(counts);
        } else {
            showBackupAsText(json);
        }
        return;
    }

    navigator.share({ files: [file], title: 'AMS Instructions Backup' })
        .then(() => afterSuccessfulBackup(counts))
        .catch((error) => {
            if (error && error.name === 'AbortError') return;   // dismissed, not failed
            console.warn('[Backup] Share failed, falling back:', error);
            if (downloadBackupFile(json, fileName)) {
                afterSuccessfulBackup(counts);
            } else {
                showBackupAsText(json);
            }
        });
}

async function afterSuccessfulBackup(counts) {
    localStorage.setItem(LAST_EXPORT_KEY, Date.now());
    await renderBackupNudge();
    renderDataSafety();
    prepareBackup();
    alert('Backup saved.\n\n' + describeCounts(counts));
}

// Slow path, used when nothing was prepared in advance.
async function handleExport() {
    let data;
    try {
        data = await exportData();
    } catch (error) {
        alert('Could not read your data to back it up: ' + error.message);
        return;
    }

    const json = JSON.stringify(data, null, 2);
    const fileName = backupFileName();
    const shared = await shareBackupFile(json, fileName);

    if (shared === 'cancelled') return;

    const counts = {
        instructions: data.instructions.length,
        people: data.people.length,
        audits: data.audits.length,
        actions: data.actions.length
    };

    if (shared === true) {
        await afterSuccessfulBackup(counts);
        return;
    }

    // Sharing unavailable — fall back to a download, then to on-screen text.
    if (downloadBackupFile(json, fileName)) {
        await afterSuccessfulBackup(counts);
        return;
    }

    showBackupAsText(json);
}

async function shareBackupFile(json, fileName) {
    try {
        if (!navigator.share) return false;

        const file = new File([json], fileName, { type: 'application/json' });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;

        await navigator.share({ files: [file], title: 'AMS Instructions Backup' });
        return true;
    } catch (error) {
        // Dismissing the share sheet is a normal choice, not a failure
        if (error && error.name === 'AbortError') return 'cancelled';
        console.warn('[Backup] Share sheet unavailable:', error);
        return false;
    }
}

function downloadBackupFile(json, fileName) {
    try {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (error) {
        console.error('[Backup] Download fallback failed:', error);
        return false;
    }
}

function showBackupAsText(json) {
    const w = window.open();
    if (!w) {
        alert('Could not open the backup. Please allow pop-ups, or try again.');
        return;
    }
    w.document.write('<html><head><title>AMS Instructions Backup</title><style>body{font-family:monospace;padding:1rem;white-space:pre-wrap;word-wrap:break-word;background:#0a1f1f;color:#fff;}</style></head><body>');
    w.document.write('<h2>AMS Instructions Backup</h2>');
    w.document.write('<p>Date: ' + new Date().toISOString() + '</p>');
    w.document.write('<p><strong>Tap Share → Save to Files</strong></p><hr>');
    w.document.write(json.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    w.document.write('</body></html>');
    w.document.close();
}

async function renderBackupNudge() {
    const nudge = document.getElementById('backupNudge');
    const detail = document.getElementById('backupNudgeDetail');

    // Nothing worth backing up yet
    const instructions = await getAllInstructions();
    if (instructions.length === 0) {
        nudge.style.display = 'none';
        return;
    }

    const last = localStorage.getItem(LAST_EXPORT_KEY);
    if (!last) {
        detail.textContent = 'Never backed up';
        nudge.style.display = 'flex';
        prepareBackup();
        return;
    }

    const days = Math.floor((Date.now() - Number(last)) / (24 * 60 * 60 * 1000));
    if (days < BACKUP_NUDGE_AFTER_DAYS) {
        nudge.style.display = 'none';
        return;
    }

    detail.textContent = 'Last backup ' + (days === 1 ? 'yesterday' : days + ' days ago');
    nudge.style.display = 'flex';
    prepareBackup();   // the card is a backup button too — keep it gesture-ready
}

async function renderDataSafety() {
    const status = hybridStorage.status();

    const warning = document.getElementById('backupWarning');
    if (status.failedAt) {
        warning.textContent = '⚠ The last automatic backup could not be saved — storage on this device may be full. Use "Back Up Now" below to keep a copy somewhere safe.';
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }

    try {
        const live = {
            instructions: (await getAllInstructions()).length,
            people: (await getAllPeople()).length,
            audits: (await getAllAudits()).length,
            actions: (await getAllActions()).length
        };
        document.getElementById('liveDataCounts').textContent = describeCounts(live);
    } catch (error) {
        document.getElementById('liveDataCounts').textContent = 'Could not read the app data';
    }

    const slots = [
        ['current', status.current, 'currentBackupDate', 'currentBackupCounts', 'currentBackupSlot', 'restoreCurrentBtn'],
        ['previous', status.previous, 'previousBackupDate', 'previousBackupCounts', 'previousBackupSlot', 'restorePreviousBtn']
    ];

    slots.forEach(([which, counts, dateId, countsId, slotId, buttonId]) => {
        const slot = document.getElementById(slotId);
        const button = document.getElementById(buttonId);

        if (!counts) {
            document.getElementById(dateId).textContent = 'No backup yet';
            document.getElementById(countsId).textContent = '';
            button.style.display = 'none';
            slot.classList.add('empty');
            return;
        }

        slot.classList.remove('empty');
        document.getElementById(dateId).textContent = formatBackupDate(counts.timestamp) || 'Date unknown';
        document.getElementById(countsId).textContent = describeCounts(counts);
        button.style.display = counts.instructions > 0 ? 'block' : 'none';
    });

    document.getElementById('lastExportDate').textContent =
        formatBackupDate(localStorage.getItem(LAST_EXPORT_KEY)) || 'Never backed up';
}

function restoreFromSlot(which) {
    const backup = hybridStorage.getSlot(which);
    if (!backup) {
        alert('That backup is no longer available.');
        return;
    }

    const count = (backup.instructions || []).length;
    showModal('Restore Backup',
        `Put back ${count} ${count === 1 ? 'instruction' : 'instructions'} from ${formatBackupDate(backup.timestamp) || 'this backup'}? Anything currently in the app with the same number will be replaced by the backup's version. Nothing else is deleted.`,
        async (confirmed) => {
            if (!confirmed) return;
            try {
                await importData(backup);
                await renderHomeScreen();
                renderDataSafety();
                alert('Restored ' + count + (count === 1 ? ' instruction.' : ' instructions.'));
            } catch (error) {
                alert('Restore failed: ' + error.message);
            }
        });
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
    document.getElementById('settingsBtn').addEventListener('click', () => {
        prepareBackup();   // so "Back Up Now" can open the share sheet without waiting
        showScreen('settingsScreen');
    });
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
            currentInstruction = await recordCompletion(currentInstruction);

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

    document.getElementById('addAuditBtn').addEventListener('click', handleAddAudit);

    // Settings
    document.getElementById('allInstructionsBtn').addEventListener('click', async () => {
        await renderInstructionsList();
        showScreen('instructionsListScreen');
    });

    document.getElementById('addInstructionBtn').addEventListener('click', async () => {
        resetEditor();
        await populateOwnerAndRevisedBySelects();
        showScreen('editorScreen');
    });

    // People
    document.getElementById('managePeopleBtn').addEventListener('click', async () => {
        await renderPeopleList();
        showScreen('peopleScreen');
    });

    document.getElementById('addPersonBtn').addEventListener('click', () => {
        resetPersonEditor();
        window.personEditorReturn = null;
        showScreen('personEditorScreen');
    });

    document.getElementById('backFromPeopleBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('backFromPersonEditorBtn').addEventListener('click', async () => {
        // Came from the audit form's "+ Person" shortcut — return there, not to People
        if (window.personEditorReturn === 'audit') {
            window.personEditorReturn = null;
            showScreen('instructionScreen');
            return;
        }
        await renderPeopleList();
        showScreen('peopleScreen');
    });

    document.getElementById('auditAddPersonBtn').addEventListener('click', () => {
        resetPersonEditor();
        window.personEditorReturn = 'audit';
        showScreen('personEditorScreen');
    });

    document.getElementById('savePersonBtn').addEventListener('click', handleSavePerson);

    // Actions
    document.getElementById('actionsNudge').addEventListener('click', async () => {
        window.actionsReturn = 'home';
        await renderActionsList();
        showScreen('actionsScreen');
    });

    document.getElementById('viewActionsBtn').addEventListener('click', async () => {
        window.actionsReturn = 'settings';
        await renderActionsList();
        showScreen('actionsScreen');
    });

    document.getElementById('addActionBtn').addEventListener('click', async () => {
        window.actionsReturn = 'settings';
        await resetActionEditor();
        window.actionEditorReturn = 'actions';
        showScreen('actionEditorScreen');
    });

    document.getElementById('newActionBtn').addEventListener('click', async () => {
        await resetActionEditor();
        window.actionEditorReturn = 'actions';
        showScreen('actionEditorScreen');
    });

    document.getElementById('backFromActionsBtn').addEventListener('click', async () => {
        if (window.actionsReturn === 'settings') {
            showScreen('settingsScreen');
            return;
        }
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('backFromActionEditorBtn').addEventListener('click', async () => {
        // Came from an audit finding — go back to the instruction, leaving the
        // audit unconverted since nothing was saved.
        if (window.actionEditorReturn === 'audit') {
            window.actionEditorReturn = null;
            showScreen('instructionScreen');
            return;
        }
        window.actionEditorReturn = null;
        await renderActionsList();
        showScreen('actionsScreen');
    });

    document.getElementById('saveActionBtn').addEventListener('click', handleSaveAction);

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

    document.getElementById('exportBtn').addEventListener('click', handleExportTap);
    document.getElementById('exportFromSafetyBtn').addEventListener('click', handleExportTap);
    document.getElementById('backupNudge').addEventListener('click', handleExportTap);

    document.getElementById('dataSafetyBtn').addEventListener('click', () => {
        renderDataSafety();
        prepareBackup();
        showScreen('dataSafetyScreen');
    });

    document.getElementById('backFromDataSafetyBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('restoreCurrentBtn').addEventListener('click', () => restoreFromSlot('current'));
    document.getElementById('restorePreviousBtn').addEventListener('click', () => restoreFromSlot('previous'));

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
                await renderHomeScreen();
                alert('Backup restored: ' + (data.instructions || []).length + ' instructions');
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

    document.getElementById('versionLogBtn').addEventListener('click', () => {
        showScreen('versionLogScreen');
    });

    document.getElementById('backFromVersionLogBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('clearDataBtn').addEventListener('click', () => {
        showModal('Clear All Data', 'This will delete all instructions, audits and to-dos. Your People list is kept. The backup taken beforehand stays available under Settings → Data Safety, so this can still be undone from there.', async (confirmed) => {
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
        // Restore BEFORE anything writes. Seeding people used to run first, and
        // its very first write saved an empty snapshot over the backup that was
        // about to be restored from — destroying the only copy of the data.
        await hybridStorage.init(db);
        await seedDefaultPeople();
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
