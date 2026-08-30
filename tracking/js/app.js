/* AMS Tracking — simple, visual habit tracker (vanilla JS, localStorage) */
'use strict';

const APP_VERSION = '1.2';
const STORE_KEY = 'amsTracking.v1';

const PALETTE = [
    '#3b70f0', // blue
    '#e0447c', // pink
    '#2fa96d', // green
    '#ee8b2c', // orange
    '#d9463e', // red
    '#7a5af8', // purple
    '#2aa8c4', // teal
    '#c9a227'  // yellow
];

const DAY_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Monday-first

/* ================= storage ================= */

let state = load();
migrate(state);

/* v1.0 stored emoji as habit icons; map them to hand-drawn icon names */
function migrate(st) {
    (st.habits || []).forEach(h => {
        if (EMOJI_TO_ICON[h.icon]) h.icon = EMOJI_TO_ICON[h.icon];
        else if (!ICON_PATHS[h.icon]) h.icon = 'sun';
    });
}

function load() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {
        console.error('Load failed', e);
    }
    // First run: seed the one habit Martin explicitly asked for, as a live example
    return {
        version: 1,
        habits: [{
            id: newId(),
            name: 'Intermittent Fasting',
            icon: 'moon',
            color: '#7a5af8',
            type: 'timer',
            days: [true, true, true, true, true, true, true],
            createdAt: dateKey(new Date()),
            done: {},
            sessions: []
        }]
    };
}

function save() {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

function newId() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ================= date helpers ================= */

function pad(n) { return String(n).padStart(2, '0'); }

function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function keyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
}

function weekdayIdx(d) { return (d.getDay() + 6) % 7; } // Mon=0 … Sun=6

/* For timer habits, a day counts as done when a fast ENDED on it. */
function doneSet(habit) {
    if (habit.type === 'daily') return habit.done || {};
    const set = {};
    (habit.sessions || []).forEach(s => {
        if (s.e) set[dateKey(new Date(s.e))] = 1;
    });
    return set;
}

function isScheduled(habit, d) {
    if (habit.type === 'timer') return true;
    const days = habit.days || [true, true, true, true, true, true, true];
    return !!days[weekdayIdx(d)];
}

function currentStreak(habit) {
    const done = doneSet(habit);
    const today = new Date();
    let d = new Date(today);
    // Today doesn't break the streak while it's still pending
    if (isScheduled(habit, d) && !done[dateKey(d)]) d = addDays(d, -1);
    let streak = 0;
    for (let i = 0; i < 3700; i++) {
        if (isScheduled(habit, d)) {
            if (done[dateKey(d)]) streak++;
            else break;
        }
        d = addDays(d, -1);
    }
    return streak;
}

function longestStreak(habit) {
    const done = doneSet(habit);
    const keys = Object.keys(done).sort();
    if (!keys.length) return 0;
    let best = 0;
    let d = keyToDate(keys[0]);
    const end = new Date();
    let run = 0;
    for (let i = 0; i < 3700 && d <= end; i++) {
        if (isScheduled(habit, d)) {
            if (done[dateKey(d)]) { run++; best = Math.max(best, run); }
            else run = 0;
        }
        d = addDays(d, 1);
    }
    return best;
}

function completionStats(habit) {
    const done = doneSet(habit);
    const keys = Object.keys(done).sort();
    let start = keyToDate(habit.createdAt || dateKey(new Date()));
    if (keys.length && keyToDate(keys[0]) < start) start = keyToDate(keys[0]);
    const today = new Date();
    let scheduled = 0;
    let d = new Date(start);
    for (let i = 0; i < 3700 && d <= today; i++) {
        if (isScheduled(habit, d)) scheduled++;
        d = addDays(d, 1);
    }
    const doneCount = keys.length;
    return { done: doneCount, total: Math.max(scheduled, doneCount), pct: scheduled ? Math.round(100 * doneCount / Math.max(scheduled, doneCount)) : 0 };
}

/* ================= timer helpers ================= */

function activeSession(habit) {
    return (habit.sessions || []).find(s => !s.e) || null;
}

