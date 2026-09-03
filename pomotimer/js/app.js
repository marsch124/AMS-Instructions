/* AMS PomoTimer — UI and app wiring */

const APP_VERSION = '1.1.0';

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ================= Helpers ================= */
function pad(n) { return String(n).padStart(2, '0'); }

function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${pad(m)}m`;
    if (sec < 60) return `${s}s`;
    if (s) return `${m}m ${s}s`;
    return `${m} min`;
}

function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fmtDay(ts) {
    const today = Store.dayKey(Date.now());
    const yesterday = Store.dayKey(Date.now() - 86400000);
    const key = Store.dayKey(ts);
    if (key === today) return 'Today';
    if (key === yesterday) return 'Yesterday';
    return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function phaseInfo(type) { return Store.PHASE_TYPES[type] || Store.PHASE_TYPES.focus; }

/* Inline hand-drawn icon from the sprite in index.html. */
function icon(name, cls) {
    return `<svg class="ic ${cls || ''}" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;
}

function setIcon(useEl, name) {
    useEl.setAttribute('href', '#i-' + name);
}

function segmentsHtml(steps) {
    const total = steps.reduce((a, s) => a + s.seconds, 0) || 1;
    return '<span class="segments">' + steps.map(s =>
        `<span style="width:${(s.seconds / total * 100).toFixed(2)}%;background:${phaseInfo(s.type).color}"></span>`
    ).join('') + '</span>';
}

/* Returns HTML (already escaped). */
function templateMeta(tpl) {
    const total = Store.templateTotalSec(tpl);
    const pomos = tpl.steps.filter(s => s.type === 'focus').length;
    return `${esc(fmtDuration(total))} · ${tpl.steps.length} phases · ${pomos} ${icon('tomato', 'ic-xs')}`;
}

let toastTimer = null;
function toast(msg, ms) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 2200);
}

function confirmDialog(text, okLabel) {
    return new Promise(resolve => {
        const modal = $('#modal');
        $('#modal-text').textContent = text;
        $('#modal-ok').textContent = okLabel || 'OK';
        modal.hidden = false;
        const done = (v) => { modal.hidden = true; ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); resolve(v); };
        const ok = $('#modal-ok'), cancel = $('#modal-cancel');
        const onOk = () => done(true), onCancel = () => done(false);
        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
    });
}

/* ================= Sound / vibration / notifications ================= */
const Sound = (() => {
    let ctx = null;
    function unlock() {
        try {
            if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') ctx.resume();
        } catch (e) { /* no audio available */ }
    }
    function tone(freq, at, dur, vol, type) {
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || 'sine';
        osc.frequency.value = freq;
        const t = ctx.currentTime + at;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    }
    function chime(kind) {
        if (!Store.getSettings().sound) return;
        unlock();
        if (!ctx) return;
        switch (kind) {
            case 'focus':
                tone(523.25, 0, 0.35, 0.3); tone(659.25, 0.15, 0.35, 0.3); tone(783.99, 0.3, 0.5, 0.3);
                break;
            case 'break':
                tone(659.25, 0, 0.4, 0.22); tone(523.25, 0.2, 0.55, 0.22);
                break;
            case 'done':
                tone(523.25, 0, 0.4, 0.3); tone(659.25, 0.18, 0.4, 0.3); tone(783.99, 0.36, 0.4, 0.3); tone(1046.5, 0.54, 0.8, 0.3);
                break;
            case 'tick':
                tone(880, 0, 0.07, 0.15, 'square');
                break;
            default:
                tone(660, 0, 0.3, 0.25); tone(880, 0.15, 0.4, 0.25);
        }
    }
    return { unlock, chime };
})();

function vibrate(pattern) {
    if (!Store.getSettings().vibrate) return;
    // Browsers ignore vibration before the first tap (e.g. a session restored on reload).
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ }
}

