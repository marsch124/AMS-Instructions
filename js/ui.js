const APP_VERSION = '39.0';
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

// How late something is, in whole days. An instruction that came due at 3pm
// rather than at 9am is not a distinction worth putting on screen.
function overdueBy(dueAt) {
    const days = Math.floor((Date.now() - dueAt) / DAY_MS);

    if (days <= 0) return 'due today';
    if (days === 1) return '1 day late';
    if (days < 60) return days + ' days late';
    return Math.round(days / 30) + ' months late';
}

function dueInText(dueAt) {
    const days = Math.ceil((dueAt - Date.now()) / DAY_MS);

    if (days <= 1) return 'Tomorrow';
    if (days < 60) return 'In ' + days + ' days';
    return 'In ' + Math.round(days / 30) + ' months';
}

// The Next Due line on an instruction. Where there is no date it says WHY, not
// just "--": "no frequency set" and "never been done" are different situations
// with different fixes, and a dash tells you neither.
function describeNextDue(instruction) {
    if (instruction.status === 'Archived') return 'Archived';
    if (!FREQUENCY_DAYS[instruction.frequency]) return '--';
    if (!instruction.lastCompleted) return 'After 1st Done';

    const dueAt = nextDueAt(instruction);
    return dueAt <= Date.now() ? overdueBy(dueAt) : dueInText(dueAt);
}

// Which steps you have ticked, per instruction.
//
// Deliberately in localStorage and deliberately NOT in the backup: this is where
// you are in a job right now, not something worth carrying to another phone.
const STEP_PROGRESS_KEY = 'ams_step_progress';

function allStepProgress() {
    try {
        return JSON.parse(localStorage.getItem(STEP_PROGRESS_KEY) || '{}');
    } catch (error) {
        return {};
    }
}

// Ticks are stored as step POSITIONS, so they would quietly point at the wrong
// lines if the steps were rewritten in the meantime. Keeping the step count
// alongside them lets us spot that and drop the stale ticks instead.
function stepProgressFor(instruction) {
    const entry = allStepProgress()[instruction.id];
    if (!entry || entry.count !== (instruction.steps || []).length) return [];
    return entry.ticked || [];
}

function saveStepProgress(instruction, ticked) {
    const all = allStepProgress();

    if (ticked.length === 0) {
        delete all[instruction.id];
    } else {
        all[instruction.id] = { count: (instruction.steps || []).length, ticked };
    }

    localStorage.setItem(STEP_PROGRESS_KEY, JSON.stringify(all));
}

function clearStepProgress(instruction) {
    saveStepProgress(instruction, []);
}

// The whole instruction as plain text, laid out to be read in a message rather
// than parsed. Deliberately not every field: owner, audit history and revision
// numbers matter inside the app and mean nothing to whoever you send this to.
function instructionToText(instruction) {
    const lines = [instruction.number + ' — ' + instruction.title];

    const meta = [
        instruction.category,
        instruction.frequency,
        instruction.timeEstimate ? instruction.timeEstimate + ' min' : null
    ].filter(Boolean);
    if (meta.length) lines.push(meta.join(' · '));

    const section = (label, value) => {
        if (!value || !String(value).trim()) return;
        lines.push('', label + String(value).trim());
    };

    section('', instruction.description);
    // The warning goes above the steps here for the same reason it does on
    // screen: it has to be read before starting, not discovered afterwards.
    section('⚠️ ', instruction.warnings);
    section('Equipment: ', instruction.equipment);
    section('Before you start: ', instruction.preparations);

    const steps = instruction.steps || [];
    if (steps.length) {
        lines.push('');
        steps.forEach((step, i) => lines.push((i + 1) + '. ' + step));
    }

    section('Afterwards: ', instruction.afterUse);
    section('Notes: ', instruction.notes);

    lines.push('', 'Sent from AMS Instructions');
    return lines.join('\n');
}

// Shares the instruction itself. This used to send a one-line "✓ Just completed"
// message, which told the recipient nothing they could act on. Being able to send
// someone the actual steps is the thing that was missing.
function shareInstruction(instruction) {
    const text = instructionToText(instruction);
    const title = instruction.number + ' — ' + instruction.title;

    // canShare is checked for existence first: on browsers that have share but
    // not canShare, calling it directly throws and nothing gets shared at all.
    if (navigator.share && (!navigator.canShare || navigator.canShare({ text }))) {
        navigator.share({ title, text }).catch(() => {
            // Cancelling the share sheet rejects. That is a choice, not a fault.
        });
        return;
    }

    window.location.href = 'sms:?body=' + encodeURIComponent(text);
}

// The four root screens that carry the bottom tab bar. Every other screen is a
// detail screen: the bar hides and its own ← Back button does the navigating.
const TAB_SCREENS = {
    homeScreen: 'home',
    instructionsListScreen: 'instructions',
    actionsScreen: 'actions',
    settingsScreen: 'settings'
};

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });
    const screen = document.getElementById(screenId);
    if (screen) {
        screen.classList.add('active');
    }
    updateTabBar(screenId);
}

function updateTabBar(screenId) {
    const tabbar = document.getElementById('tabbar');
    if (!tabbar) return;

    const activeTab = TAB_SCREENS[screenId];
    tabbar.hidden = !activeTab;

    // Paint the whole app in the current tab's colour. Only root screens set it:
    // a detail screen keeps the colour of the tab it was opened from, so the
    // accent stays a thread back to where you came from.
    if (activeTab) {
        document.body.dataset.tab = activeTab;
    }

    tabbar.querySelectorAll('.tab').forEach(tab => {
        const isActive = tab.dataset.tab === activeTab;
        tab.classList.toggle('active', isActive);
        if (isActive) {
            tab.setAttribute('aria-current', 'page');
        } else {
            tab.removeAttribute('aria-current');
        }
    });
}

async function openTab(tabName) {
    switch (tabName) {
        case 'home':
            await renderHomeScreen();
            showScreen('homeScreen');
            break;
        case 'instructions':
            // Clear the box too, or it claims to be filtering a list that isn't.
            // Same for the filters, and the panel folds shut behind them.
            document.getElementById('searchInput').value = '';
            clearFilters();
            toggleFilterPanel(false);
            toggleBulkPanel(false);
            toggleSortPanel(false);
            await renderInstructionsList();
            showScreen('instructionsListScreen');
            break;
        case 'actions':
            await renderActionsList();
            showScreen('actionsScreen');
            break;
        case 'settings':
            prepareBackup();   // so "Back Up Now" can open the share sheet without waiting
            showScreen('settingsScreen');
            break;
    }
}