function lastFinishedSession(habit) {
    const ss = habit.sessions || [];
    for (let i = ss.length - 1; i >= 0; i--) {
        if (ss[i].e) return ss[i];
    }
    return null;
}

function fmtDuration(ms) {
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h + ':' + pad(m);
}

function fmtSessionDate(s) {
    const d = new Date(s.e || s.s);
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ================= today screen ================= */

const $ = (sel) => document.querySelector(sel);

function tint(color, pct) {
    return `color-mix(in srgb, ${color} ${pct}%, var(--card-fallback))`;
}

function renderToday() {
    $('#today-date').textContent = new Date().toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long'
    });

    const list = $('#habit-list');
    list.innerHTML = '';
    $('#empty-state').hidden = state.habits.length > 0;

    state.habits.forEach(habit => list.appendChild(buildCard(habit)));
}

function buildCard(habit) {
    const card = document.createElement('div');
    card.className = 'habit-card';
    card.style.background = tint(habit.color, 10);

    const done = doneSet(habit);
    const todayKey = dateKey(new Date());
    const active = habit.type === 'timer' ? activeSession(habit) : null;
    const doneToday = !!done[todayKey];

    // --- action button ---
    const btn = document.createElement('button');
    btn.className = 'habit-action';
    if (habit.type === 'daily') {
        if (doneToday) {
            btn.style.background = habit.color;
            btn.innerHTML = icon('check');
        } else {
            btn.classList.add('undone');
            btn.style.color = habit.color;
        }
    } else {
        if (active) {
            btn.classList.add('running');
            btn.style.background = habit.color;
            btn.style.setProperty('--pulse', tint(habit.color, 30));
            btn.innerHTML = icon('stop');
        } else {
            btn.classList.add('undone');
            btn.style.color = habit.color;
            btn.innerHTML = icon('play');
        }
    }
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (habit.type === 'daily') toggleToday(habit);
        else toggleTimer(habit);
    });

    // --- middle: name + week dots ---
    const main = document.createElement('div');
    main.className = 'habit-main';
    const name = document.createElement('p');
    name.className = 'habit-name';
    name.innerHTML = `<span class="habit-icon" style="color:${habit.color}">${icon(habit.icon)}</span>${escapeHtml(habit.name)}`;
    main.appendChild(name);
    main.appendChild(buildWeekDots(habit, done));

    // --- right: streak / fasting number ---
    const stat = document.createElement('div');
    stat.className = 'habit-stat';
    const num = document.createElement('div');
    num.className = 'stat-number';
    const label = document.createElement('div');
    label.className = 'stat-label';

    if (habit.type === 'daily') {
        const streak = currentStreak(habit);
        num.innerHTML = `${streak}${icon('flame', 'flame')}`;
        num.style.color = habit.color;
        label.textContent = streak === 1 ? 'day' : 'days';
    } else {
        num.style.color = habit.color;
        if (active) {
            num.textContent = fmtDuration(Date.now() - active.s);
            num.dataset.liveStart = active.s;
            label.textContent = 'fasting';
        } else {
            const last = lastFinishedSession(habit);
            if (last) {
                num.textContent = fmtDuration(last.e - last.s);
                label.textContent = 'last fast';
            } else {
                num.innerHTML = icon('play');
                label.textContent = 'tap to start';
            }
        }
    }
    stat.appendChild(num);
    stat.appendChild(label);

    card.appendChild(btn);
    card.appendChild(main);
    card.appendChild(stat);
    card.addEventListener('click', () => openDetail(habit.id));
    return card;
}

function buildWeekDots(habit, done) {
    const row = document.createElement('div');
    row.className = 'week-dots';
    const today = new Date();
    const monday = addDays(today, -weekdayIdx(today));
    let doneCount = 0;
    let scheduledCount = 0;
    for (let i = 0; i < 7; i++) {
        const d = addDays(monday, i);
        const el = document.createElement('span');
        el.className = 'wd';
        el.textContent = DAY_NAMES[i];
        const scheduled = isScheduled(habit, d);
        if (!scheduled) el.classList.add('off-day');
        else scheduledCount++;
        if (done[dateKey(d)]) {
            el.classList.add('on');
            el.style.background = habit.color;
            doneCount++;
        }
        row.appendChild(el);
    }
    const ratio = document.createElement('span');
    ratio.className = 'wd-ratio';
    ratio.textContent = `${doneCount}/${scheduledCount}`;
    row.appendChild(ratio);
    return row;
}