async function notify(title, body) {
    const s = Store.getSettings();
    if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (!document.hidden) return; // the screen itself is the alert while visible
    try {
        const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
            reg.showNotification(title, { body, tag: 'pomo-phase', renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
        } else {
            new Notification(title, { body, tag: 'pomo-phase', icon: 'icons/icon-192.png' });
        }
    } catch (e) { console.warn('notify failed', e); }
}

/* ================= Wake lock ================= */
const Wake = (() => {
    let sentinel = null;
    async function acquire() {
        if (!('wakeLock' in navigator) || sentinel) return;
        try {
            sentinel = await navigator.wakeLock.request('screen');
            sentinel.addEventListener('release', () => { sentinel = null; });
        } catch (e) { sentinel = null; }
    }
    function release() {
        if (sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
    }
    function sync() {
        const snap = Timer.snapshot();
        const want = Store.getSettings().wakeLock && snap && snap.status === 'running' && currentScreen === 'timer' && !document.hidden;
        if (want) acquire(); else release();
    }
    return { sync, release };
})();

/* ================= Theme ================= */
function applyTheme() {
    const t = Store.getSettings().theme;
    if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name="theme-color"]').setAttribute('content', dark ? '#120f2e' : '#fff6ea');
}

/* ================= Screens ================= */
let currentScreen = 'home';
const NO_TABBAR = new Set(['timer', 'done', 'editor']);
const TAB_OF = { home: 'home', timer: 'home', done: 'home', templates: 'templates', editor: 'templates', history: 'history', settings: 'settings' };

function showScreen(name) {
    currentScreen = name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.classList.toggle('no-tabbar', NO_TABBAR.has(name));
    document.body.dataset.tab = TAB_OF[name];
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === TAB_OF[name]));
    const screen = $('#screen-' + name);
    if (screen) { const c = $('.content', screen); if (c) c.scrollTop = 0; }
    if (name === 'home') renderHome();
    if (name === 'templates') renderTemplates();
    if (name === 'history') renderHistory();
    if (name === 'settings') renderSettings();
    if (name === 'timer') renderTimer(true);
    Wake.sync();
}

/* ================= Home ================= */
function statsHtml(list) {
    return list.map(s => `<div class="stat"><div class="stat-value">${esc(s.value)}</div><div class="stat-label">${esc(s.label)}</div></div>`).join('');
}

function renderHome() {
    const snap = Timer.snapshot();
    const resume = $('#home-resume');
    if (snap) {
        resume.hidden = false;
        const st = snap.status === 'paused' ? 'paused' : snap.status === 'waiting' ? 'waiting for you' : 'running';
        $('#resume-sub').innerHTML = `${icon(Store.iconFor(snap.run), 'ic-xs')} ${esc(snap.run.name)} · ${esc(snap.step.label)} · ${fmtClock(snap.remainingMs)} (${st})`;
    } else {
        resume.hidden = true;
    }

    const templates = Store.getTemplates();
    const lastId = Store.getLastTemplateId();
    const ordered = templates.slice().sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : 0));
    $('#quick-grid').innerHTML = ordered.map(t => `
        <button class="quick-card" data-id="${esc(t.id)}" style="--tpl-color:${esc(t.color || '#FF2E63')}">
            <span class="quick-icon">${icon(Store.iconFor(t))}</span>
            <span class="quick-name">${esc(t.name || 'Untitled')}${t.id === lastId ? ' <span class="muted">· last</span>' : ''}</span>
            <span class="quick-meta">${templateMeta(t)}</span>
            ${segmentsHtml(t.steps)}
        </button>`).join('') +
        `<button class="quick-card add-card" data-action="new">${icon('plus')} New template</button>`;

    const s = Store.stats();
    $('#home-stats').innerHTML = statsHtml([
        { value: s.today.pomodoros, label: 'Pomodoros' },
        { value: fmtDuration(s.today.focusSec), label: 'Focus' },
        { value: s.today.sessions, label: 'Sessions' }
    ]);
    $('#home-version').textContent = 'AMS PomoTimer v' + APP_VERSION;
}

function startTemplate(tpl) {
    if (!tpl) return;
    if (Timer.isActive()) {
        // Starting a new one replaces the current session; ask first.
        confirmDialog('A session is already running. Stop it and start a new one?', 'Start new').then(ok => {
            if (!ok) return;
            suppressDoneScreen = true;
            Timer.stop();
            suppressDoneScreen = false;
            beginRun(tpl);
        });
        return;
    }
    beginRun(tpl);
}

let lastStartedTemplate = null;
let suppressDoneScreen = false;