// Open-to-do count on the Actions tab. Kept in step with the Home nudge card so
// the two can never disagree about how much is outstanding.
async function updateActionsBadge() {
    const badge = document.getElementById('tabActionsBadge');
    if (!badge) return;

    try {
        const open = (await getOpenActions()).length;
        badge.textContent = open > 99 ? '99+' : open;
        badge.hidden = open === 0;
    } catch (error) {
        console.warn('[Tabs] Could not count open actions:', error);
        badge.hidden = true;
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
    // Typographic stars, not the emoji: a rating is the one place a repeated
    // character beats a drawn icon, and ★ inherits the text colour instead of
    // dropping three yellow blobs into an otherwise monochrome interface.
    const stars = ['', '★', '★★', '★★★'];
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

    updateNextDueLine(instruction);

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
    renderSteps(instruction);

    // Photos. Anything pinned to a step has already been shown beside that step
    // by renderSteps, so the gallery holds only what is left — and disappears
    // entirely once every photo has found a step to belong to.
    const galleryPhotos = (instruction.photos || [])
        .filter(photo => pinnedStepIndex(photo, instruction) === null);

    if (galleryPhotos.length > 0) {
        document.getElementById('photosSection').style.display = 'flex';
        const photosGal = document.getElementById('instructionPhotos');
        photosGal.innerHTML = '';
        galleryPhotos.forEach(photo => {
            const img = document.createElement('img');
            img.src = photo.data;
            img.className = 'photo-thumbnail';
            photosGal.appendChild(img);
        });
        updatePreviewIndicator('photosPreview', true);
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

            const numberEl = document.createElement('span');
            numberEl.className = 'related-number';
            numberEl.textContent = relNum;

            const titleEl = document.createElement('span');
            titleEl.className = 'related-title';

            div.appendChild(numberEl);
            div.appendChild(titleEl);
            relList.appendChild(div);

            // Looked up rather than stored alongside the number, so renaming an
            // instruction updates every instruction that points at it — without
            // any of them needing to be re-saved.
            getInstruction(relNum).then(related => {
                if (related) {
                    titleEl.textContent = related.title;
                    div.addEventListener('click', () => navigateToInstruction(relNum));
                    return;
                }

                // A number that no longer exists is worth saying out loud. A row
                // that quietly does nothing when tapped just looks broken.
                titleEl.textContent = 'No longer exists';
                div.classList.add('is-missing');
            });
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

// Which step a photo belongs to, or null for the gallery at the bottom.
//
// A photo only counts as pinned if it points at a step that still exists. Shorten
// an instruction's steps and its orphaned photos fall back to the gallery rather
// than disappearing from the app altogether.
function pinnedStepIndex(photo, instruction) {
    const total = (instruction.steps || []).length;
    const step = photo.step;
    return Number.isInteger(step) && step >= 0 && step < total ? step : null;
}

// The steps, with your place in them kept. Tick three of twelve, walk away, lock
// the phone, come back — the three are still ticked. Losing your place halfway
// through a job you are doing with wet hands is the whole reason this exists.
function renderSteps(instruction) {
    const stepsList = document.getElementById('instructionSteps');
    const steps = instruction.steps || [];
    const ticked = new Set(stepProgressFor(instruction));
    const photos = instruction.photos || [];

    stepsList.innerHTML = '';

    steps.forEach((step, i) => {
        const li = document.createElement('li');
        li.classList.toggle('step-done', ticked.has(i));

        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.step = i;
        box.checked = ticked.has(i);

        box.addEventListener('change', () => {
            if (box.checked) {
                ticked.add(i);
            } else {
                ticked.delete(i);
            }
            li.classList.toggle('step-done', box.checked);
            saveStepProgress(instruction, [...ticked].sort((a, b) => a - b));
            updateStepProgressLine(instruction);
        });

        label.appendChild(box);
        // textContent rather than innerHTML: a step is text someone typed, and
        // an apostrophe or a "<" in it should read as itself.
        label.appendChild(document.createTextNode(' ' + step));
        li.appendChild(label);

        // A photo pinned to this step sits directly under it. The picture of the
        // valve belongs beside the instruction to turn the valve — not in a
        // gallery at the bottom that you have to scroll to and match up yourself.
        const stepPhotos = photos.filter(photo => pinnedStepIndex(photo, instruction) === i);
        if (stepPhotos.length > 0) {
            li.classList.add('has-photos');

            const strip = document.createElement('div');
            strip.className = 'step-photos';

            stepPhotos.forEach(photo => {
                const img = document.createElement('img');
                img.className = 'step-photo';
                img.src = photo.data;
                img.alt = '';
                img.loading = 'lazy';
                strip.appendChild(img);
            });

            li.appendChild(strip);
        }

        stepsList.appendChild(li);
    });

    updateStepProgressLine(instruction);
}

function updateStepProgressLine(instruction) {
    const line = document.getElementById('stepProgress');
    const text = document.getElementById('stepProgressText');
    const total = (instruction.steps || []).length;
    const done = stepProgressFor(instruction).length;

    // Only appears once you are actually part-way through. "0 of 12 done" on an
    // instruction you just opened is a line of noise above every set of steps.
    line.hidden = done === 0;
    text.textContent = done + ' of ' + total + ' done';
}

function updateNextDueLine(instruction) {
    const el = document.getElementById('instructionNextDue');
    const dueAt = nextDueAt(instruction);

    el.textContent = describeNextDue(instruction);
    el.classList.toggle('is-due', dueAt !== null && dueAt <= Date.now());
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
    await renderRunNudge();
    await renderDueNudge();
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
            // The recent store only keeps a snapshot — number, title, category — so
            // it has no photos to make a thumbnail from, and its title goes stale if
            // the instruction is renamed. Use the live instruction where there is
            // one, and fall back to the snapshot only if it has since been deleted.
            const live = instructions.find(i => i.id === item.id) || item;
            const card = createInstructionCard(live);
            card.addEventListener('click', () => navigateToInstruction(live.number));
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

    // v27.0: same rule as the list rows — a thumbnail only where there is a photo.
    const thumb = photoThumb(instruction);
    if (thumb) {
        const img = document.createElement('img');
        img.className = 'instruction-card-thumb';
        img.src = thumb;
        img.alt = '';
        img.loading = 'lazy';
        card.appendChild(img);
    }

    card.appendChild(number);
    card.appendChild(textDiv);

    return card;
}

// The order categories appear in on the All Instructions screen. Deliberately not
// alphabetical — it follows the same RV / Life / Sport grouping as the category
// picker, so related categories sit next to each other. Anything not listed here
// (a category from an older backup, say) is appended at the end rather than lost.
const CATEGORY_ORDER = [
    'General', 'Bedroom', 'Driving', 'Water', 'Maintenance', 'Safety',
    'Home',
    'Diving', 'Running', 'Cycling', 'Swimming', 'Golf', 'Strength', 'Mobility', 'Meditation'
];

const OPEN_GROUPS_KEY = 'ams_open_instruction_groups';

function openGroups() {
    try {
        return new Set(JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) || '[]'));
    } catch (error) {
        return new Set();
    }
}

function saveOpenGroups(set) {
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify([...set]));
}

// Names for the owner pills on list rows, keyed by person id. A row is built
// synchronously and there are hundreds of them, so the People store is read once
// per screenful into here rather than once per row. Kept up to date by
// loadOwnerNames(), which every screen that draws rows awaits first.
let ownerNamesById = new Map();
let ownerHuesByName = new Map();

// Colours for the owner pills. Picked to sit well apart on the wheel, so the
// first few people are told apart by colour alone, and to stay clear of the
// jade the Instructions tab paints everything else with.
const OWNER_HUES = [205, 25, 280, 330, 95, 175, 55, 250];

async function loadOwnerNames(people) {
    const list = people || await getAllPeople();

    ownerNamesById = new Map(list.map(person => [person.id, person.name]));

    // Oldest person first, so adding somebody new gives them the next colour
    // rather than shuffling the colours of the people already there.
    ownerHuesByName = new Map(list
        .slice()
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((person, index) => [
            person.name.trim().toLowerCase(),
            OWNER_HUES[index % OWNER_HUES.length]
        ]));
}

// Who owns this, as a name to print — or '' for nobody. Same two shapes the
// person filter and the editor both have to cope with: a person id picked in
// the editor, or a bare name that arrived inside imported data. A dangling id
// (the person has since been deleted) falls back to the stored name rather than
// printing an id at somebody.
function ownerNameFor(instruction) {
    if (instruction.ownerId && ownerNamesById.has(instruction.ownerId)) {
        return ownerNamesById.get(instruction.ownerId);
    }
    return String(instruction.owner || '').trim();
}

// A stable colour per person, so Anna's rows and Martin's rows can be told
// apart down a long list without reading either name. People get a colour from
// the list above by how long they have been in People; a name belonging to
// nobody — imported data, mostly — is hashed into the same set, so it is
// coloured consistently too rather than looking broken. Nothing is stored: a
// colour is worked out from what is already there, so there is no migration and
// nothing to go stale. Only the hue is decided here — how light or dark that
// hue has to be to stay readable differs between the two themes, and that is
// the stylesheet's business.
function ownerHue(name) {
    const key = name.trim().toLowerCase();
    if (ownerHuesByName.has(key)) return ownerHuesByName.get(key);

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) % 4096;
    }
    return OWNER_HUES[hash % OWNER_HUES.length];
}

function ownerPill(name) {
    const pill = document.createElement('span');
    pill.className = 'list-item-owner';
    pill.style.setProperty('--owner-hue', ownerHue(name));
    pill.appendChild(spriteIcon('person', 'owner-glyph'));
    pill.appendChild(document.createTextNode(name));
    return pill;
}

// One row in the list. Used both grouped and flat, so a search result and a
// browsed result look and behave identically.
function createInstructionRow(instr) {
    const item = document.createElement('div');
    item.className = 'list-item';

    const info = document.createElement('div');
    info.className = 'list-item-info';
    info.addEventListener('click', () => navigateToInstruction(instr.number));

    // Only instructions that actually have a photo get one. A placeholder on the
    // couple of hundred that do not would be noise, and the thumbnail doubles as
    // a signal that there is a picture worth opening.
    const thumb = photoThumb(instr);
    let thumbEl = null;
    if (thumb) {
        thumbEl = document.createElement('img');
        thumbEl.className = 'list-item-thumb';
        thumbEl.src = thumb;
        thumbEl.alt = '';
        thumbEl.loading = 'lazy';
        thumbEl.addEventListener('click', () => navigateToInstruction(instr.number));
    }

    const numberEl = document.createElement('div');
    numberEl.className = 'list-item-number';
    numberEl.textContent = instr.number;

    const titleEl = document.createElement('div');
    titleEl.className = 'list-item-title';
    titleEl.textContent = instr.title;

    // Category and owner share one line. Inside a folded category group the
    // category itself is hidden by CSS — the header already says it — and the
    // owner pill stays, which is exactly the case the pill is most use in:
    // one open category, and you want to see whose jobs are in it.
    const metaEl = document.createElement('div');
    metaEl.className = 'list-item-meta';

    const categoryEl = document.createElement('div');
    categoryEl.className = 'list-item-category';
    categoryEl.textContent = instr.category;
    metaEl.appendChild(categoryEl);

    // No pill where nobody is named. A "No owner" mark on the couple of hundred
    // instructions that haven't got one would drown the ones that have; the
    // "Nobody named" filter and Library Health are the places to go looking for
    // those on purpose.
    const owner = ownerNameFor(instr);
    if (owner) metaEl.appendChild(ownerPill(owner));

    info.appendChild(numberEl);
    info.appendChild(titleEl);
    info.appendChild(metaEl);

    const editBtn = document.createElement('button');
    editBtn.className = 'list-item-edit';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        editInstruction(instr);
    });

    if (thumbEl) { item.appendChild(thumbEl); }
    item.appendChild(info);
    item.appendChild(editBtn);
    return item;
}

// Everything a search reads, and what to call each one on screen.
//
// Number, title and category are searched too but are deliberately absent from
// this list: they are already printed on the row, so "matched in Title" would
// only ever state the obvious.
const SEARCHABLE_FIELDS = [
    { key: 'description', label: 'Description' },
    { key: 'steps', label: 'Steps' },
    { key: 'warnings', label: 'Warnings' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'preparations', label: 'Preparations' },
    { key: 'afterUse', label: 'After use' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'notes', label: 'Notes' },
    { key: 'tags', label: 'Tags' },
    { key: 'where', label: 'Location' },
    { key: 'whereDetailed', label: 'Location' },
    { key: 'owner', label: 'Owner' }
];

// Steps are an array, everything else is a string, and a missing field is ''.
function searchableText(value) {
    if (!value) return '';
    return Array.isArray(value) ? value.join('\n') : String(value);
}

// Does this instruction match — and if the hit is somewhere you cannot see from
// the list, where. Naming the field is what stops a match on hidden text looking
// like the search has misfired.
function matchInstruction(instruction, term) {
    const onRow = [instruction.title, instruction.number, instruction.category]
        .map(part => searchableText(part).toLowerCase())
        .some(part => part.includes(term));

    const fields = [];
    SEARCHABLE_FIELDS.forEach(field => {
        if (!searchableText(instruction[field.key]).toLowerCase().includes(term)) return;
        // 'where' and 'whereDetailed' both read as Location — say it once.
        if (!fields.includes(field.label)) fields.push(field.label);
    });

    return { matched: onRow || fields.length > 0, fields };
}