function toggleToday(habit) {
    const key = dateKey(new Date());
    habit.done = habit.done || {};
    if (habit.done[key]) delete habit.done[key];
    else habit.done[key] = 1;
    save();
    renderToday();
}

function toggleTimer(habit) {
    habit.sessions = habit.sessions || [];
    const active = activeSession(habit);
    if (active) {
        const elapsed = Date.now() - active.s;
        if (elapsed < 5 * 60000 &&
            !confirm('This fast is under 5 minutes. End and record it anyway?\n(Cancel keeps it running.)')) {
            return;
        }
        active.e = Date.now();
    } else {
        habit.sessions.push({ s: Date.now(), e: null });
    }
    save();
    renderToday();
}

/* Live tick for running timers */
setInterval(() => {
    document.querySelectorAll('[data-live-start]').forEach(el => {
        el.textContent = fmtDuration(Date.now() - Number(el.dataset.liveStart));
    });
}, 20000);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderToday();
});

/* ================= detail screen ================= */

let detailId = null;
let calMonth = null; // {y, m} shown in the history calendar

function openDetail(id, keepMonth) {
    if (!keepMonth || detailId !== id) {
        const now = new Date();
        calMonth = { y: now.getFullYear(), m: now.getMonth() };
    }
    detailId = id;
    const habit = state.habits.find(h => h.id === id);
    if (!habit) return;

    $('#detail-title').innerHTML =
        `<span class="habit-icon" style="color:${habit.color}">${icon(habit.icon)}</span>${escapeHtml(habit.name)}`;
    $('#detail-subtitle').textContent = habit.type === 'timer'
        ? 'Start / stop timer habit'
        : 'Daily habit';

    const body = $('#detail-body');
    body.innerHTML = '';

    // --- editable history calendar ---
    body.appendChild(buildHistoryCard(habit));

    // --- timer: session history ---
    if (habit.type === 'timer') {
        body.appendChild(buildSessionCard(habit));
    }

    // --- yearly pixel grids ---
    const done = doneSet(habit);
    const years = new Set([new Date().getFullYear()]);
    Object.keys(done).forEach(k => years.add(Number(k.slice(0, 4))));
    [...years].sort((a, b) => b - a).forEach(year => {
        body.appendChild(buildYearCard(habit, done, year));
    });

    showScreen('detail');
}

/* Month calendar for fixing the past: tap a day to add a completion you
   forgot to log, or remove one entered by mistake. Future days are locked. */