function beginRun(tpl) {
    Sound.unlock();
    const run = Timer.start(tpl);
    if (!run) { toast('This template has no phases with a duration.'); return; }
    lastStartedTemplate = tpl;
    showScreen('timer');
}

/* ================= Timer screen ================= */
const RING_C = 2 * Math.PI * 90;
let uiInterval = null;
let lastRenderedIndex = -1;
let lastRenderedStatus = null;

function renderTimer(full) {
    const snap = Timer.snapshot();
    if (!snap) return;
    const { run, step, status } = snap;
    const info = phaseInfo(step.type);
    const screen = $('#screen-timer');

    if (full || snap.index !== lastRenderedIndex || status !== lastRenderedStatus) {
        screen.style.setProperty('--phase', info.color);
        $('#timer-template-name').innerHTML = `${icon(Store.iconFor(run), 'ic-sm')} ${esc(run.name)}`;
        setIcon($('#phase-badge-icon use'), info.icon);
        $('#phase-type-label').textContent = info.label;
        $('#phase-name').textContent = step.label;
        $('#phase-count').textContent = `Phase ${snap.index + 1} of ${snap.count}`;
        $('#waiting-banner').hidden = status !== 'waiting';
        const paused = status === 'paused';
        setIcon($('#pause-icon'), status === 'running' ? 'pause' : 'play');
        $('#pause-label').textContent = status === 'running' ? 'Pause' : (status === 'waiting' ? 'Start' : 'Resume');
        $('#time-big').classList.toggle('paused', paused);
        $('#btn-prev').disabled = false;
        $('#btn-next').disabled = false;
        $('#next-up').innerHTML = snap.nextStep
            ? `Next: <b>${esc(snap.nextStep.label)}</b> · ${fmtDuration(snap.nextStep.seconds)}`
            : 'Last phase — then you are done.';
        $('#phase-list').innerHTML = run.steps.map((s, i) => {
            const cls = i < snap.index ? 'done' : i === snap.index ? 'current' : '';
            return `<li class="phase-item ${cls}" data-index="${i}" style="--item-color:${phaseInfo(s.type).color}">
                <span class="phase-item-idx">${i < snap.index ? icon('check', 'ic-xs') : i + 1}</span>
                <span class="phase-item-ic">${icon(phaseInfo(s.type).icon, 'ic-sm')}</span>
                <span class="phase-item-name">${esc(s.label)}</span>
                <span class="phase-item-dur">${fmtDuration(s.seconds)}</span>
            </li>`;
        }).join('');
        lastRenderedIndex = snap.index;
        lastRenderedStatus = status;
        Wake.sync();
    }

    $('#time-big').textContent = fmtClock(snap.remainingMs);
    $('#ring-fg').style.strokeDashoffset = (RING_C * (1 - snap.phaseFraction)).toFixed(2);
    const doneMs = snap.sessionTotalMs - snap.sessionRemainingMs;
    $('#session-fill').style.width = (snap.sessionTotalMs ? doneMs / snap.sessionTotalMs * 100 : 0).toFixed(2) + '%';
    $('#session-text').innerHTML = `<span>Session ${fmtClock(doneMs)}</span><span>${fmtClock(snap.sessionRemainingMs)} left · ends ${fmtTime(Date.now() + snap.sessionRemainingMs)}</span>`;
    document.title = status === 'running' ? `${fmtClock(snap.remainingMs)} · ${step.label} — AMS PomoTimer` : 'AMS PomoTimer';
}

function startUiLoop() {
    if (uiInterval) return;
    uiInterval = setInterval(() => {
        if (currentScreen === 'timer' && Timer.isActive()) renderTimer(false);
    }, 250);
}

/* Timer engine events */
Timer.on('phase', ({ run, step, reason, finished }) => {
    lastRenderedIndex = -1;
    const isBreak = step.type === 'pause' || step.type === 'longbreak' || step.type === 'cooldown';
    if (reason === 'complete') {
        Sound.chime(isBreak ? 'break' : 'focus');
        vibrate(isBreak ? [150, 80, 150] : [250, 100, 250, 100, 250]);
        const status = run.status === 'waiting' ? 'Tap to start' : fmtDuration(step.seconds);
        notify(`${finished ? finished.label + ' finished' : 'Phase finished'}`, `Next: ${step.label} · ${status}`);
    } else if (reason === 'start') {
        Sound.chime(isBreak ? 'break' : 'focus');
        vibrate([120]);
    }
    if (currentScreen === 'timer') renderTimer(true);
    else if (currentScreen === 'home') renderHome();
});

