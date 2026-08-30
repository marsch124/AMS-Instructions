# AMS Tracking

An easy-to-use, visually pleasing habit tracker PWA. The main screen shows the tracking status of all habits at a glance in one large scrolling area of colored cards.

**Live:** https://marsch124.github.io/AMS-Instructions/tracking/

## Features

- ✅ **Daily habits** — one tap on the big circle checks a habit off for today
- ⏱️ **Start/Stop habits** (e.g. **intermittent fasting**) — the *same* button starts the timer in the evening and stops it when you eat again; the card shows the live elapsed time while fasting and the duration of the last fast afterwards
- 🔥 **Streaks** — every daily habit card shows its current streak with a flame
- 📅 **Week dots** — M–S dots on each card show this week's progress (e.g. 5/7); habits can be scheduled on specific weekdays only
- 🟦 **Pixel year view** — tap any card for a "365 days, pixel by pixel" grid per year plus current streak, longest streak, and completion %
- 🍽️ **Fast history** — timer habits list recent fasts with average and longest duration; misrecorded fasts can be deleted
- 🎨 **8 colors and emoji icons** per habit, automatic dark mode
- 📡 **Fully offline** — installable PWA, all data stays on the device (localStorage)
- 💾 **Backup** — export/import all data as JSON from Settings
- ❓ **In-app help** — collapsible "How it works" and version history sections under Settings

## Usage

1. Open the live URL on your phone and *Add to Home Screen* (iOS Safari: Share → Add to Home Screen).
2. Tap **＋** to add a habit: pick a name, icon, color, and type:
   - **Daily check** — tick it off once a day, optionally only on selected weekdays.
   - **Start / Stop** — one button toggles a timer; made for intermittent fasting.
3. Tap the big circle on a card to check off / start / stop. Tap anywhere else on the card for the yearly pixel view and stats.

## Development

Static app, no build step:

```bash
cd AMS-Instructions
python3 -m http.server 7794
# open http://localhost:7794/tracking/
```

**Structure:**

```
tracking/
├── index.html      # App shell (Today screen, detail screen, sheets)
├── manifest.json   # PWA configuration
├── css/style.css   # Styling (light/dark, mobile-first)
├── js/app.js       # All logic: storage, streaks, rendering
├── sw.js           # Service worker (offline; network-first navigations)
└── icons/          # Generated app icons
```

When releasing a change, bump the `?v=` query on the asset links in `index.html` and the `CACHE_NAME` in `sw.js`.

## Data model

Everything lives in `localStorage` under `amsTracking.v1`:

- Daily habits store completed days as `done["YYYY-MM-DD"]`.
- Timer habits store `sessions: [{s, e}]` (epoch ms; `e: null` while running). A day counts as completed when a fast **ended** on it.

## Privacy

All data is stored locally on the device. No servers, no tracking, no accounts.