function buildHistoryCard(habit) {
    const card = document.createElement('div');
    card.className = 'detail-card';

    const head = document.createElement('div');
    head.className = 'cal-head';
    const title = document.createElement('h3');
    title.textContent = new Date(calMonth.y, calMonth.m, 1)
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const nav = document.createElement('div');
    nav.className = 'cal-nav';
    const prev = document.createElement('button');
    prev.className = 'pill-btn icon-only cal-nav-btn';
    prev.innerHTML = icon('chevL');
    prev.setAttribute('aria-label', 'Previous month');
    const next = document.createElement('button');
    next.className = 'pill-btn icon-only cal-nav-btn';
    next.innerHTML = icon('chevR');
    next.setAttribute('aria-label', 'Next month');
    const now = new Date();
    next.disabled = calMonth.y === now.getFullYear() && calMonth.m === now.getMonth();
    prev.addEventListener('click', () => {
        calMonth.m--;
        if (calMonth.m < 0) { calMonth.m = 11; calMonth.y--; }
        openDetail(habit.id, true);
    });
    next.addEventListener('click', () => {
        calMonth.m++;
        if (calMonth.m > 11) { calMonth.m = 0; calMonth.y++; }
        openDetail(habit.id, true);
    });
    nav.appendChild(prev);
    nav.appendChild(next);
    head.appendChild(title);
    head.appendChild(nav);
    card.appendChild(head);

    const hint = document.createElement('p');
    hint.className = 'cal-hint';
    hint.textContent = habit.type === 'timer'
        ? 'Tap a day to record a forgotten fast, or to remove one.'
        : 'Tap a day to check it off late, or to remove a mistake.';
    card.appendChild(hint);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    DAY_NAMES.forEach(n => {
        const el = document.createElement('span');
        el.className = 'cal-dow';
        el.textContent = n;
        grid.appendChild(el);
    });

    const done = doneSet(habit);
    const todayKey = dateKey(now);
    const first = new Date(calMonth.y, calMonth.m, 1);
    for (let i = 0; i < weekdayIdx(first); i++) {
        grid.appendChild(document.createElement('span'));
    }
    const daysInMonth = new Date(calMonth.y, calMonth.m + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(calMonth.y, calMonth.m, day);
        const key = dateKey(d);
        const el = document.createElement('button');
        el.className = 'cal-day';
        el.textContent = day;
        if (key > todayKey) {
            el.disabled = true;
        } else {
            if (done[key]) {
                el.classList.add('on');
                el.style.background = habit.color;
            } else if (!isScheduled(habit, d)) {
                el.classList.add('off-day');
            }
            if (key === todayKey) el.style.boxShadow = `inset 0 0 0 2px ${habit.color}`;
            el.addEventListener('click', () => toggleHistoryDay(habit, d, !!done[key]));
        }
        grid.appendChild(el);
    }
    card.appendChild(grid);
    return card;
}

function toggleHistoryDay(habit, d, wasDone) {
    const key = dateKey(d);
    if (habit.type === 'daily') {
        habit.done = habit.done || {};
        if (wasDone) delete habit.done[key];
        else habit.done[key] = 1;
    } else if (wasDone) {
        const victims = (habit.sessions || []).filter(s => s.e && dateKey(new Date(s.e)) === key);
        const label = victims.length === 1
            ? `the ${fmtDuration(victims[0].e - victims[0].s)} h fast`
            : `${victims.length} fasts`;
        if (!confirm(`Remove ${label} recorded on ${d.toLocaleDateString()}?`)) return;
        habit.sessions = habit.sessions.filter(s => !victims.includes(s));
    } else {
        const answer = prompt(`How many hours did you fast on ${d.toLocaleDateString()}?`, '16');
        if (answer === null) return;
        const hours = parseFloat(String(answer).replace(',', '.'));
        if (!isFinite(hours) || hours <= 0 || hours > 48) {
            alert('Please enter a fast length between 0 and 48 hours.');
            return;
        }
        // Record it as ending at noon of that day, so it counts for that day
        const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
        habit.sessions = habit.sessions || [];
        habit.sessions.push({ s: end - hours * 3600e3, e: end });
        habit.sessions.sort((a, b) => a.s - b.s);
    }
    save();
    openDetail(habit.id, true);
}

function buildYearCard(habit, done, year) {
    const card = document.createElement('div');
    card.className = 'detail-card';
    const h = document.createElement('h3');
    h.textContent = year;
    card.appendChild(h);

    const grid = document.createElement('div');
    grid.className = 'pixel-grid';
    const today = new Date();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    let doneCount = 0;
    let scheduledPast = 0;
    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
        const px = document.createElement('span');
        px.className = 'px';
        if (d > today) px.classList.add('future');
        else if (isScheduled(habit, d)) scheduledPast++;
        if (done[dateKey(d)]) {
            px.style.background = habit.color;
            doneCount++;
        }
        grid.appendChild(px);
    }
    card.appendChild(grid);

    const rows = document.createElement('div');
    rows.className = 'stat-rows';
    const isCurrentYear = year === today.getFullYear();
    const stats = [];
    if (isCurrentYear) {
        stats.push(['Current streak', `${currentStreak(habit)} days`]);
        stats.push(['Longest streak', `${longestStreak(habit)} days`]);
        const c = completionStats(habit);
        stats.push(['Completion', `${c.pct}% (${c.done} of ${c.total} days)`]);
    } else {
        stats.push(['Days completed', `${doneCount} of ${scheduledPast}`]);
    }
    stats.forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'stat-row';
        row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
        rows.appendChild(row);
    });
    card.appendChild(rows);
    return card;
}