Timer.on('tick', ({ secondsLeft }) => {
    if (Store.getSettings().ticks) Sound.chime('tick');
});

Timer.on('done', ({ run, entry }) => {
    lastRenderedIndex = -1;
    Wake.release();
    document.title = 'AMS PomoTimer';
    if (suppressDoneScreen) return;
    if (run.completed) {
        Sound.chime('done');
        vibrate([300, 100, 300, 100, 500]);
        notify('Session complete', `${run.name}: ${run.pomodoros} Pomodoros, ${fmtDuration(run.focusSec)} focus`);
    }
    showDone(run);
});

Timer.on('change', () => {
    if (currentScreen === 'timer') renderTimer(false);
});

function showDone(run) {
    setIcon($('#done-icon use'), run.completed ? 'party' : 'stop');
    $('.done-icon').classList.toggle('stopped', !run.completed);
    $('.done-title').textContent = run.completed ? 'Session complete' : 'Session stopped';
    const mins = Math.round((run.endedAt - run.startedAt) / 60000);
    $('#done-sub').innerHTML = `${icon(Store.iconFor(run), 'ic-sm')} ${esc(run.name)} · ${fmtTime(run.startedAt)}–${fmtTime(run.endedAt)} (${mins} min)`;
    $('#done-stats').innerHTML = statsHtml([
        { value: run.pomodoros, label: 'Pomodoros' },
        { value: fmtDuration(run.focusSec), label: 'Focus' },
        { value: `${run.phasesDone}/${run.steps.length}`, label: 'Phases' }
    ]);
    showScreen('done');
}

/* ================= Templates list ================= */
function renderTemplates() {
    const templates = Store.getTemplates();
    const el = $('#template-list');
    if (!templates.length) {
        el.innerHTML = '<div class="empty">No templates yet. Tap the plus button to create one, or restore the built-ins in Settings.</div>';
        return;
    }
    el.innerHTML = templates.map(t => `
        <div class="template-row" style="--tpl-color:${esc(t.color || '#FF2E63')}">
            <button class="tpl-edit-area" data-edit="${esc(t.id)}">
                <span class="tpl-icon">${icon(Store.iconFor(t))}</span>
                <span class="tpl-body">
                    <span class="tpl-name">${esc(t.name || 'Untitled')}</span>
                    <span class="tpl-meta">${templateMeta(t)}</span>
                    ${segmentsHtml(t.steps)}
                </span>
            </button>
            <button class="tpl-play" data-start="${esc(t.id)}" aria-label="Start ${esc(t.name)}">${icon('play')}</button>
        </div>`).join('');
}

/* ================= Editor ================= */
let ed = null; // working copy of the template being edited
let edIsNew = false;

function openEditor(tpl, isNew) {
    ed = JSON.parse(JSON.stringify(tpl));
    edIsNew = !!isNew;
    $('#editor-title').textContent = isNew ? 'New template' : 'Edit template';
    $('#ed-name').value = ed.name || '';
    $('#ed-auto').value = ed.autoAdvance === true ? '1' : ed.autoAdvance === false ? '0' : '';
    $('#btn-editor-delete').hidden = isNew;
    $('#btn-editor-duplicate').hidden = isNew;
    ed.icon = Store.iconFor(ed);
    delete ed.emoji;
    renderIconRow();
    renderColorRow();
    renderAddRow();
    renderSteps();
    showScreen('editor');
}

function renderIconRow() {
    $('#ed-icon-row').innerHTML = Store.ICONS.map(n =>
        `<button class="chip icon-chip ${n === ed.icon ? 'selected' : ''}" data-icon="${n}" aria-label="${n}" style="--c:${esc(ed.color || '#FF2E63')}">${icon(n)}</button>`).join('');
}