// ---------------------------------------------------------------------------
// Filters on the Instructions tab
//
// Search answers "where did I write that?". Filters answer "what needs my
// attention?" — whose jobs these are, what has fallen due, what is half-finished.
// The two combine, so you can search inside a filtered list.
//
// Chosen within one group they widen (Anna OR Martin); chosen across groups they
// narrow (Anna AND overdue). That is the only arrangement that behaves the way
// people expect without needing to be explained.
//
// Nothing is remembered between visits, exactly like the search box: a filter set
// yesterday and forgotten would show a short list today and look like data loss.
// ---------------------------------------------------------------------------

const FILTER_GROUPS = ['person', 'due', 'status', 'gaps', 'marks'];

function newFilterState() {
    const state = {};
    FILTER_GROUPS.forEach(group => { state[group] = new Set(); });
    return state;
}

let activeFilters = newFilterState();

function activeFilterCount() {
    return FILTER_GROUPS.reduce((total, group) => total + activeFilters[group].size, 0);
}

function clearFilters() {
    activeFilters = newFilterState();
}

const DUE_SOON_DAYS = 7;

// Everything a filter needs that isn't on the instruction itself. Fetched once
// per render rather than per instruction — four reads instead of eight hundred.
async function filterContext() {
    const [people, favourites, actions, audits] = await Promise.all([
        getAllPeople(), getFavorites(), getAllActions(), getAllAudits()
    ]);

    // The rows about to be drawn need the same names for their owner pills.
    // Handing over the list already fetched here saves reading the store twice.
    await loadOwnerNames(people);

    return {
        people: people.slice().sort((a, b) => a.name.localeCompare(b.name)),
        favourites: new Set(favourites),
        openTodos: new Set(actions
            .filter(a => a.status !== 'done' && a.instructionId)
            .map(a => a.instructionId)),
        audited: new Set(audits.map(a => a.instructionId)),
        now: Date.now()
    };
}

// An instruction can carry an owner as a person id (picked in the editor) or as
// a bare name (imported, or typed before People existed). Match either, or the
// same person filtered twice over would quietly miss half their work.
function matchesPerson(instruction, key, context) {
    if (key === 'none') return !instruction.owner || !String(instruction.owner).trim();

    const person = context.people.find(p => p.id === key);
    if (!person) return false;
    if (instruction.ownerId) return instruction.ownerId === key;
    return String(instruction.owner || '').trim().toLowerCase() === person.name.toLowerCase();
}

const FILTER_TESTS = {
    // When it's due. Reuses nextDueAt(), so these agree with the Home "Due now"
    // card and Library Health rather than inventing a second idea of overdue.
    'due:overdue': (i, c) => { const at = nextDueAt(i); return at !== null && at <= c.now; },
    'due:soon': (i, c) => {
        const at = nextDueAt(i);
        return at !== null && at > c.now && at <= c.now + DUE_SOON_DAYS * DAY_MS;
    },
    'due:never': (i) => Boolean(FREQUENCY_DAYS[i.frequency]) && !i.lastCompleted && i.status !== 'Archived',
    'due:noclock': (i) => !FREQUENCY_DAYS[i.frequency],

    // Status, as the instruction records it.
    'status:Active': (i) => i.status === 'Active',
    'status:Draft': (i) => i.status === 'Draft',
    'status:Review Needed': (i) => i.status === 'Review Needed',
    'status:Archived': (i) => i.status === 'Archived',

    // Gaps — the same second look Library Health takes, but browsable.
    'gaps:warning': (i) => !i.warnings || !i.warnings.trim(),
    'gaps:photo': (i) => (i.photos || []).length === 0,
    'gaps:steps': (i) => (i.steps || []).length < 2,

    // Quick marks.
    'marks:favourite': (i, c) => c.favourites.has(i.id),
    'marks:hasphoto': (i) => (i.photos || []).length > 0,
    'marks:todo': (i, c) => c.openTodos.has(i.id),
    'marks:unaudited': (i, c) => !c.audited.has(i.id)
};

function filterMatches(group, key, instruction, context) {
    if (group === 'person') return matchesPerson(instruction, key, context);
    const test = FILTER_TESTS[group + ':' + key];
    return test ? test(instruction, context) : true;
}

function passesFilters(instruction, context) {
    return FILTER_GROUPS.every(group => {
        const chosen = activeFilters[group];
        if (chosen.size === 0) return true;   // nothing chosen here = no opinion
        return [...chosen].some(key => filterMatches(group, key, instruction, context));
    });
}

// The fixed part of the panel. The Person row is built from the People list, so
// it can't be written down here.
const FILTER_SECTIONS = [
    {
        group: 'due',
        title: "When it's due",
        chips: [
            { key: 'overdue', label: 'Overdue', icon: 'due' },
            { key: 'soon', label: 'Due within a week', icon: 'calendar' },
            { key: 'never', label: 'Never done', icon: 'hourglass' },
            { key: 'noclock', label: 'No repeat', icon: 'norepeat' }
        ]
    },
    {
        group: 'status',
        title: 'Status',
        chips: [
            { key: 'Active', label: 'Active', icon: 'active' },
            { key: 'Draft', label: 'Draft', icon: 'notes' },
            { key: 'Review Needed', label: 'Review Needed', icon: 'review' },
            { key: 'Archived', label: 'Archived', icon: 'archive' }
        ]
    },
    {
        group: 'gaps',
        title: 'Gaps worth a second look',
        chips: [
            { key: 'warning', label: 'No warning', icon: 'warning' },
            { key: 'photo', label: 'No photo', icon: 'nophoto' },
            { key: 'steps', label: 'Barely any steps', icon: 'fewsteps' }
        ]
    },
    {
        group: 'marks',
        title: 'Quick marks',
        chips: [
            { key: 'favourite', label: 'Favourite', icon: 'star' },
            { key: 'hasphoto', label: 'Has a photo', icon: 'photo' },
            { key: 'todo', label: 'Has an open to-do', icon: 'actions' },
            { key: 'unaudited', label: 'Never audited', icon: 'audit' }
        ]
    }
];

// One drawn icon from the sprite. Built with createElementNS because <use> lives
// in the SVG namespace — createElement would make an inert HTML element that
// renders as nothing at all.
function spriteIcon(name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');

    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#icon-' + name);
    svg.appendChild(use);

    return svg;
}

function makeFilterChip(group, key, label, count, isOn, icon) {
    const chip = document.createElement('button');
    chip.className = 'filter-chip' + (isOn ? ' on' : '');
    chip.type = 'button';
    chip.dataset.group = group;
    chip.dataset.key = key;
    chip.setAttribute('aria-pressed', isOn ? 'true' : 'false');

    if (icon) chip.appendChild(spriteIcon(icon, 'chip-glyph'));

    const text = document.createElement('span');
    text.textContent = label;
    chip.appendChild(text);

    const badge = document.createElement('span');
    badge.className = 'filter-chip-count';
    badge.textContent = count;
    chip.appendChild(badge);

    // A chip nothing matches is a dead end, so it's shown but not tappable —
    // greyed rather than hidden, because "0 overdue" is itself worth knowing.
    // One already switched on stays tappable, or you couldn't switch it off.
    if (count === 0 && !isOn) chip.disabled = true;

    chip.addEventListener('click', () => {
        const set = activeFilters[group];
        if (set.has(key)) { set.delete(key); } else { set.add(key); }
        refreshInstructionsList();
    });

    return chip;
}

// Counts on each chip are worked out against the whole library, not against the
// other filters. They answer "how much of this is there?" rather than "how much
// would be left?" — the second changes under your finger as you tap and makes
// the panel feel unstable.
function renderFilterPanel(instructions, context) {
    const panel = document.getElementById('filterPanel');
    if (!panel) return;

    const body = panel.querySelector('.filter-panel-body');
    body.innerHTML = '';

    const sections = [
        {
            group: 'person',
            title: 'Whose job it is',
            chips: [
                ...context.people.map(p => ({ key: p.id, label: p.name, icon: 'person' })),
                { key: 'none', label: 'Nobody named', icon: 'question' }
            ]
        },
        ...FILTER_SECTIONS
    ];

    sections.forEach(section => {
        const wrap = document.createElement('div');
        wrap.className = 'filter-group';

        const heading = document.createElement('h4');
        heading.textContent = section.title;
        wrap.appendChild(heading);

        const row = document.createElement('div');
        row.className = 'filter-chips';
        section.chips.forEach(chip => {
            const count = instructions.filter(i => filterMatches(section.group, chip.key, i, context)).length;
            row.appendChild(makeFilterChip(
                section.group, chip.key, chip.label, count,
                activeFilters[section.group].has(chip.key), chip.icon
            ));
        });
        wrap.appendChild(row);

        body.appendChild(wrap);
    });
}

function updateFilterButton() {
    const badge = document.getElementById('filterCount');
    const btn = document.getElementById('filterBtn');
    if (!badge || !btn) return;

    const count = activeFilterCount();
    badge.textContent = count;
    badge.hidden = count === 0;
    btn.classList.toggle('on', count > 0);
}