function buildSessionCard(habit) {
    const card = document.createElement('div');
    card.className = 'detail-card';
    const h = document.createElement('h3');
    h.textContent = 'Fasts';
    card.appendChild(h);

    const finished = (habit.sessions || []).filter(s => s.e);
    if (finished.length) {
        const durations = finished.map(s => s.e - s.s);
        const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
        const max = Math.max(...durations);
        const rows = document.createElement('div');
        rows.className = 'stat-rows';
        [['Average', fmtDuration(avg) + ' h'], ['Longest', fmtDuration(max) + ' h'], ['Total fasts', String(finished.length)]]
            .forEach(([k, v]) => {
                const row = document.createElement('div');
                row.className = 'stat-row';
                row.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
                rows.appendChild(row);
            });
        card.appendChild(rows);
    }

    const ul = document.createElement('ul');
    ul.className = 'session-list';
    const recent = finished.slice(-10).reverse();
    if (!recent.length) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="session-when">No completed fasts yet — press the round button on the card to start one.</span>';
        ul.appendChild(li);
    }
    recent.forEach(s => {
        const li = document.createElement('li');
        const del = document.createElement('button');
        del.className = 'pill-btn icon-only';
        del.style.width = del.style.height = '30px';
        del.style.fontSize = '13px';
        del.innerHTML = icon('x');
        del.setAttribute('aria-label', 'Delete this fast');
        del.addEventListener('click', () => {
            if (!confirm('Delete this recorded fast?')) return;
            habit.sessions.splice(habit.sessions.indexOf(s), 1);
            save();
            openDetail(habit.id);
        });
        li.innerHTML = `<span class="session-when">${fmtSessionDate(s)}</span>` +
            `<span class="session-dur">${fmtDuration(s.e - s.s)} h&nbsp;&nbsp;</span>`;
        li.querySelector('.session-dur').appendChild(del);
        ul.appendChild(li);
    });
    card.appendChild(ul);
    return card;
}

$('#btn-back').addEventListener('click', () => showScreen('today'));

$('#btn-delete').addEventListener('click', () => {
    const habit = state.habits.find(h => h.id === detailId);
    if (!habit) return;
    if (!confirm(`Delete “${habit.name}” and all of its history? This cannot be undone.`)) return;
    state.habits = state.habits.filter(h => h.id !== detailId);
    save();
    showScreen('today');
});

$('#btn-edit').addEventListener('click', () => openSheet(detailId));

function showScreen(which) {
    $('#screen-today').hidden = which !== 'today';
    $('#screen-detail').hidden = which !== 'detail';
    if (which === 'today') renderToday();
    window.scrollTo(0, 0);
}

/* ================= add / edit sheet ================= */

const sheet = {
    editingId: null,
    icon: ICON_NAMES_HABIT[0],
    color: PALETTE[0],
    type: 'daily',
    days: [true, true, true, true, true, true, true]
};

function openSheet(editId) {
    sheet.editingId = editId || null;
    const habit = editId ? state.habits.find(h => h.id === editId) : null;
    sheet.icon = habit ? habit.icon : ICON_NAMES_HABIT[0];
    sheet.color = habit ? habit.color : PALETTE[state.habits.length % PALETTE.length];
    sheet.type = habit ? habit.type : 'daily';
    sheet.days = habit && habit.days ? [...habit.days] : [true, true, true, true, true, true, true];

    $('#sheet-title').textContent = habit ? 'Edit habit' : 'New habit';
    $('#f-name').value = habit ? habit.name : '';
    renderSheetChips();
    $('#sheet-edit').hidden = false;
    if (!habit) setTimeout(() => $('#f-name').focus(), 250);
}