function renderColorRow() {
    $('#ed-color-row').innerHTML = Store.COLORS.map(c =>
        `<button class="chip color-chip ${c === ed.color ? 'selected' : ''}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join('');
}

function renderAddRow() {
    $('#ed-add-row').innerHTML = Object.entries(Store.PHASE_TYPES).map(([type, info]) =>
        `<button class="chip phase-chip" data-add="${type}" style="--chip-color:${info.color}">${icon(info.icon, 'ic-sm')} ${info.label}</button>`).join('');
}

function renderSteps() {
    const el = $('#ed-steps');
    if (!ed.steps.length) {
        el.innerHTML = '<li class="step-empty">No phases yet. Add some below.</li>';
    } else {
        const typeOptions = Object.entries(Store.PHASE_TYPES).map(([t, i]) => `<option value="${t}">${i.label}</option>`).join('');
        el.innerHTML = ed.steps.map((s, i) => {
            const m = Math.floor(s.seconds / 60), sec = s.seconds % 60;
            return `<li class="step-row" data-index="${i}" style="--item-color:${phaseInfo(s.type).color}">
                <span class="step-idx">${i + 1}</span>
                <input class="step-label" type="text" maxlength="30" value="${esc(s.label)}" placeholder="${esc(phaseInfo(s.type).label)}" data-field="label">
                <select class="step-type" data-field="type">${typeOptions}</select>
                <span class="step-dur">
                    <input type="number" inputmode="numeric" min="0" max="600" value="${m}" data-field="min"><span>min</span>
                    <input type="number" inputmode="numeric" min="0" max="59" value="${sec}" data-field="sec"><span>sec</span>
                </span>
                <span class="step-actions">
                    <button data-op="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 'ic-sm')}</button>
                    <button data-op="down" ${i === ed.steps.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 'ic-sm')}</button>
                    <button data-op="dup" aria-label="Duplicate">${icon('copy', 'ic-sm')}</button>
                    <button data-op="del" class="del" aria-label="Remove">${icon('trash', 'ic-sm')}</button>
                </span>
            </li>`;
        }).join('');
        $$('.step-row', el).forEach(row => { $('.step-type', row).value = ed.steps[+row.dataset.index].type; });
    }
    updateEdTotal();
}

function updateEdTotal() {
    $('#ed-total').textContent = ed.steps.length ? `· ${fmtDuration(Store.templateTotalSec(ed))}` : '';
}

function saveEditor() {
    ed.name = $('#ed-name').value.trim() || 'Untitled';
    const auto = $('#ed-auto').value;
    ed.autoAdvance = auto === '1' ? true : auto === '0' ? false : null;
    ed.steps = ed.steps.map(s => ({ ...s, label: (s.label || '').trim() || phaseInfo(s.type).label, seconds: Math.max(0, Math.round(s.seconds)) }));
    if (!ed.steps.some(s => s.seconds > 0)) { toast('Add at least one phase with a duration.'); return; }
    ed.builtin = false;
    Store.saveTemplate(ed);
    toast(edIsNew ? 'Template created' : 'Template saved');
    ed = null;
    showScreen('templates');
}

/* ================= History ================= */
function renderHistory() {
    const s = Store.stats();
    $('#history-stats').innerHTML = statsHtml([
        { value: s.today.pomodoros, label: 'Today' },
        { value: s.week.pomodoros, label: 'This week' },
        { value: fmtDuration(s.all.focusSec), label: 'All-time focus' }
    ]);
    const list = Store.getHistory();
    const el = $('#history-list');
    if (!list.length) { el.innerHTML = '<div class="empty">No sessions yet. Finish a session and it shows up here.</div>'; return; }
    let html = '', lastDay = null;
    list.forEach(h => {
        const day = fmtDay(h.endedAt);
        if (day !== lastDay) { html += `<div class="history-day">${esc(day)}</div>`; lastDay = day; }
        html += `<div class="history-row ${h.completed ? '' : 'stopped'}" data-id="${esc(h.id)}" style="--tpl-color:${esc(h.color || '#FF2E63')}">
            <span class="h-icon">${icon(Store.iconFor(h))}</span>
            <span class="h-body">
                <div class="h-name">${esc(h.name)}${h.completed ? '' : ' <span class="muted">· stopped</span>'}</div>
                <div class="h-meta">${fmtTime(h.startedAt)}–${fmtTime(h.endedAt)} · ${h.pomodoros} ${icon('tomato', 'ic-xs')} · ${h.phasesDone}/${h.phasesTotal} phases</div>
            </span>
            <span class="h-focus">${fmtDuration(h.focusSec)}</span>
            <button class="h-del" data-del="${esc(h.id)}" aria-label="Delete">${icon('close', 'ic-sm')}</button>
        </div>`;
    });
    el.innerHTML = html;
}

/* ================= Settings ================= */
function renderSettings() {
    const s = Store.getSettings();
    $('#set-auto').checked = s.autoAdvance;
    $('#set-wake').checked = s.wakeLock;
    $('#set-ticks').checked = s.ticks;
    $('#set-sound').checked = s.sound;
    $('#set-vibrate').checked = s.vibrate;
    $('#set-notify').checked = s.notify && ('Notification' in window) && Notification.permission === 'granted';
    $('#set-theme').value = s.theme;
    $('#about-version').textContent = 'v' + APP_VERSION;
    $('#set-wake').disabled = !('wakeLock' in navigator);
    $('#set-vibrate').disabled = !('vibrate' in navigator);
    $('#set-notify').disabled = !('Notification' in window);
}

function exportData() {
    const data = Store.exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ams-pomotimer-' + Store.dayKey(Date.now()) + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/* ================= Wiring ================= */
function bind() {
    // Unlock audio on the first touch anywhere (iOS requirement)
    document.addEventListener('touchend', Sound.unlock, { passive: true });
    document.addEventListener('click', Sound.unlock);

    // Tabs
    $('#tabbar').addEventListener('click', e => {
        const tab = e.target.closest('.tab');
        if (!tab) return;
        if (tab.dataset.tab === 'home' && Timer.isActive() && currentScreen !== 'timer') showScreen('timer');
        else showScreen(tab.dataset.tab);
    });

    // Home
    $('#btn-home-settings').addEventListener('click', () => showScreen('settings'));
    $('#btn-resume').addEventListener('click', () => showScreen('timer'));
    $('#quick-grid').addEventListener('click', e => {
        const card = e.target.closest('.quick-card');
        if (!card) return;
        if (card.dataset.action === 'new') { openEditor(Store.newTemplate(), true); return; }
        startTemplate(Store.getTemplate(card.dataset.id));
    });
    $('#quick-chips').addEventListener('click', e => {
        const chip = e.target.closest('.chip');
        if (chip) startTemplate(Store.quickTemplate(+chip.dataset.min));
    });
    $('#btn-quick-custom').addEventListener('click', () => {
        const m = parseInt($('#quick-custom-min').value, 10);
        if (!m || m < 1) { toast('Enter a number of minutes.'); return; }
        $('#quick-custom-min').value = '';
        startTemplate(Store.quickTemplate(Math.min(600, m)));
    });
    $('#quick-custom-min').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-quick-custom').click(); });

    // Timer
    $('#btn-timer-back').addEventListener('click', () => showScreen('home'));
    $('#btn-timer-stop').addEventListener('click', async () => {
        if (await confirmDialog('Stop this session? Progress so far is kept in History.', 'Stop')) Timer.stop();
    });
    $('#btn-pause').addEventListener('click', () => {
        const snap = Timer.snapshot();
        if (!snap) return;
        if (snap.status === 'waiting') Timer.startWaiting(); else Timer.toggle();
        renderTimer(true);
    });
    $('#btn-start-next').addEventListener('click', () => { Timer.startWaiting(); renderTimer(true); });
    $('#btn-next').addEventListener('click', () => Timer.next());
    $('#btn-prev').addEventListener('click', () => Timer.prev());
    $('#btn-plus').addEventListener('click', () => { Timer.adjust(60); renderTimer(false); });
    $('#btn-minus').addEventListener('click', () => { Timer.adjust(-60); renderTimer(false); });
    $('#phase-list').addEventListener('click', e => {
        const li = e.target.closest('.phase-item');
        if (!li) return;
        const i = +li.dataset.index;
        const snap = Timer.snapshot();
        if (!snap || i === snap.index) return;
        Timer.jumpTo(i);
    });

    // Done
    $('#btn-done-home').addEventListener('click', () => showScreen('home'));
    $('#btn-done-again').addEventListener('click', () => {
        if (lastStartedTemplate) { startTemplate(lastStartedTemplate); return; }
        showScreen('home');
    });

    // Templates
    $('#btn-new-template').addEventListener('click', () => openEditor(Store.newTemplate(), true));
    $('#template-list').addEventListener('click', e => {
        const play = e.target.closest('[data-start]');
        if (play) { startTemplate(Store.getTemplate(play.dataset.start)); return; }
        const edit = e.target.closest('[data-edit]');
        if (edit) openEditor(Store.getTemplate(edit.dataset.edit), false);
    });

    // Editor
    $('#btn-editor-cancel').addEventListener('click', () => { ed = null; showScreen('templates'); });
    $('#btn-editor-save').addEventListener('click', saveEditor);
    $('#ed-icon-row').addEventListener('click', e => {
        const b = e.target.closest('[data-icon]');
        if (b) { ed.icon = b.dataset.icon; renderIconRow(); }
    });
    $('#ed-color-row').addEventListener('click', e => {
        const b = e.target.closest('[data-color]');
        if (b) { ed.color = b.dataset.color; renderColorRow(); renderIconRow(); }
    });
    $('#ed-add-row').addEventListener('click', e => {
        const b = e.target.closest('[data-add]');
        if (!b) return;
        const info = phaseInfo(b.dataset.add);
        ed.steps.push(Store.step(b.dataset.add, info.defaultSec / 60));
        renderSteps();
    });
    $('#btn-add-block').addEventListener('click', () => {
        const count = Math.max(1, Math.min(12, parseInt($('#blk-count').value, 10) || 4));
        const focus = Math.max(1, parseInt($('#blk-focus').value, 10) || 25);
        const pause = Math.max(0, parseInt($('#blk-pause').value, 10) || 0);
        for (let i = 0; i < count; i++) {
            ed.steps.push(Store.step('focus', focus));
            if (pause > 0 && i < count - 1) ed.steps.push(Store.step('pause', pause));
        }
        renderSteps();
        toast(`Added ${count} Pomodoros`);
    });
    $('#ed-steps').addEventListener('input', e => {
        const row = e.target.closest('.step-row');
        if (!row) return;
        const s = ed.steps[+row.dataset.index];
        const field = e.target.dataset.field;
        if (field === 'label') s.label = e.target.value;
        if (field === 'min' || field === 'sec') {
            const m = Math.max(0, parseInt($('[data-field="min"]', row).value, 10) || 0);
            const sec = Math.max(0, Math.min(59, parseInt($('[data-field="sec"]', row).value, 10) || 0));
            s.seconds = m * 60 + sec;
            updateEdTotal();
        }
    });
    $('#ed-steps').addEventListener('change', e => {
        const row = e.target.closest('.step-row');
        if (!row || e.target.dataset.field !== 'type') return;
        const s = ed.steps[+row.dataset.index];
        const oldDefault = phaseInfo(s.type).label;
        s.type = e.target.value;
        if (!s.label || s.label === oldDefault) s.label = phaseInfo(s.type).label;
        renderSteps();
    });
    $('#ed-steps').addEventListener('click', e => {
        const b = e.target.closest('[data-op]');
        if (!b) return;
        const row = b.closest('.step-row');
        const i = +row.dataset.index;
        const op = b.dataset.op;
        if (op === 'del') ed.steps.splice(i, 1);
        if (op === 'dup') ed.steps.splice(i + 1, 0, { ...ed.steps[i], id: Store.uid('s') });
        if (op === 'up' && i > 0) { const t = ed.steps[i - 1]; ed.steps[i - 1] = ed.steps[i]; ed.steps[i] = t; }
        if (op === 'down' && i < ed.steps.length - 1) { const t = ed.steps[i + 1]; ed.steps[i + 1] = ed.steps[i]; ed.steps[i] = t; }
        renderSteps();
    });
    $('#btn-editor-duplicate').addEventListener('click', () => {
        ed.name = $('#ed-name').value.trim() || ed.name;
        const copy = Store.duplicateTemplate(ed);
        Store.saveTemplate(copy);
        toast('Duplicated');
        openEditor(copy, false);
    });
    $('#btn-editor-delete').addEventListener('click', async () => {
        if (await confirmDialog(`Delete “${ed.name || 'Untitled'}”?`, 'Delete')) {
            Store.deleteTemplate(ed.id);
            ed = null;
            toast('Template deleted');
            showScreen('templates');
        }
    });

    // History
    $('#history-list').addEventListener('click', async e => {
        const del = e.target.closest('[data-del]');
        if (!del) return;
        Store.deleteHistory(del.dataset.del);
        renderHistory();
    });
    $('#btn-clear-history').addEventListener('click', async () => {
        if (await confirmDialog('Clear the whole history? This cannot be undone.', 'Clear')) { Store.clearHistory(); renderHistory(); }
    });

    // Settings
    const bindSwitch = (id, key, after) => $(id).addEventListener('change', e => { Store.saveSettings({ [key]: e.target.checked }); if (after) after(e.target.checked); });
    bindSwitch('#set-auto', 'autoAdvance');
    bindSwitch('#set-wake', 'wakeLock', () => Wake.sync());
    bindSwitch('#set-ticks', 'ticks');
    bindSwitch('#set-sound', 'sound', on => { if (on) Sound.chime('focus'); });
    bindSwitch('#set-vibrate', 'vibrate', on => { if (on) vibrate([100]); });
    $('#set-notify').addEventListener('change', async e => {
        if (!e.target.checked) { Store.saveSettings({ notify: false }); return; }
        if (!('Notification' in window)) { e.target.checked = false; toast('Notifications are not supported here.'); return; }
        let perm = Notification.permission;
        if (perm !== 'granted') perm = await Notification.requestPermission();
        if (perm === 'granted') { Store.saveSettings({ notify: true }); toast('Notifications on'); }
        else { e.target.checked = false; Store.saveSettings({ notify: false }); toast('Permission not granted. On iOS, install the app to the Home Screen first.', 3500); }
    });
    $('#btn-test-alert').addEventListener('click', () => { Sound.chime('focus'); vibrate([250, 100, 250]); });
    $('#set-theme').addEventListener('change', e => { Store.saveSettings({ theme: e.target.value }); applyTheme(); });
    $('#btn-export').addEventListener('click', exportData);
    $('#btn-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const res = Store.importData(JSON.parse(reader.result));
                applyTheme();
                renderSettings();
                toast(`Imported ${res.templates} templates, ${res.history} sessions`);
            } catch (err) { toast('Import failed: ' + err.message, 3500); }
            e.target.value = '';
        };
        reader.readAsText(file);
    });
    $('#btn-restore-builtin').addEventListener('click', () => {
        const n = Store.restoreBuiltins();
        toast(n ? `Restored ${n} built-in templates` : 'All built-ins are already there');
    });

    // Keep the countdown honest when the phone wakes up
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { Timer.tick(); if (currentScreen === 'timer') renderTimer(true); if (currentScreen === 'home') renderHome(); }
        Wake.sync();
    });
    window.addEventListener('pageshow', () => { Timer.tick(); if (currentScreen === 'timer') renderTimer(true); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}

function handleLaunchAction() {
    const action = new URLSearchParams(location.search).get('action');
    if (!action) return false;
    history.replaceState(null, '', location.pathname);
    if (action === 'templates') { showScreen('templates'); return true; }
    if (action === 'last') {
        const tpl = Store.getTemplate(Store.getLastTemplateId()) || Store.getTemplates()[0];
        if (tpl && !Timer.isActive()) { beginRun(tpl); return true; }
    }
    return false;
}

function init() {
    applyTheme();
    bind();
    startUiLoop();
    const restored = Timer.restore();
    if (restored) {
        lastStartedTemplate = Store.getTemplate(restored.templateId) || (restored.quick ? Store.quickTemplate(Math.round(restored.steps[0].seconds / 60)) : null);
    }
    // Restoring can finish a session that ran out while the app was closed;
    // in that case the 'done' handler has already put the summary on screen.
    if (!handleLaunchAction() && currentScreen !== 'done') {
        showScreen(Timer.isActive() ? 'timer' : 'home');
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
    }
}

document.addEventListener('DOMContentLoaded', init);