function toggleFilterPanel(force) {
    const panel = document.getElementById('filterPanel');
    const btn = document.getElementById('filterBtn');
    if (!panel || !btn) return;

    const show = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

// ---------------------------------------------------------------------------
// Sort order for the Instructions tab
//
// Unlike the filters, this IS remembered between visits. A filter hides things,
// so being left on one silently is how a library looks like it has lost data;
// a sort order hides nothing, and having to re-pick "most overdue first" every
// single visit would be its own small daily annoyance.
//
// It applies to the flat list and inside each category group alike, so the
// order never changes meaning depending on how you got there.
// ---------------------------------------------------------------------------

const SORT_KEY = 'ams_instruction_sort';

const byNumber = (a, b) => a.number.localeCompare(b.number);

// Last time the instruction itself was edited. Marking Done and adding an audit
// deliberately write no revision entry, so neither counts as "changed" here.
function lastChangedAt(instruction) {
    const history = instruction.revisionHistory || [];
    const last = history[history.length - 1];
    return last?.timestamp || instruction.createdAt || 0;
}

const SORT_OPTIONS = [
    {
        key: 'number',
        label: 'Number',
        short: 'Number',
        blurb: 'The order on your printed cards.',
        compare: byNumber
    },
    {
        key: 'title',
        label: 'Title A–Z',
        short: 'Title',
        blurb: 'When you remember the words, not the digits.',
        compare: (a, b) => (a.title || '').localeCompare(b.title || '') || byNumber(a, b)
    },
    {
        key: 'due',
        label: 'Most overdue first',
        short: 'Overdue',
        blurb: 'Anything that cannot fall due sits at the bottom.',
        // Never-due instructions sort last rather than first: they are not
        // urgent, and putting "no repeat" above a month-overdue job would make
        // the order actively misleading.
        compare: (a, b) => {
            const dueA = nextDueAt(a);
            const dueB = nextDueAt(b);
            if (dueA === null && dueB === null) return byNumber(a, b);
            if (dueA === null) return 1;
            if (dueB === null) return -1;
            return dueA - dueB || byNumber(a, b);
        }
    },
    {
        key: 'changed',
        label: 'Recently changed',
        short: 'Changed',
        blurb: 'What you have been working on lately.',
        compare: (a, b) => lastChangedAt(b) - lastChangedAt(a) || byNumber(a, b)
    }
];

function currentSort() {
    const saved = localStorage.getItem(SORT_KEY);
    return SORT_OPTIONS.find(option => option.key === saved) || SORT_OPTIONS[0];
}

function saveSort(key) {
    localStorage.setItem(SORT_KEY, key);
}

// Never sorts in place: the array handed in belongs to the caller, and in the
// grouped path it is the same array the group counts were taken from.
function sortInstructions(items) {
    return [...items].sort(currentSort().compare);
}

function renderSortPanel() {
    const panel = document.getElementById('sortPanel');
    if (!panel) return;

    const body = panel.querySelector('.sort-panel-body');
    body.innerHTML = '';

    const active = currentSort();

    SORT_OPTIONS.forEach(option => {
        const row = document.createElement('button');
        row.className = 'sort-option' + (option.key === active.key ? ' on' : '');
        row.type = 'button';

        const tick = document.createElement('span');
        tick.className = 'sort-tick';
        tick.textContent = option.key === active.key ? '✓' : '';

        const text = document.createElement('span');
        text.className = 'sort-option-text';

        const label = document.createElement('span');
        label.className = 'sort-option-label';
        label.textContent = option.label;

        const blurb = document.createElement('span');
        blurb.className = 'sort-option-blurb';
        blurb.textContent = option.blurb;

        text.appendChild(label);
        text.appendChild(blurb);

        row.appendChild(tick);
        row.appendChild(text);

        row.addEventListener('click', async () => {
            saveSort(option.key);
            toggleSortPanel(false);
            await refreshInstructionsList();
        });

        body.appendChild(row);
    });
}

// The button says which order you are in, so a list that looks odd is never a
// mystery — the answer is written on the control that caused it.
function updateSortButton() {
    const btn = document.getElementById('sortBtn');
    if (btn) btn.textContent = '↕ ' + currentSort().short + ' ▾';
}

function toggleSortPanel(force) {
    const panel = document.getElementById('sortPanel');
    const btn = document.getElementById('sortBtn');
    if (!panel || !btn) return;

    const show = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) renderSortPanel();
}

// Re-draw the list exactly as the user left it — same search term, same filters.
//
// Everything that changes an instruction and comes back to the list goes through
// here. Calling renderInstructionsList() bare instead redraws the whole library
// while the search box still shows your term, so saving an edit looked like the
// search had quietly given up.
async function refreshInstructionsList() {
    await renderInstructionsList(document.getElementById('searchInput').value);
}

async function clearFiltersAndRender() {
    clearFilters();
    await refreshInstructionsList();
}

// ---------------------------------------------------------------------------
// Bulk actions on the filtered slice
//
// Library Health's fixers answer one fixed question each and only fill blanks.
// These act on exactly what the filter has put on screen, which is what makes
// "the Diving instructions are Anna's" a job of six taps rather than sixty.
//
// Every one of them is a deliberate overwrite, so all three go through a modal
// that states the count and says plainly what it replaces, and all three leave
// an Undo behind. Bulk edits deliberately write no revision history — two
// hundred "Updated" entries would bury the real edits under bookkeeping.
// ---------------------------------------------------------------------------

// Exactly the rows currently on screen. Set on every render, so it can never
// describe a list the screen isn't showing.
let visibleInstructions = [];

const BULK_STATUSES = ['Active', 'Draft', 'Review Needed', 'Archived'];

const BULK_UNDO_KEY = 'bulk_undo';

// The snapshot records only the fields the change actually touches, not whole
// instructions. That is the difference between a few kilobytes and a copy of
// every photo in the library — and it means an undo three days later restores
// the owner without also reverting the steps you rewrote yesterday.
function snapshotOf(items, fields) {
    return items.map(item => {
        const before = { id: item.id };
        fields.forEach(field => { before[field] = item[field]; });
        return before;
    });
}

// Puts back the last bulk change, whether that's five seconds later from the
// toast or five days later from Data Safety. Consumed once used, so the same
// change can't be undone twice.
//
// Instructions deleted since the change are skipped rather than resurrected:
// undo restores the values of things that still exist, and is not a way of
// bringing back something you meant to delete.
async function undoBulkChange() {
    const record = await getSetting(BULK_UNDO_KEY);
    if (!record || !record.entries || record.entries.length === 0) return;

    const byId = new Map((await getAllInstructions()).map(i => [i.id, i]));

    const updates = [];
    let missing = 0;
    record.entries.forEach(entry => {
        const current = byId.get(entry.id);
        if (!current) { missing++; return; }

        const restored = { ...current };
        record.fields.forEach(field => { restored[field] = entry[field]; });
        updates.push(restored);
    });

    if (updates.length > 0) await bulkUpdateInstructions(updates);
    await deleteSetting(BULK_UNDO_KEY);

    await refreshInstructionsList();
    await renderDataSafety();

    showToast(missing > 0
        ? '↩︎ Put back ' + updates.length + ' — ' + missing +
          (missing === 1 ? ' no longer exists' : ' no longer exist')
        : '↩︎ Put back as it was');
}

async function applyBulkChange(items, change, describe, toastText, fields) {
    if (items.length === 0) return;

    showModal(describe.title, describe.message, async (confirmed) => {
        if (!confirmed) return;

        const entries = snapshotOf(items, fields);
        const count = await bulkUpdateInstructions(items.map(change));

        // Written after the change, not before: a snapshot offering to undo
        // something that never happened would be worse than no snapshot.
        await saveSetting(BULK_UNDO_KEY, {
            label: toastText(count),
            timestamp: Date.now(),
            fields,
            entries
        });

        await refreshInstructionsList();

        showToast('✓ ' + toastText(count), { label: 'Undo', onClick: undoBulkChange });
    });
}

async function renderBulkPanel() {
    const panel = document.getElementById('bulkPanel');
    if (!panel) return;

    const items = visibleInstructions;
    const count = items.length;
    panel.querySelector('.bulk-scope').textContent = count === 1
        ? 'The 1 instruction now listed'
        : 'All ' + count + ' instructions now listed';

    const people = await getAllPeople();
    people.sort((a, b) => a.name.localeCompare(b.name));

    const ownerSelect = document.getElementById('bulkOwnerSelect');
    const ownerBtn = document.getElementById('bulkOwnerBtn');
    const ownerNote = document.getElementById('bulkOwnerNote');
    const previous = ownerSelect.value;

    ownerSelect.innerHTML = '';
    people.forEach(person => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = person.name;
        ownerSelect.appendChild(option);
    });
    if (people.some(p => p.id === previous)) ownerSelect.value = previous;

    const noPeople = people.length === 0;
    ownerSelect.hidden = noPeople;
    ownerBtn.hidden = noPeople;
    ownerNote.hidden = !noPeople;
    ownerBtn.textContent = 'Set owner on ' + count;

    document.getElementById('bulkTagBtn').textContent = 'Add tag to ' + count;
    document.getElementById('bulkStatusBtn').textContent = 'Set status on ' + count;
}

function bulkScopeNote() {
    // Worth spelling out: with a search term as well, the slice is the overlap,
    // and "all 12" would otherwise sound like all twelve of something bigger.
    const term = document.getElementById('searchInput').value.trim();
    return term ? ' (the filtered list, narrowed by your search for "' + term + '")' : '';
}

async function handleBulkOwner() {
    const select = document.getElementById('bulkOwnerSelect');
    if (!select.value) return;

    const personId = select.value;
    const personName = select.options[select.selectedIndex].textContent;
    const items = visibleInstructions;

    await applyBulkChange(
        items,
        (instruction) => ({ ...instruction, owner: personName, ownerId: personId }),
        {
            title: 'Set owner on ' + items.length + '?',
            message: personName + ' becomes the owner of all ' + items.length +
                ' instructions currently listed' + bulkScopeNote() +
                '. This replaces any owner they already have. You can undo it straight afterwards.'
        },
        (count) => personName + ' set as owner on ' + count,
        ['owner', 'ownerId']
    );
}

async function handleBulkTag() {
    const input = document.getElementById('bulkTagInput');
    const tag = input.value.trim();
    if (!tag) {
        alert('Type a tag first.');
        return;
    }

    const items = visibleInstructions;

    await applyBulkChange(
        items,
        (instruction) => {
            const tags = instruction.tags || [];
            // A new array, never a push: the Undo snapshot shares this reference.
            return tags.includes(tag) ? { ...instruction } : { ...instruction, tags: [...tags, tag] };
        },
        {
            title: 'Add "' + tag + '" to ' + items.length + '?',
            message: 'The tag is added to all ' + items.length + ' instructions currently listed' +
                bulkScopeNote() + '. Any that already carry it are left alone, and nothing else changes. ' +
                'Tags are searchable, so this is a way to mark a batch you want to find again.'
        },
        (count) => '"' + tag + '" added to ' + count,
        ['tags']
    );

    input.value = '';
}

