/* AMS PomoTimer — data layer (templates, settings, history, running session)
   Everything lives in localStorage. No servers, no accounts. */

const Store = (() => {
    const KEYS = {
        templates: 'pomo.templates',
        settings: 'pomo.settings',
        history: 'pomo.history',
        run: 'pomo.run',
        lastTemplate: 'pomo.lastTemplate'
    };

    /* The phase vocabulary. Order here is the order of the "Add phase" chips.
       Each phase type has a colour and a hand-drawn symbol (see the sprite in
       index.html). */
    const PHASE_TYPES = {
        startup:   { label: 'Start-up',    color: 'var(--phase-startup)',   hex: '#22D3EE', icon: 'sunrise', defaultSec: 120  },
        prep:      { label: 'Preparation', color: 'var(--phase-prep)',      hex: '#FFB800', icon: 'notes',   defaultSec: 180  },
        focus:     { label: 'Pomodoro',    color: 'var(--phase-focus)',     hex: '#FF2E63', icon: 'tomato',  defaultSec: 1500 },
        pause:     { label: 'Pause',       color: 'var(--phase-pause)',     hex: '#2EE86B', icon: 'coffee',  defaultSec: 300  },
        longbreak: { label: 'Long break',  color: 'var(--phase-longbreak)', hex: '#00D9C0', icon: 'lotus',   defaultSec: 900  },
        cooldown:  { label: 'Cool-down',   color: 'var(--phase-cooldown)',  hex: '#B44CFF', icon: 'moon',    defaultSec: 300  }
    };

    /* Template icons — all hand-drawn symbols from the sprite. */
    const ICONS = ['tomato', 'clock', 'target', 'book', 'laptop', 'pen', 'lotus', 'coffee', 'moon', 'flame', 'brain', 'star', 'heart', 'music', 'run'];

    /* Templates saved by the 1.0 build carried an emoji; map each to the
       closest drawing so nothing looks broken after the update. */
    const EMOJI_TO_ICON = {
        '🍅': 'tomato', '⏱': 'clock', '⏲': 'clock', '🎯': 'target', '📚': 'book', '💻': 'laptop', '✍️': 'pen', '📝': 'pen',
        '🧘': 'lotus', '🏃': 'run', '🎨': 'star', '🎧': 'music', '🧹': 'star', '☕': 'coffee', '🌙': 'moon', '🔥': 'flame', '🧠': 'brain'
    };

    const COLORS = ['#FF2E63', '#FF7A00', '#FFB800', '#2EE86B', '#22D3EE', '#3B82F6', '#B44CFF', '#FF4FD8'];

    const DEFAULT_SETTINGS = {
        autoAdvance: true,
        wakeLock: true,
        ticks: true,
        sound: true,
        vibrate: true,
        notify: false,
        theme: 'system'
    };

    function uid(prefix) {
        return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
    }

    function step(type, minutes, label) {
        return { id: uid('s'), type, label: label || PHASE_TYPES[type].label, seconds: Math.round(minutes * 60) };
    }

    function iconFor(obj) {
        if (!obj) return 'tomato';
        if (obj.icon && ICONS.includes(obj.icon)) return obj.icon;
        if (obj.emoji && EMOJI_TO_ICON[obj.emoji]) return EMOJI_TO_ICON[obj.emoji];
        return 'tomato';
    }

    /* Built-in templates. IDs are stable so "Restore built-ins" can put them
       back without creating duplicates. The first one is exactly the sequence
       the app was asked for. */
    function builtinTemplates() {
        return [
            {
                id: 'builtin-classic', builtin: true, name: 'Classic Pomodoro', icon: 'tomato', color: '#FF2E63', autoAdvance: null,
                steps: [
                    step('startup', 2), step('prep', 3), step('focus', 25), step('pause', 5), step('focus', 25), step('cooldown', 5)
                ]
            },
            {
                id: 'builtin-four', builtin: true, name: 'Four Pomodoros', icon: 'target', color: '#FFB800', autoAdvance: null,
                steps: [
                    step('startup', 2), step('prep', 3),
                    step('focus', 25), step('pause', 5),
                    step('focus', 25), step('pause', 5),
                    step('focus', 25), step('longbreak', 15),
                    step('focus', 25), step('cooldown', 5)
                ]
            },
            {
                id: 'builtin-deep', builtin: true, name: 'Deep Work 50/10', icon: 'brain', color: '#22D3EE', autoAdvance: null,
                steps: [
                    step('startup', 2), step('prep', 5), step('focus', 50), step('pause', 10), step('focus', 50), step('cooldown', 10)
                ]
            },
            {
                id: 'builtin-short', builtin: true, name: 'Short Burst', icon: 'flame', color: '#FF7A00', autoAdvance: null,
                steps: [
                    step('prep', 1), step('focus', 15), step('pause', 3), step('focus', 15), step('cooldown', 2)
                ]
            },
            {
                id: 'builtin-single', builtin: true, name: 'Single Pomodoro', icon: 'clock', color: '#B44CFF', autoAdvance: null,
                steps: [
                    step('prep', 1), step('focus', 25), step('cooldown', 2)
                ]
            }
        ];
    }

    function read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            console.warn('Store read failed', key, e);
            return fallback;
        }
    }

    function write(key, value) {
        try {
            if (value === null || value === undefined) localStorage.removeItem(key);
            else localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn('Store write failed', key, e);
        }
    }

    /* ---------- Templates ---------- */
    function getTemplates() {
        let list = read(KEYS.templates, null);
        if (!Array.isArray(list)) {
            list = builtinTemplates();
            write(KEYS.templates, list);
            return list;
        }
        // Migrate 1.0 templates (emoji) to icons, once.
        let changed = false;
        list.forEach(t => {
            if (!t.icon) { t.icon = iconFor(t); delete t.emoji; changed = true; }
        });
        if (changed) write(KEYS.templates, list);
        return list;
    }

    function saveTemplates(list) {
        write(KEYS.templates, list);
    }

    function getTemplate(id) {
        return getTemplates().find(t => t.id === id) || null;
    }

    function saveTemplate(tpl) {
        const list = getTemplates();
        const idx = list.findIndex(t => t.id === tpl.id);
        tpl.updatedAt = Date.now();
        if (idx >= 0) list[idx] = tpl;
        else { tpl.createdAt = tpl.createdAt || Date.now(); list.push(tpl); }
        saveTemplates(list);
        return tpl;
    }

    function deleteTemplate(id) {
        saveTemplates(getTemplates().filter(t => t.id !== id));
    }

    function newTemplate() {
        return {
            id: uid('t'), name: '', icon: 'tomato', color: '#FF2E63', autoAdvance: null,
            steps: [step('startup', 2), step('prep', 3), step('focus', 25), step('pause', 5), step('focus', 25), step('cooldown', 5)]
        };
    }

    function duplicateTemplate(tpl) {
        const copy = JSON.parse(JSON.stringify(tpl));
        copy.id = uid('t');
        copy.builtin = false;
        copy.name = (tpl.name || 'Template') + ' copy';
        copy.steps = copy.steps.map(s => ({ ...s, id: uid('s') }));
        delete copy.createdAt;
        return copy;
    }

    function restoreBuiltins() {
        const list = getTemplates();
        const existing = new Set(list.map(t => t.id));
        let added = 0;
        builtinTemplates().forEach(b => {
            if (!existing.has(b.id)) { list.push(b); added++; }
        });
        saveTemplates(list);
        return added;
    }

    /* A throw-away template for the quick timer chips: a single focus phase. */
    function quickTemplate(minutes) {
        return {
            id: 'quick-' + minutes, name: minutes + ' min Pomodoro', icon: 'clock', color: '#FF2E63', autoAdvance: null, quick: true,
            steps: [step('focus', minutes)]
        };
    }

    function templateTotalSec(tpl) {
        return (tpl.steps || []).reduce((a, s) => a + (s.seconds || 0), 0);
    }

    /* ---------- Settings ---------- */
    function getSettings() {
        return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
    }

    function saveSettings(patch) {
        const merged = { ...getSettings(), ...patch };
        write(KEYS.settings, merged);
        return merged;
    }

    /* ---------- History ---------- */
    function getHistory() {
        const h = read(KEYS.history, []);
        return Array.isArray(h) ? h : [];
    }

    function addHistory(entry) {
        const list = getHistory();
        list.unshift(entry);
        if (list.length > 500) list.length = 500;
        write(KEYS.history, list);
    }

    function deleteHistory(id) {
        write(KEYS.history, getHistory().filter(h => h.id !== id));
    }

    function clearHistory() {
        write(KEYS.history, []);
    }

    function dayKey(ts) {
        const d = new Date(ts);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function stats() {
        const now = Date.now();
        const today = dayKey(now);
        const weekStart = new Date();
        weekStart.setHours(0, 0, 0, 0);
        // Week starts on Monday
        const dow = (weekStart.getDay() + 6) % 7;
        weekStart.setDate(weekStart.getDate() - dow);
        const weekTs = weekStart.getTime();

        const out = {
            today: { sessions: 0, pomodoros: 0, focusSec: 0 },
            week: { sessions: 0, pomodoros: 0, focusSec: 0 },
            all: { sessions: 0, pomodoros: 0, focusSec: 0 }
        };
        getHistory().forEach(h => {
            const bump = b => { b.sessions++; b.pomodoros += h.pomodoros || 0; b.focusSec += h.focusSec || 0; };
            bump(out.all);
            if (h.endedAt >= weekTs) bump(out.week);
            if (dayKey(h.endedAt) === today) bump(out.today);
        });
        return out;
    }

    /* ---------- Running session ---------- */
    function getRun() { return read(KEYS.run, null); }
    function saveRun(run) { write(KEYS.run, run); }

    function getLastTemplateId() { return read(KEYS.lastTemplate, null); }
    function setLastTemplateId(id) { write(KEYS.lastTemplate, id); }

    /* ---------- Import / export ---------- */
    function exportData() {
        return {
            app: 'AMS PomoTimer',
            version: 2,
            exportedAt: new Date().toISOString(),
            templates: getTemplates(),
            history: getHistory(),
            settings: getSettings()
        };
    }

    function importData(data) {
        if (!data || typeof data !== 'object') throw new Error('Not a PomoTimer file');
        let templates = 0, history = 0;
        if (Array.isArray(data.templates)) {
            const list = getTemplates();
            data.templates.forEach(t => {
                if (!t || !Array.isArray(t.steps)) return;
                const clean = {
                    id: t.id || uid('t'),
                    name: String(t.name || 'Imported'),
                    icon: iconFor(t),
                    color: t.color || '#FF2E63',
                    autoAdvance: t.autoAdvance === true ? true : (t.autoAdvance === false ? false : null),
                    builtin: !!t.builtin,
                    steps: t.steps.filter(s => s && PHASE_TYPES[s.type]).map(s => ({
                        id: s.id || uid('s'),
                        type: s.type,
                        label: String(s.label || PHASE_TYPES[s.type].label),
                        seconds: Math.max(0, Math.round(Number(s.seconds) || 0))
                    }))
                };
                const idx = list.findIndex(x => x.id === clean.id);
                if (idx >= 0) list[idx] = clean; else list.push(clean);
                templates++;
            });
            saveTemplates(list);
        }
        if (Array.isArray(data.history)) {
            const list = getHistory();
            const ids = new Set(list.map(h => h.id));
            data.history.forEach(h => {
                if (!h || !h.id || ids.has(h.id)) return;
                list.push({ ...h, icon: iconFor(h) });
                history++;
            });
            list.sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
            write(KEYS.history, list);
        }
        if (data.settings && typeof data.settings === 'object') {
            saveSettings(data.settings);
        }
        return { templates, history };
    }

    return {
        PHASE_TYPES, ICONS, COLORS, uid, step, iconFor,
        getTemplates, getTemplate, saveTemplate, deleteTemplate, newTemplate, duplicateTemplate, restoreBuiltins, quickTemplate, templateTotalSec,
        getSettings, saveSettings,
        getHistory, addHistory, deleteHistory, clearHistory, stats, dayKey,
        getRun, saveRun, getLastTemplateId, setLastTemplateId,
        exportData, importData
    };
})();