function renderSheetChips() {
    // icons
    const iconRow = $('#f-icons');
    iconRow.innerHTML = '';
    ICON_NAMES_HABIT.forEach(ic => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip' + (ic === sheet.icon ? ' sel' : '');
        c.innerHTML = icon(ic);
        c.addEventListener('click', () => { sheet.icon = ic; renderSheetChips(); });
        iconRow.appendChild(c);
    });

    // colors
    const colorRow = $('#f-colors');
    colorRow.innerHTML = '';
    PALETTE.forEach(col => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip color-chip' + (col === sheet.color ? ' sel' : '');
        c.style.setProperty('--chip-color', col);
        c.addEventListener('click', () => { sheet.color = col; renderSheetChips(); });
        colorRow.appendChild(c);
    });

    // type (locked while editing — history formats differ)
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.classList.toggle('sel', btn.dataset.type === sheet.type);
        btn.disabled = !!sheet.editingId;
        btn.onclick = () => { sheet.type = btn.dataset.type; renderSheetChips(); };
    });

    // scheduled days (daily only)
    $('#f-days-wrap').hidden = sheet.type !== 'daily';
    const dayRow = $('#f-days');
    dayRow.innerHTML = '';
    DAY_NAMES.forEach((n, i) => {
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'chip day-chip' + (sheet.days[i] ? ' sel' : '');
        c.textContent = n;
        c.addEventListener('click', () => {
            if (sheet.days[i] && sheet.days.filter(Boolean).length === 1) return; // keep at least one day
            sheet.days[i] = !sheet.days[i];
            renderSheetChips();
        });
        dayRow.appendChild(c);
    });
}

$('#btn-add').addEventListener('click', () => openSheet(null));
$('#btn-sheet-cancel').addEventListener('click', () => { $('#sheet-edit').hidden = true; });
$('#sheet-edit').addEventListener('click', (e) => {
    if (e.target === $('#sheet-edit')) $('#sheet-edit').hidden = true;
});

$('#btn-sheet-save').addEventListener('click', () => {
    const name = $('#f-name').value.trim();
    if (!name) { $('#f-name').focus(); return; }

    if (sheet.editingId) {
        const habit = state.habits.find(h => h.id === sheet.editingId);
        if (habit) {
            habit.name = name;
            habit.icon = sheet.icon;
            habit.color = sheet.color;
            habit.days = [...sheet.days];
        }
    } else {
        state.habits.push({
            id: newId(),
            name,
            icon: sheet.icon,
            color: sheet.color,
            type: sheet.type,
            days: [...sheet.days],
            createdAt: dateKey(new Date()),
            done: {},
            sessions: []
        });
    }
    save();
    $('#sheet-edit').hidden = true;
    if (sheet.editingId) openDetail(sheet.editingId);
    else renderToday();
});

/* ================= settings / backup ================= */

$('#btn-settings').addEventListener('click', () => { $('#sheet-settings').hidden = false; });
$('#btn-settings-close').addEventListener('click', () => { $('#sheet-settings').hidden = true; });
$('#sheet-settings').addEventListener('click', (e) => {
    if (e.target === $('#sheet-settings')) $('#sheet-settings').hidden = true;
});
$('#app-version').textContent = 'AMS Tracking v' + APP_VERSION;

$('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ams-tracking-backup-' + dateKey(new Date()) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
});

$('#btn-import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!data || !Array.isArray(data.habits)) throw new Error('Not an AMS Tracking backup');
            if (!confirm(`Replace current data with this backup (${data.habits.length} habits)?`)) return;
            state = data;
            save();
            $('#sheet-settings').hidden = true;
            renderToday();
        } catch (err) {
            alert('Import failed: ' + err.message);
        }
    };
    reader.readAsText(file);
});

/* ================= misc ================= */

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed', err));
    });
}

document.querySelectorAll('[data-hi]').forEach(el => { el.innerHTML = icon(el.dataset.hi); });

save();
renderToday();