async function handleBulkStatus() {
    const status = document.getElementById('bulkStatusSelect').value;
    const items = visibleInstructions;

    const extra = status === 'Archived'
        ? ' Archived instructions never fall due, and drop off the Due list.'
        : '';

    await applyBulkChange(
        items,
        (instruction) => ({ ...instruction, status }),
        {
            title: 'Set status to ' + status + ' on ' + items.length + '?',
            message: 'All ' + items.length + ' instructions currently listed' + bulkScopeNote() +
                ' are set to ' + status + ', replacing whatever status they have now.' + extra +
                ' You can undo it straight afterwards.'
        },
        (count) => count + ' set to ' + status,
        ['status']
    );
}

function toggleBulkPanel(force) {
    const panel = document.getElementById('bulkPanel');
    const btn = document.getElementById('bulkOpenBtn');
    if (!panel || !btn) return;

    const show = typeof force === 'boolean' ? force : panel.hidden;
    panel.hidden = !show;
    btn.setAttribute('aria-expanded', show ? 'true' : 'false');
}

async function renderInstructionsList(filter = '') {
    const list = document.getElementById('instructionsList');
    const summary = document.getElementById('listSummary');
    const instructions = await getAllInstructions();
    const context = await filterContext();

    renderFilterPanel(instructions, context);
    updateFilterButton();
    updateSortButton();

    const term = filter.trim().toLowerCase();
    const filtering = activeFilterCount() > 0;

    // Where each result was found, so the rows can say so without matching twice.
    const matchedFields = new Map();
    const filtered = instructions.filter(instruction => {
        if (!passesFilters(instruction, context)) return false;
        if (!term) return true;

        const result = matchInstruction(instruction, term);
        if (result.matched) matchedFields.set(instruction.id, result.fields);
        return result.matched;
    });

    // What the bulk actions will act on: exactly these rows, nothing implied.
    // Only offered while filtering — acting on a whole unfiltered library from
    // a button beside the search box is not something anyone means to do.
    visibleInstructions = filtering ? filtered : [];
    const bulkBar = document.getElementById('bulkBar');
    if (bulkBar) {
        const offer = filtering && filtered.length > 0;
        bulkBar.hidden = !offer;
        if (offer) {
            document.getElementById('bulkOpenBtn').textContent =
                '⚡ Apply to all ' + filtered.length + '…';
            await renderBulkPanel();
        } else {
            toggleBulkPanel(false);
        }
    }

    list.innerHTML = '';

    if (filtered.length === 0) {
        // Naming the filters matters more than naming the search: the search box
        // is visible and obviously empty-handed, whereas a filter left on three
        // screens ago is exactly the thing you'd forget you had set.
        let nothing = 'No instructions found.';
        if (filtering && term) nothing = 'Nothing matches that search inside these filters.';
        else if (filtering) nothing = 'Nothing matches these filters.';

        list.innerHTML = '<p class="empty-state">' + nothing + '</p>';
        if (summary) {
            summary.hidden = !filtering;
            if (filtering) {
                summary.querySelector('.list-summary-text').textContent = '0 of ' + instructions.length;
                summary.querySelector('#toggleAllGroupsBtn').hidden = true;
                summary.querySelector('#clearFiltersBtn').hidden = false;
            }
        }
        return;
    }

    // Searching or filtering shows a flat list. Grouping would bury results
    // behind folded headers, which is the opposite of what both are for.
    if (term || filtering) {
        sortInstructions(filtered).forEach(instr => {
            const row = createInstructionRow(instr);

            const fields = matchedFields.get(instr.id) || [];
            if (fields.length > 0) {
                const note = document.createElement('div');
                note.className = 'list-item-match';
                note.textContent = 'matched in ' + fields.join(', ');
                row.querySelector('.list-item-info').appendChild(note);
            }

            list.appendChild(row);
        });
        if (summary) {
            summary.hidden = false;
            summary.querySelector('.list-summary-text').textContent = filtering
                ? filtered.length + ' of ' + instructions.length + (term ? ' · searched' : '')
                : filtered.length + (filtered.length === 1 ? ' match' : ' matches');
            summary.querySelector('#toggleAllGroupsBtn').hidden = true;
            summary.querySelector('#clearFiltersBtn').hidden = !filtering;
        }
        return;
    }

    // Browsing: one collapsible group per category.
    const byCategory = new Map();
    filtered.forEach(instr => {
        const cat = instr.category || 'General';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(instr);
    });

    const ordered = [
        ...CATEGORY_ORDER.filter(c => byCategory.has(c)),
        ...[...byCategory.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort()
    ];

    const open = openGroups();

    ordered.forEach(cat => {
        const items = sortInstructions(byCategory.get(cat));
        const isOpen = open.has(cat);

        const section = document.createElement('section');
        section.className = 'instruction-section group-section';

        const toggle = document.createElement('div');
        toggle.className = 'section-toggle group-toggle' + (isOpen ? '' : ' collapsed');
        toggle.dataset.group = cat;

        const swatch = document.createElement('span');
        swatch.className = 'group-swatch ' + cat.toLowerCase();

        const heading = document.createElement('h3');
        heading.textContent = cat;

        const count = document.createElement('span');
        count.className = 'group-count';
        count.textContent = items.length;

        const icon = document.createElement('span');
        icon.className = 'toggle-icon';
        icon.textContent = '▼';

        toggle.appendChild(swatch);
        toggle.appendChild(heading);
        toggle.appendChild(count);
        toggle.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'section-content group-content' + (isOpen ? ' expanded' : '');
        items.forEach(instr => content.appendChild(createInstructionRow(instr)));

        section.appendChild(toggle);
        section.appendChild(content);
        list.appendChild(section);
    });

    if (summary) {
        summary.hidden = false;
        // Short enough to share one line with Expand all and the sort control
        summary.querySelector('.list-summary-text').textContent =
            `${ordered.length} groups · ${filtered.length}`;
        const btn = summary.querySelector('#toggleAllGroupsBtn');
        btn.hidden = false;
        btn.textContent = open.size >= ordered.length ? 'Collapse all' : 'Expand all';
        summary.querySelector('#clearFiltersBtn').hidden = true;
    }
}

async function toggleAllGroups() {
    const open = openGroups();
    const groups = [...document.querySelectorAll('#instructionsList .group-toggle')]
        .map(t => t.dataset.group);
    // If everything is already open, this collapses; otherwise it opens everything.
    const shouldOpen = open.size < groups.length;
    saveOpenGroups(shouldOpen ? new Set(groups) : new Set());
    await refreshInstructionsList();
}

// An owner stored as a bare name, with no matching person record. Kept as a
// distinguishable select value so a save can write the name straight back.
const OWNER_NAME_PREFIX = 'name:';

// Populates the Owner and Revised-by selects from the People store.
//
// An instruction can carry its owner two ways: as a person id (picked here) or
// as a bare name (imported, or typed before People existed). Both must survive
// a trip through this editor. Resolving only by id — which is what this did
// until v38 — left the select on "-- Select --" for a name-only owner, and
// saving then wrote that empty value straight over the name. Opening an
// instruction and saving it unchanged silently erased its owner.
//
// Revised-by always defaults to the last person used, for one-tap convenience.
async function populateOwnerAndRevisedBySelects(selectedOwnerId, ownerName) {
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

    const name = String(ownerName || '').trim();
    const byName = people.find(p => p.name.toLowerCase() === name.toLowerCase());

    if (selectedOwnerId && people.some(p => p.id === selectedOwnerId)) {
        ownerSelect.value = selectedOwnerId;
    } else if (byName) {
        // A name that matches somebody real: quietly adopt their record, so
        // saving upgrades the instruction from a loose name to a proper link.
        ownerSelect.value = byName.id;
    } else if (name) {
        // A name belonging to nobody in People. Shown rather than dropped, and
        // labelled so it's clear why it looks different from the others.
        const opt = document.createElement('option');
        opt.value = OWNER_NAME_PREFIX + name;
        opt.textContent = name + ' (not in People)';
        ownerSelect.appendChild(opt);
        ownerSelect.value = opt.value;
    } else {
        ownerSelect.value = '';
    }

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
    await populateOwnerAndRevisedBySelects(instruction.ownerId || '', instruction.owner);
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
                await refreshInstructionsList();
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

// Photos used to be stored exactly as the camera produced them. A single iPhone
// photo is 4-7 MB once base64-encoded, five of those is 30 MB on one instruction,
// and the localStorage backup mirror tops out around 5 MB — so one photo was
// enough to stop the backup working. Every photo is now downscaled on the way in,
// and carries a small thumbnail for the lists.
const PHOTO_MAX_EDGE = 1400;   // plenty for reading a label or a valve position
const PHOTO_QUALITY = 0.8;
const THUMB_MAX_EDGE = 240;
const THUMB_QUALITY = 0.7;

function resizeToDataUrl(img, maxEdge, quality) {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
        data: canvas.toDataURL('image/jpeg', quality),
        width: canvas.width,
        height: canvas.height
    };
}

// A data URL is base64, where 4 characters carry 3 bytes. The old size line
// counted the characters instead, which overstated every photo by a third.
function dataUrlBytes(dataUrl) {
    if (!dataUrl) return 0;
    const body = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const padding = body.endsWith('==') ? 2 : (body.endsWith('=') ? 1 : 0);
    return Math.max(0, Math.round(body.length * 3 / 4) - padding);
}

function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
}

