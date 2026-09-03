/* AMS PomoTimer — timer engine
   Time is tracked with wall-clock timestamps, never by counting ticks, so the
   countdown stays correct when the phone sleeps or the tab is in the background.
   The whole state is written to localStorage after every change so a reload
   (or the OS killing the tab) picks up exactly where it left off. */

const Timer = (() => {
    let run = null;
    let interval = null;
    let lastTickSecond = null;
    const listeners = { change: [], phase: [], done: [], tick: [] };

    function on(evt, fn) { listeners[evt].push(fn); }
    function emit(evt, payload) { listeners[evt].forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }

    function now() { return Date.now(); }

    function persist() {
        Store.saveRun(run && run.status !== 'done' ? run : null);
        emit('change', run);
    }

    function ensureTicking() {
        if (interval) return;
        interval = setInterval(tick, 250);
    }

    function stopTicking() {
        if (interval) clearInterval(interval);
        interval = null;
    }

    /* ---------- Session lifecycle ---------- */
    function start(template, opts) {
        const settings = Store.getSettings();
        const auto = template.autoAdvance === true ? true
            : template.autoAdvance === false ? false
            : settings.autoAdvance;
        const steps = (template.steps || []).filter(s => s.seconds > 0).map(s => ({
            id: s.id, type: s.type, label: s.label, seconds: s.seconds
        }));
        if (!steps.length) return null;

        run = {
            id: Store.uid('r'),
            templateId: template.id,
            name: template.name,
            icon: Store.iconFor(template),
            color: template.color,
            quick: !!template.quick,
            autoAdvance: auto,
            steps,
            index: 0,
            status: 'running',
            startedAt: now(),
            phaseStartedAt: now(),
            phaseTotalMs: steps[0].seconds * 1000,
            endsAt: now() + steps[0].seconds * 1000,
            remainingMs: null,
            focusSec: 0,
            pomodoros: 0,
            phasesDone: 0
        };
        if (!template.quick) Store.setLastTemplateId(template.id);
        persist();
        ensureTicking();
        emit('phase', { run, step: steps[0], index: 0, reason: 'start' });
        return run;
    }

    function restore() {
        const saved = Store.getRun();
        if (saved && saved.status && saved.status !== 'done' && Array.isArray(saved.steps) && saved.steps.length) {
            run = saved;
            ensureTicking();
            tick();
            emit('change', run);
            return run;
        }
        return null;
    }

    function currentStep() { return run ? run.steps[run.index] : null; }

    function remainingMs() {
        if (!run) return 0;
        if (run.status === 'running') return Math.max(0, run.endsAt - now());
        return Math.max(0, run.remainingMs || 0);
    }

    function elapsedInPhaseMs() {
        return Math.max(0, run.phaseTotalMs - remainingMs());
    }

    /* Credit the time spent in the phase that is ending. Only Pomodoro phases
       count as focus time; a Pomodoro counts as completed once at least 80% of
       it was actually spent (so skipping the last 30 seconds still counts, but
       skipping right after starting does not). */
    function creditPhase(completed) {
        const step = currentStep();
        if (!step) return;
        const elapsedSec = Math.round(elapsedInPhaseMs() / 1000);
        if (step.type === 'focus') {
            run.focusSec += elapsedSec;
            if (completed || elapsedSec >= step.seconds * 0.8) run.pomodoros++;
        }
        if (completed || elapsedSec >= step.seconds * 0.8) run.phasesDone++;
    }

    function enterPhase(index, startNow, anchorTs) {
        run.index = index;
        const step = run.steps[index];
        run.phaseTotalMs = step.seconds * 1000;
        if (startNow) {
            const base = anchorTs != null ? anchorTs : now();
            run.status = 'running';
            run.phaseStartedAt = base;
            run.endsAt = base + run.phaseTotalMs;
            run.remainingMs = null;
        } else {
            run.status = 'waiting';
            run.remainingMs = run.phaseTotalMs;
            run.endsAt = null;
        }
        lastTickSecond = null;
    }

    function completeCurrentPhase() {
        const finished = currentStep();
        const finishedIndex = run.index;
        const finishedAt = run.endsAt;
        // Timer shows 0:00 — the whole phase was spent.
        run.remainingMs = 0;
        run.status = 'paused';
        creditPhase(true);

        if (run.index + 1 < run.steps.length) {
            // When auto-advancing, anchor the next phase to the moment this one
            // ended, not to "now": if the phone slept through the transition the
            // next phase has already been running for a while.
            enterPhase(run.index + 1, run.autoAdvance, run.autoAdvance ? finishedAt : null);
            persist();
            emit('phase', { run, step: currentStep(), index: run.index, finished, finishedIndex, reason: 'complete' });
        } else {
            finish(true);
        }
    }

    function tick() {
        if (!run) { stopTicking(); return; }
        if (run.status !== 'running') return;
        let guard = 0;
        while (run && run.status === 'running' && run.endsAt - now() <= 0 && guard < 100) {
            guard++;
            completeCurrentPhase();
        }
        if (!run || run.status !== 'running') return;
        const rem = run.endsAt - now();
        const sec = Math.ceil(rem / 1000);
        if (sec !== lastTickSecond) {
            lastTickSecond = sec;
            if (sec > 0 && sec <= 3) emit('tick', { secondsLeft: sec });
        }
    }

    function finish(completed) {
        if (!run) return;
        if (!completed) {
            // Stopped mid-phase: credit what was actually spent.
            creditPhase(false);
        }
        run.status = 'done';
        run.endedAt = now();
        run.completed = !!completed;
        stopTicking();
        const entry = {
            id: run.id,
            templateId: run.templateId,
            name: run.name,
            icon: Store.iconFor(run),
            color: run.color,
            startedAt: run.startedAt,
            endedAt: run.endedAt,
            focusSec: run.focusSec,
            pomodoros: run.pomodoros,
            phasesDone: run.phasesDone,
            phasesTotal: run.steps.length,
            completed: !!completed
        };
        // Do not clutter history with quick timers that were stopped at once.
        if (entry.focusSec >= 60 || entry.completed) Store.addHistory(entry);
        const finishedRun = run;
        persist();
        run = null;
        Store.saveRun(null);
        emit('done', { run: finishedRun, entry });
    }

    /* ---------- Controls ---------- */
    function pause() {
        if (!run || run.status !== 'running') return;
        run.remainingMs = Math.max(0, run.endsAt - now());
        run.status = 'paused';
        run.endsAt = null;
        persist();
    }

    function resume() {
        if (!run || (run.status !== 'paused' && run.status !== 'waiting')) return;
        run.endsAt = now() + (run.remainingMs || 0);
        run.phaseStartedAt = run.endsAt - run.phaseTotalMs;
        run.status = 'running';
        run.remainingMs = null;
        lastTickSecond = null;
        persist();
        ensureTicking();
        tick();
    }

    function toggle() {
        if (!run) return;
        if (run.status === 'running') pause(); else resume();
    }

    /* Start the phase we are waiting on (manual advance mode). */
    function startWaiting() {
        if (!run || run.status !== 'waiting') return;
        resume();
        emit('phase', { run, step: currentStep(), index: run.index, reason: 'manual' });
    }

    function jumpTo(index) {
        if (!run) return;
        if (index < 0 || index >= run.steps.length) return;
        creditPhase(false);
        enterPhase(index, true);
        persist();
        emit('phase', { run, step: currentStep(), index, reason: 'jump' });
    }

    function next() {
        if (!run) return;
        if (run.index + 1 < run.steps.length) jumpTo(run.index + 1);
        else finish(true);
    }

    /* Like a music player: within the first few seconds go to the previous
       phase, otherwise restart the current one. */
    function prev() {
        if (!run) return;
        if (elapsedInPhaseMs() > 3000 || run.index === 0) jumpTo(run.index);
        else jumpTo(run.index - 1);
    }

    function adjust(deltaSec) {
        if (!run) return;
        const delta = deltaSec * 1000;
        if (run.status === 'running') {
            const rem = run.endsAt - now();
            const newRem = Math.max(0, rem + delta);
            run.endsAt = now() + newRem;
            run.phaseTotalMs = Math.max(1000, run.phaseTotalMs + (newRem - rem));
        } else {
            const rem = run.remainingMs || 0;
            const newRem = Math.max(0, rem + delta);
            run.phaseTotalMs = Math.max(1000, run.phaseTotalMs + (newRem - rem));
            run.remainingMs = newRem;
        }
        lastTickSecond = null;
        persist();
    }

    function stop() {
        if (!run) return;
        finish(false);
    }

    /* ---------- Derived state for the UI ---------- */
    function snapshot() {
        if (!run) return null;
        const rem = remainingMs();
        const step = currentStep();
        const sessionTotal = run.steps.reduce((a, s) => a + s.seconds * 1000, 0);
        let sessionRemaining = rem;
        for (let i = run.index + 1; i < run.steps.length; i++) sessionRemaining += run.steps[i].seconds * 1000;
        return {
            run,
            step,
            index: run.index,
            count: run.steps.length,
            status: run.status,
            remainingMs: rem,
            phaseTotalMs: run.phaseTotalMs,
            phaseFraction: run.phaseTotalMs > 0 ? Math.min(1, Math.max(0, rem / run.phaseTotalMs)) : 0,
            sessionTotalMs: sessionTotal,
            sessionRemainingMs: sessionRemaining,
            nextStep: run.steps[run.index + 1] || null
        };
    }

    function isActive() { return !!run; }

    return { on, start, restore, pause, resume, toggle, startWaiting, jumpTo, next, prev, adjust, stop, tick, snapshot, isActive };
})();
