# AMS PomoTimer

A mobile-first Pomodoro timer with **phases**, not just a 25-minute countdown. A session walks you through start-up, preparation, one or more Pomodoros with pauses, and a cool-down. It is a PWA: install it to your phone's home screen and it works offline.

**Live:** https://marsch124.github.io/AMS-Instructions/pomotimer/

## What it does

- **Phased sessions** — Start-up → Preparation → Pomodoro → Pause → Pomodoro → Cool-down (plus Long break, or any order you like).
- **Templates** — Save as many sequences as you want. Each phase has its own name and duration. Reorder, duplicate, delete. A "Pomodoro block" helper adds N Pomodoros with pauses in one tap.
- **Quick start** — Tap a template on the home screen and it starts immediately. The last-used template is listed first. There is also a one-phase quick timer (5 / 10 / 15 / 25 / 45 / 60 minutes, or any number).
- **Timer screen** — Big countdown with a progress ring in the phase colour, phase list you can jump around in, session progress bar with the expected end time, and controls for pause, skip, previous, +1 / −1 minute.
- **Auto-advance or wait** — Phases can start automatically or wait for a tap. Set it globally or per template.
- **Alerts** — Chimes (different for focus and break), vibration, optional notifications, and countdown ticks in the last three seconds.
- **Keep screen awake** — Uses the Wake Lock API while a session is running.
- **History** — Every session is logged with Pomodoros completed and focus minutes. Today, this week, and all-time stats.
- **Export / import** — Templates, history and settings as one JSON file.
- **Dark / light** — Follows the system, or pick one. Deep indigo with hot pink, sunshine, cyan, lime, turquoise and violet; warm cream in light mode.
- **Hand-drawn icons** — Every icon in the app, including the app icon, is drawn by hand as a few SVG strokes. No emoji, no icon font, no stock set.
- **How this works** — Settings has a built-in explanation of sessions, templates, controls, alerts and background behaviour, plus a full version description.
- **Offline** — All data stays on the device in localStorage. No accounts, no servers.

## Install on your phone

- **iPhone:** open the live link in Safari → Share → *Add to Home Screen*.
- **Android:** open in Chrome → Menu → *Install app*.

Home-screen shortcuts (long-press the icon on Android) let you start the last template or jump to Templates.

## Good to know

- The countdown is based on the clock, so it stays correct when the phone sleeps or you switch apps.
- Phones stop running web apps in the background, so **chimes only play while the app is on screen**. Turn on *Keep screen awake* in Settings for the intended experience. Notifications help on Android when the app is in the background; on iOS they only work once the app is installed to the home screen.

## Built-in templates

| Template | Phases |
| --- | --- |
| Classic Pomodoro | Start-up 2 · Preparation 3 · Pomodoro 25 · Pause 5 · Pomodoro 25 · Cool-down 5 |
| Four Pomodoros | Start-up 2 · Preparation 3 · 4 × Pomodoro 25 with pauses 5 / 5 / long break 15 · Cool-down 5 |
| Deep Work 50/10 | Start-up 2 · Preparation 5 · Focus 50 · Pause 10 · Focus 50 · Cool-down 10 |
| Short Burst | Preparation 1 · Pomodoro 15 · Pause 3 · Pomodoro 15 · Cool-down 2 |
| Single Pomodoro | Preparation 1 · Pomodoro 25 · Cool-down 2 |

All of them can be edited or deleted. *Settings → Restore built-in templates* brings back any you removed.

## For developers

Plain HTML, CSS and JavaScript. No build step, no dependencies.

```
pomotimer/
├── index.html        # App shell (all screens)
├── manifest.json     # PWA manifest (relative paths, works in any folder)
├── sw.js             # Service worker: offline cache
├── css/style.css
├── js/
│   ├── store.js      # Templates, settings, history (localStorage)
│   ├── timer.js      # Timer engine (timestamp based, survives reloads)
│   └── app.js        # Screens and UI wiring
└── icons/
    ├── icon.svg      # Hand-drawn app icon (source)
    └── *.png         # Rasterised from icon.svg (192, 512, 512 maskable, 180 Apple, 64 favicon)
```

The in-app icons live as an SVG sprite at the top of `index.html`; add a `<symbol>` there and reference it with `icon('name')` in `app.js`.

Run locally:

```bash
cd pomotimer
python3 -m http.server 7794
```

Then open http://localhost:7794.

The folder is self-contained. To give the app its own repository, copy the `pomotimer/` folder as the repo root and enable GitHub Pages. Nothing needs to change.

## Version history

**v1.1.0 (2026-09-03)**
- Hand-drawn SVG icons throughout: tab bar, timer controls, editor, template icons (15 to choose from), phase symbols (sunrise, checklist, tomato, coffee, lotus, moon) and a hand-drawn app icon.
- New colour scheme: deep indigo ground with bright phase colours; cards, buttons and the progress ring glow in the template or phase colour. Warm cream light mode.
- "How this works" and a full version description in Settings.
- Faint version tag at the bottom of the Timer tab.
- Templates saved by 1.0 are migrated automatically (emoji mapped to the closest drawing).

**v1.0.0 (2026-09-03)** — Initial release: phased sessions, templates, quick start, history, alerts, offline support.