function preparePhoto(file) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('that file is not an image'));
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error('could not read the file'));
        reader.onload = (event) => {
            const img = new Image();
            img.onerror = () => reject(new Error('could not read that image'));
            img.onload = () => {
                try {
                    const full = resizeToDataUrl(img, PHOTO_MAX_EDGE, PHOTO_QUALITY);
                    const small = resizeToDataUrl(img, THUMB_MAX_EDGE, THUMB_QUALITY);
                    resolve({
                        name: file.name,
                        data: full.data,
                        thumb: small.data,
                        // The dimensions of what is actually stored, not of the original.
                        width: full.width,
                        height: full.height,
                        originalSize: file.size,
                        addedAt: Date.now()
                    });
                } catch (error) {
                    reject(error);
                }
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Photos added before v27.0 have no thumbnail, so fall back to the full image.
function photoThumb(instruction) {
    const photo = instruction.photos && instruction.photos[0];
    return photo ? (photo.thumb || photo.data) : null;
}

// The steps as they stand in the editor right now — the photo pickers are built
// from these, so they follow steps that have not been saved yet.
function editorStepTitles() {
    return document.getElementById('editorSteps').value
        .split('\n')
        .map(step => step.trim())
        .filter(step => step);
}

function renderPhotosList() {
    const list = document.getElementById('editorPhotosList');
    list.innerHTML = '';
    currentPhotos.forEach((photo, i) => {
        const div = document.createElement('div');
        div.className = 'photo-item';

        const img = document.createElement('img');
        // The thumbnail is enough for a 60px preview; the full photo would be
        // decoded five times over on a screen that never shows it that big.
        img.src = photo.thumb || photo.data;

        const info = document.createElement('div');
        info.className = 'photo-item-info';

        const name = document.createElement('div');
        name.className = 'photo-item-name';
        name.textContent = photo.name;

        const size = document.createElement('div');
        size.className = 'photo-item-size';
        const stored = dataUrlBytes(photo.data) + dataUrlBytes(photo.thumb);
        let sizeText = formatBytes(stored);
        if (photo.width && photo.height) {
            sizeText = photo.width + ' × ' + photo.height + ' · ' + sizeText;
        }
        // Only photos added from v27.0 on know what they came from.
        if (photo.originalSize && photo.originalSize > stored) {
            sizeText += ' (was ' + formatBytes(photo.originalSize) + ')';
        }
        size.textContent = sizeText;

        // Where this photo should appear. Built from whatever is in the steps box
        // right now, so it keeps up with steps you are still writing.
        const stepSelect = document.createElement('select');
        stepSelect.className = 'photo-item-step';
        stepSelect.setAttribute('aria-label', 'Where to show this photo');

        const galleryOption = document.createElement('option');
        galleryOption.value = '';
        galleryOption.textContent = 'In the photo gallery';
        stepSelect.appendChild(galleryOption);

        editorStepTitles().forEach((text, index) => {
            const option = document.createElement('option');
            option.value = index;
            // The step's own words, not just its number — otherwise you have to
            // count down the list to work out which step 7 is.
            option.textContent = 'Step ' + (index + 1) + ' — ' +
                (text.length > 40 ? text.slice(0, 40) + '…' : text);
            stepSelect.appendChild(option);
        });

        const wanted = Number.isInteger(photo.step) ? String(photo.step) : '';
        stepSelect.value = wanted;
        // Pinned to a step that no longer exists, because the steps were cut
        // short: fall back to the gallery rather than silently keeping a
        // pointer to nothing.
        if (stepSelect.value !== wanted) photo.step = null;

        stepSelect.addEventListener('change', () => {
            photo.step = stepSelect.value === '' ? null : Number(stepSelect.value);
        });

        info.appendChild(name);
        info.appendChild(size);
        info.appendChild(stepSelect);
        div.appendChild(img);
        div.appendChild(info);

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

    // Three possible shapes: a real person, a bare name nobody in People matches,
    // or genuinely nobody. Only the last one is allowed to clear the owner.
    const ownerSelect = document.getElementById('editorOwner');
    const chosen = ownerSelect.value;
    let ownerId = null;
    let ownerName = '';
    if (chosen.startsWith(OWNER_NAME_PREFIX)) {
        ownerName = chosen.slice(OWNER_NAME_PREFIX.length);
    } else if (chosen) {
        ownerId = chosen;
        ownerName = ownerSelect.options[ownerSelect.selectedIndex].textContent;
    }

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
    await refreshInstructionsList();
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

    await updateActionsBadge();
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

    await updateActionsBadge();

    if (open.length === 0) {
        nudge.style.display = 'none';
        return;
    }

    const high = open.filter(a => a.priority === 'high').length;
    detail.textContent = open.length + ' open' + (high ? ' · ' + high + ' high-priority' : '');
    nudge.style.display = 'flex';
}

// A run in progress, offered back from the Home screen. Top of the pile: you
// are in the middle of it, and a half-finished departure checklist is the most
// urgent thing the app can be holding.
async function renderRunNudge() {
    const nudge = document.getElementById('runNudge');
    const run = currentRun();

    if (!run) {
        nudge.style.display = 'none';
        return;
    }

    document.getElementById('runNudgeTitle').textContent = run.name;
    document.getElementById('runNudgeDetail').textContent =
        run.ticked.length + ' of ' + run.numbers.length + ' done · tap to carry on';
    nudge.style.display = 'flex';
}

// The "Due now" card. The app has always known an instruction's frequency and
// when it was last done, and never once put the two together — this is that
// arithmetic, on the Home screen, where it can actually change what you do next.
async function renderDueNudge() {
    const nudge = document.getElementById('dueNudge');
    const detail = document.getElementById('dueNudgeDetail');
    const due = await getDueInstructions();

    if (due.length === 0) {
        nudge.style.display = 'none';
        return;
    }

    // getDueInstructions sorts most overdue first, so the worst one is the head.
    const worst = due[0];
    detail.textContent = due.length + ' due · oldest ' + overdueBy(worst.dueAt);
    nudge.style.display = 'flex';
}

async function renderDueList() {
    const list = document.getElementById('dueList');
    const due = await getDueInstructions();
    await loadOwnerNames();

    list.innerHTML = '';

    if (due.length === 0) {
        list.innerHTML = '<p class="empty-state">Nothing is due. An instruction starts its clock the first time you mark it Done.</p>';
        return;
    }

    due.forEach(entry => {
        const row = createInstructionRow(entry.instruction);

        const note = document.createElement('div');
        note.className = 'list-item-due';
        note.textContent = entry.instruction.frequency + ' · ' + overdueBy(entry.dueAt);
        row.querySelector('.list-item-info').appendChild(note);

        list.appendChild(row);
    });
}

// ---------------------------------------------------------------------------
// Run a Set — working through several instructions as one checklist.
// ---------------------------------------------------------------------------

// One run at a time, kept on this phone. A departure checklist gets interrupted
// constantly, so a run has to survive the app being closed — but like the step
// ticks, it is where you are right now rather than data worth backing up.
const RUN_KEY = 'ams_current_run';

function currentRun() {
    try {
        return JSON.parse(localStorage.getItem(RUN_KEY) || 'null');
    } catch (error) {
        return null;
    }
}

function saveRun(run) {
    if (run) {
        localStorage.setItem(RUN_KEY, JSON.stringify(run));
    } else {
        localStorage.removeItem(RUN_KEY);
    }
}

// The sets you can run, each resolved to the instructions in it.
//
// Membership is worked out fresh here, but a started run keeps its own snapshot
// of the numbers — otherwise "Due now" would shrink under you as you ticked
// things off, and you would never see the run finish.
async function availableSets() {
    const instructions = await getAllInstructions();
    const sets = [];

    const beforeTrip = instructions.filter(i => i.frequency === 'Before each trip').sort(byNumber);
    if (beforeTrip.length) {
        sets.push({ id: 'trip', name: 'Before each trip', instructions: beforeTrip });
    }

    const due = (await getDueInstructions()).map(entry => entry.instruction);
    if (due.length) {
        sets.push({ id: 'due', name: 'Everything due now', instructions: due });
    }

    const favouriteIds = await getFavorites();
    const favourites = instructions.filter(i => favouriteIds.includes(i.id)).sort(byNumber);
    if (favourites.length) {
        sets.push({ id: 'favourites', name: 'Favourites', instructions: favourites });
    }

    const byCategory = new Map();
    instructions.forEach(instruction => {
        const category = instruction.category || 'General';
        if (!byCategory.has(category)) byCategory.set(category, []);
        byCategory.get(category).push(instruction);
    });

    const ordered = [
        ...CATEGORY_ORDER.filter(c => byCategory.has(c)),
        ...[...byCategory.keys()].filter(c => !CATEGORY_ORDER.includes(c)).sort()
    ];

    ordered.forEach(category => {
        sets.push({
            id: 'category:' + category,
            name: category,
            instructions: byCategory.get(category).sort(byNumber)
        });
    });

    return sets;
}

async function renderRunPicker() {
    const list = document.getElementById('runPickerList');
    const resume = document.getElementById('resumeRunCard');
    const sets = await availableSets();
    const run = currentRun();

    // An unfinished run is offered back before anything else. Starting a second
    // one would silently throw the first away.
    if (run) {
        resume.hidden = false;
        document.getElementById('resumeRunName').textContent = run.name;
        document.getElementById('resumeRunDetail').textContent =
            run.ticked.length + ' of ' + run.numbers.length + ' done';
    } else {
        resume.hidden = true;
    }

    list.innerHTML = '';
    sets.forEach(set => {
        const row = document.createElement('button');
        row.className = 'set-row';

        const name = document.createElement('span');
        name.className = 'set-row-name';
        name.textContent = set.name;

        const count = document.createElement('span');
        count.className = 'set-row-count';
        count.textContent = set.instructions.length;

        row.appendChild(name);
        row.appendChild(count);
        row.addEventListener('click', () => startRun(set));
        list.appendChild(row);
    });
}

function startRun(set) {
    saveRun({
        id: set.id,
        name: set.name,
        numbers: set.instructions.map(i => i.number),
        ticked: []
    });
    openRun();
}

async function openRun() {
    await renderRun();
    showScreen('runScreen');
}

async function renderRun() {
    const run = currentRun();
    if (!run) {
        showScreen('runPickerScreen');
        return;
    }

    document.getElementById('runTitle').textContent = run.name;
    document.getElementById('runProgress').textContent =
        run.ticked.length + ' of ' + run.numbers.length + ' done';

    const list = document.getElementById('runList');
    list.innerHTML = '';

    for (const number of run.numbers) {
        const instruction = await getInstruction(number);
        // An instruction deleted mid-run is skipped rather than left as a row
        // that cannot be opened.
        if (!instruction) continue;

        const done = run.ticked.includes(number);
        const item = document.createElement('div');
        item.className = 'list-item run-item' + (done ? ' done' : '');

        const tick = document.createElement('button');
        tick.className = 'action-tick' + (done ? ' ticked' : '');
        tick.textContent = done ? '☑' : '☐';
        tick.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
        tick.addEventListener('click', (event) => {
            event.stopPropagation();
            const latest = currentRun();
            latest.ticked = done
                ? latest.ticked.filter(n => n !== number)
                : [...latest.ticked, number];
            saveRun(latest);
            renderRun();
        });

        const info = document.createElement('div');
        info.className = 'list-item-info';
        info.addEventListener('click', () => {
            // Opening an instruction from a run has to come back to the run —
            // dropping you on the Home screen mid-checklist would lose your place.
            window.instructionReturn = 'run';
            navigateToInstruction(number);
        });

        const numberEl = document.createElement('div');
        numberEl.className = 'list-item-number';
        numberEl.textContent = instruction.number;

        const titleEl = document.createElement('div');
        titleEl.className = 'list-item-title';
        titleEl.textContent = instruction.title;

        info.appendChild(numberEl);
        info.appendChild(titleEl);
        item.appendChild(tick);
        item.appendChild(info);
        list.appendChild(item);
    }

    // Finishing records a completion for each instruction you actually ticked,
    // which is what feeds the Due card. Untouched ones are left alone.
    const finish = document.getElementById('finishRunBtn');
    finish.disabled = run.ticked.length === 0;
    finish.textContent = run.ticked.length === 0
        ? '✓ Finish run'
        : '✓ Finish — mark ' + run.ticked.length + ' as Done';
}

async function finishRun() {
    const run = currentRun();
    if (!run) return;

    for (const number of run.ticked) {
        const instruction = await getInstruction(number);
        if (instruction) await recordCompletion(instruction);
    }

    const count = run.ticked.length;
    saveRun(null);
    await renderHomeScreen();
    showScreen('homeScreen');

    // A toast rather than showModal: finishing is an acknowledgement, and
    // showModal is a Cancel/Confirm dialog — offering "Cancel" on something
    // that has already happened would be nonsense.
    showToast(count === 1
        ? '✓ Run finished — 1 marked as Done'
        : '✓ Run finished — ' + count + ' marked as Done');
}

// Brief confirmation that slides up from the bottom and goes away on its own.
//
// An optional { label, onClick } puts a button in it — used for Undo after a
// bulk change. A toast carrying an action stays up more than twice as long,
// because it now has to be read and acted on rather than merely noticed.
function showToast(message, action) {
    // Two in quick succession would otherwise sit on top of each other at the
    // same fixed position, showing the older message over the newer one.
    document.querySelectorAll('.toast').forEach(old => old.remove());

    const toast = document.createElement('div');
    toast.className = 'toast' + (action ? ' with-action' : '');

    const text = document.createElement('span');
    text.textContent = message;
    toast.appendChild(text);

    if (action) {
        const btn = document.createElement('button');
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.addEventListener('click', () => {
            toast.remove();
            action.onClick();
        });
        toast.appendChild(btn);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('leaving');
        setTimeout(() => toast.remove(), 300);
    }, action ? 6000 : 2400);
}

// ---------------------------------------------------------------------------
// Library Health — what the library itself needs, rather than what the RV does.
// ---------------------------------------------------------------------------

async function healthGroups() {
    const instructions = await getAllInstructions();
    const due = await getDueInstructions();

    return [
        {
            key: 'overdue',
            title: 'Overdue',
            blurb: 'Past the date their frequency implies.',
            items: due.map(entry => entry.instruction)
        },
        {
            key: 'never',
            title: 'Never done',
            blurb: 'They have a frequency but have never been marked Done, so their clock has never started.',
            items: instructions.filter(i =>
                FREQUENCY_DAYS[i.frequency] && !i.lastCompleted && i.status !== 'Archived')
        },
        {
            key: 'noowner',
            title: 'No owner',
            blurb: 'Nobody is named as responsible.',
            items: instructions.filter(i => !i.owner || !String(i.owner).trim())
        },
        {
            key: 'unfinished',
            title: 'Draft or Review Needed',
            blurb: 'Missing something the app counts as making an instruction complete.',
            items: instructions.filter(i => i.status === 'Draft' || i.status === 'Review Needed')
        },
        {
            key: 'nowarning',
            title: 'Safety work with no warning',
            blurb: 'Safety and Maintenance instructions that carry no warning text. Not every one needs a warning — but it is worth a second look.',
            items: instructions.filter(i =>
                ['Safety', 'Maintenance'].includes(i.category) &&
                (!i.warnings || !i.warnings.trim()))
        }
    ];
}

// Deliberately honest about being a placeholder. Five instructions all carrying
// the same confident-sounding warning would be worse than none: identical
// boilerplate is exactly what teaches you to skim past warnings, which is the
// opposite of what the section is for. This one says what it is and asks to be
// replaced, while still giving a sane baseline in the meantime.
const PLACEHOLDER_WARNING = 'No specific hazard has been recorded for this job yet. Until one is, treat it with the usual care: the vehicle stable and level, anything powered switched off and isolated, and the whole procedure read through before you start. Replace this with the real hazard once you know what it is.';

// A bulk fix attached to a health group. Only two groups have one — an owner and
// a warning placeholder are gaps a single decision can close for the whole
// library. Everything else in Library Health needs judgement per instruction.
async function buildOwnerFixer(items, onDone) {
    const wrap = document.createElement('div');
    wrap.className = 'health-fix';

    const people = await getAllPeople();
    if (people.length === 0) {
        const note = document.createElement('p');
        note.className = 'empty-state';
        note.textContent = 'Add someone under Settings → Manage People first.';
        wrap.appendChild(note);
        return wrap;
    }

    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Who owns these');
    people.forEach(person => {
        const option = document.createElement('option');
        option.value = person.id;
        option.textContent = person.name;
        select.appendChild(option);
    });

    const button = document.createElement('button');
    button.className = 'btn-secondary';
    button.textContent = 'Set as owner on all ' + items.length;

    button.addEventListener('click', () => {
        const personId = select.value;
        const personName = select.options[select.selectedIndex].textContent;

        showModal('Set owner on ' + items.length + '?',
            personName + ' becomes the owner of every instruction that currently has none. Instructions that already have an owner are left alone.',
            async (confirmed) => {
                if (!confirmed) return;
                const updated = items.map(instruction => ({
                    ...instruction, owner: personName, ownerId: personId
                }));
                const count = await bulkUpdateInstructions(updated);
                showToast('✓ ' + personName + ' set as owner on ' + count);
                await onDone();
            });
    });

    wrap.appendChild(select);
    wrap.appendChild(button);
    return wrap;
}

function buildWarningFixer(items, onDone) {
    const wrap = document.createElement('div');
    wrap.className = 'health-fix';

    const button = document.createElement('button');
    button.className = 'btn-secondary';
    button.textContent = 'Add a placeholder warning to all ' + items.length;

    button.addEventListener('click', () => {
        showModal('Add a placeholder warning to ' + items.length + '?',
            'Each one gets the same holding text, which says plainly that the real hazard has not been recorded yet and asks you to replace it. Instructions that already have a warning are untouched.',
            async (confirmed) => {
                if (!confirmed) return;
                const updated = items.map(instruction => ({
                    ...instruction, warnings: PLACEHOLDER_WARNING
                }));
                const count = await bulkUpdateInstructions(updated);
                showToast('✓ Placeholder warning added to ' + count);
                await onDone();
            });
    });

    const note = document.createElement('p');
    note.className = 'health-fix-note';
    note.textContent = 'A placeholder is a prompt, not a real warning — worth replacing each one with the actual hazard when you next open it.';

    wrap.appendChild(button);
    wrap.appendChild(note);
    return wrap;
}

async function renderHealth() {
    const container = document.getElementById('healthList');
    const groups = await healthGroups();
    await loadOwnerNames();
    container.innerHTML = '';

    const clean = groups.every(group => group.items.length === 0);
    if (clean) {
        container.innerHTML = '<p class="empty-state">Nothing to tidy up. Every instruction has an owner, a status and a warning where it needs one.</p>';
        return;
    }

    for (const group of groups) {
        const section = document.createElement('section');
        section.className = 'instruction-section';

        const toggle = document.createElement('div');
        toggle.className = 'section-toggle collapsed';

        const heading = document.createElement('h3');
        heading.textContent = group.title;

        const count = document.createElement('span');
        count.className = 'group-count' + (group.items.length === 0 ? ' is-zero' : '');
        count.textContent = group.items.length;

        const icon = document.createElement('span');
        icon.className = 'toggle-icon';
        icon.textContent = '▼';

        toggle.appendChild(heading);
        toggle.appendChild(count);
        toggle.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'section-content';

        const blurb = document.createElement('p');
        blurb.className = 'health-blurb';
        blurb.textContent = group.blurb;
        content.appendChild(blurb);

        if (group.items.length === 0) {
            const none = document.createElement('p');
            none.className = 'empty-state';
            none.textContent = 'None — nothing to do here.';
            content.appendChild(none);
        } else {
            // Re-render after a fix so the counts and lists reflect what just
            // happened, rather than showing work that has already been done.
            const refresh = () => renderHealth();

            if (group.key === 'noowner') {
                content.appendChild(await buildOwnerFixer(group.items, refresh));
            } else if (group.key === 'nowarning') {
                content.appendChild(buildWarningFixer(group.items, refresh));
            }

            group.items
                .slice()
                .sort((a, b) => a.number.localeCompare(b.number))
                .forEach(instruction => content.appendChild(createInstructionRow(instruction)));
        }

        // No click handler here on purpose: the app already delegates clicks on
        // .section-toggle globally. Adding one as well toggled the section twice
        // per tap, so it appeared not to open at all.
        section.appendChild(toggle);
        section.appendChild(content);
        container.appendChild(section);
    }
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
    const title = document.getElementById('backupNudgeTitle');
    title.textContent = 'Back up your instructions';
    nudge.classList.remove('urgent');

    // Nothing worth backing up yet
    const instructions = await getAllInstructions();
    if (instructions.length === 0) {
        nudge.style.display = 'none';
        return;
    }

    // A failed automatic backup means the safety copy on this phone is not being
    // kept any more. That used to be reported only on the Data Safety screen, which
    // you have to go looking for — so a dead safety net stayed quiet. It comes first,
    // ahead of "it has been a while", because it is the more serious of the two.
    if (hybridStorage.status().failedAt) {
        title.textContent = 'Safety copy on this phone has stopped';
        detail.textContent = 'Storage is full — back up to Files now';
        nudge.classList.add('urgent');
        nudge.style.display = 'flex';
        prepareBackup();
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

// The durable half of the bulk Undo. The toast is the one you catch in the
// moment; this is the one still waiting when you reopen the app tomorrow and
// realise you archived the wrong fifty-seven.
async function renderBulkUndoSlot() {
    const slot = document.getElementById('bulkUndoSlot');
    if (!slot) return;

    let record = null;
    try {
        record = await getSetting(BULK_UNDO_KEY);
    } catch (error) {
        console.warn('[Undo] Could not read the last bulk change:', error);
    }

    if (!record || !record.entries || record.entries.length === 0) {
        slot.hidden = true;
        return;
    }

    slot.hidden = false;
    document.getElementById('bulkUndoLabel').textContent =
        record.label + ' · ' + formatRelativeTime(record.timestamp);

    // Naming the field is what makes this safe to tap: it says what will change
    // back and, by omission, what will not.
    const fieldNames = { owner: 'owner', ownerId: 'owner', tags: 'tags', status: 'status' };
    const changed = [...new Set((record.fields || []).map(f => fieldNames[f] || f))].join(' and ');
    document.getElementById('bulkUndoNote').textContent =
        'Puts the ' + changed + ' back exactly as it was on those ' + record.entries.length +
        ', and touches nothing else — any other edits you have made since are kept. ' +
        'Only the most recent bulk change can be undone.';
}

async function renderDataSafety() {
    const status = hybridStorage.status();

    await renderBulkUndoSlot();

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

        photoInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (currentPhotos.length >= 5) {
                alert('Maximum 5 photos per instruction');
                photoInput.value = '';
                return;
            }

            try {
                currentPhotos.push(await preparePhoto(file));
                renderPhotosList();
            } catch (error) {
                console.error('[Photos] Could not process photo:', error);
                alert('Could not add that photo: ' + error.message);
            }
            photoInput.value = '';
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

            // Category groups on the All Instructions screen remember whether they
            // were left open, so the list looks the same next time you come back.
            if (toggle.dataset.group) {
                const open = openGroups();
                if (content.classList.contains('expanded')) {
                    open.add(toggle.dataset.group);
                } else {
                    open.delete(toggle.dataset.group);
                }
                saveOpenGroups(open);
                updateToggleAllLabel();
            }
        }
    }
});

function updateToggleAllLabel() {
    const btn = document.getElementById('toggleAllGroupsBtn');
    if (!btn) return;
    const total = document.querySelectorAll('#instructionsList .group-toggle').length;
    btn.textContent = openGroups().size >= total && total > 0 ? 'Collapse all' : 'Expand all';
}

async function initializeApp() {
    document.getElementById('versionNumber').textContent = APP_VERSION;
    document.getElementById('homeVersion').textContent = 'v' + APP_VERSION;

    // Bottom tab bar — the app's main navigation. Each tab re-renders its screen
    // on the way in, so a tab never shows a stale list.
    document.querySelectorAll('#tabbar .tab').forEach(tab => {
        tab.addEventListener('click', () => openTab(tab.dataset.tab));
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
        // Opened from inside a run: go back to the run, not to Home. Anywhere
        // else, Home stays the destination it has always been.
        if (window.instructionReturn === 'run' && currentRun()) {
            window.instructionReturn = null;
            await openRun();
            return;
        }

        window.instructionReturn = null;
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('doneBtn').addEventListener('click', async () => {
        if (currentInstruction) {
            currentInstruction = await recordCompletion(currentInstruction);

            document.getElementById('instructionCompletionCount').textContent =
                currentInstruction.completionCount === 1 ? '1 time' : currentInstruction.completionCount + ' times';
            document.getElementById('instructionLastCompleted').textContent = 'Just now';

            // The job is finished, so the ticks have done their work — clearing
            // them now means the next run starts from a clean list rather than
            // one that looks already complete.
            clearStepProgress(currentInstruction);
            renderSteps(currentInstruction);
            updateNextDueLine(currentInstruction);
        }

        document.getElementById('doneBtn').textContent = '✓ Done!';
        setTimeout(() => {
            document.getElementById('doneBtn').textContent = '✓ Mark Done';
        }, 1500);
    });

    document.getElementById('shareBtn').addEventListener('click', () => {
        if (currentInstruction) {
            shareInstruction(currentInstruction);
        }
    });

    document.getElementById('editInstructionBtn').addEventListener('click', () => {
        if (currentInstruction) {
            editInstruction(currentInstruction);
        }
    });

    document.getElementById('favoriteBtn').addEventListener('click', toggleFavorite);

    document.getElementById('addAuditBtn').addEventListener('click', handleAddAudit);

    // Instructions tab
    document.getElementById('newInstructionBtn').addEventListener('click', async () => {
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

    // Run a Set
    document.getElementById('runSetBtn').addEventListener('click', async () => {
        await renderRunPicker();
        showScreen('runPickerScreen');
    });

    document.getElementById('runNudge').addEventListener('click', openRun);
    document.getElementById('resumeRunCard').addEventListener('click', openRun);

    document.getElementById('backFromRunPickerBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    document.getElementById('backFromRunBtn').addEventListener('click', async () => {
        // Leaving a run does not end it — the run card on Home brings you back.
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    document.getElementById('abandonRunBtn').addEventListener('click', () => {
        showModal('Abandon this run?', 'The ticks for this run are discarded. Anything already marked Done stays done.', async (confirmed) => {
            if (!confirmed) return;
            saveRun(null);
            await renderHomeScreen();
            showScreen('homeScreen');
        });
    });

    document.getElementById('finishRunBtn').addEventListener('click', finishRun);

    // Library Health
    document.getElementById('healthBtn').addEventListener('click', async () => {
        await renderHealth();
        showScreen('healthScreen');
    });

    document.getElementById('backFromHealthBtn').addEventListener('click', () => {
        showScreen('settingsScreen');
    });

    // Due now
    document.getElementById('dueNudge').addEventListener('click', async () => {
        await renderDueList();
        showScreen('dueScreen');
    });

    document.getElementById('backFromDueBtn').addEventListener('click', async () => {
        await renderHomeScreen();
        showScreen('homeScreen');
    });

    // Rewriting the steps changes what the photo pickers can offer, so rebuild
    // them when the box is done being typed in.
    document.getElementById('editorSteps').addEventListener('change', renderPhotosList);

    document.getElementById('stepResetBtn').addEventListener('click', () => {
        if (!currentInstruction) return;
        clearStepProgress(currentInstruction);
        renderSteps(currentInstruction);
    });

    // Actions
    document.getElementById('actionsNudge').addEventListener('click', () => openTab('actions'));

    document.getElementById('newActionBtn').addEventListener('click', async () => {
        await resetActionEditor();
        window.actionEditorReturn = 'actions';
        showScreen('actionEditorScreen');
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

    document.getElementById('toggleAllGroupsBtn').addEventListener('click', toggleAllGroups);

    document.getElementById('searchInput').addEventListener('input', (e) => {
        renderInstructionsList(e.target.value);
    });

    document.getElementById('sortBtn').addEventListener('click', () => toggleSortPanel());
    document.getElementById('filterBtn').addEventListener('click', () => toggleFilterPanel());
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFiltersAndRender);
    document.getElementById('filterPanelClearBtn').addEventListener('click', clearFiltersAndRender);
    document.getElementById('filterPanelDoneBtn').addEventListener('click', () => toggleFilterPanel(false));

    document.getElementById('bulkOpenBtn').addEventListener('click', () => toggleBulkPanel());
    document.getElementById('bulkCloseBtn').addEventListener('click', () => toggleBulkPanel(false));
    document.getElementById('bulkOwnerBtn').addEventListener('click', handleBulkOwner);
    document.getElementById('bulkTagBtn').addEventListener('click', handleBulkTag);
    document.getElementById('bulkStatusBtn').addEventListener('click', handleBulkStatus);

    document.getElementById('backFromEditorBtn').addEventListener('click', async () => {
        await refreshInstructionsList();
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

    document.getElementById('bulkUndoBtn').addEventListener('click', async () => {
        const record = await getSetting(BULK_UNDO_KEY);
        if (!record) return;

        showModal('Undo "' + record.label + '"?',
            'This puts that change back as it was on ' + record.entries.length +
            ' instructions. Anything else you have edited since is left alone. ' +
            'It can only be done once.',
            async (confirmed) => {
                if (confirmed) await undoBulkChange();
            });
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
                // The whole library has just been replaced, so a search term or
                // filter from the old one describes nothing. Start clean.
                document.getElementById('searchInput').value = '';
                clearFilters();
                toggleFilterPanel(false);
                toggleBulkPanel(false);
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
        document.getElementById('howItWorksScreen').scrollTop = 0;
    });

    // "In this guide" jumps. Scrolled by hand rather than by the browser's own
    // anchor handling, which would stamp a #hash onto the URL — harmless in
    // Safari, but the Home Screen app then reopens on whatever it landed on.
    document.getElementById('howItWorksBody').addEventListener('click', (e) => {
        const link = e.target.closest('.guide-contents a');
        if (!link) return;
        e.preventDefault();
        // Jumped, not glided: the guide is fifteen thousand pixels tall, and a
        // smooth scroll across it is several seconds of blur.
        const target = document.querySelector(link.getAttribute('href'));
        if (target) target.scrollIntoView({ block: 'start' });
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
