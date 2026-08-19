# AMS Instructions

A mobile-first PWA (Progressive Web App) for quick-reference step-by-step instructions using QR codes. Perfect for RVs, workshops, or anywhere you need instant access to checklists and procedures.

**Live:** https://marsch124.github.io/AMS-Instructions/

## Features

- 📱 **QR Code Scanning** — Point at a label and instantly get step-by-step instructions
- ⭐ **Favorites** — Save frequently-used instructions for quick access
- 📖 **Browse All** — Search and browse your complete instruction library
- 🌙 **Dark Mode** — Eye-friendly interface, perfect for bedside or night use
- 📡 **Fully Offline** — All data stored locally; works without internet
- 💾 **Import/Export** — Backup and share your instructions as JSON
- 📂 **Organized** — Categorize instructions (Bedroom, Driving, Maintenance, etc.)

## Getting Started

### For Users

1. **Install on your device:**
   - iOS: Safari → Share → Add to Home Screen
   - Android: Chrome → Menu → Install app

2. **Add instructions:**
   - Open Settings → Add New Instruction
   - Assign a 3-digit number (001-999) and write your steps
   - Save!

3. **Generate QR codes:**
   - Use a free QR generator (e.g., qr-server.com)
   - Encode each instruction number (e.g., "001")
   - Print and attach to Duro tape at key locations

4. **Scan and follow:**
   - Tap "Scan Instruction"
   - Point at a QR code
   - Follow the numbered steps

### For Developers

**Requirements:**
- Python 3 (for local server)
- A modern web browser

**Setup:**
```bash
cd AMSInstructions
python3 -m http.server 7793
```

Then open `http://localhost:7793` in your browser.

**Project Structure:**
```
├── index.html              # Main app shell
├── manifest.json           # PWA configuration
├── css/
│   └── style.css          # Styling (dark mode, responsive)
├── js/
│   ├── app.js             # App initialization
│   ├── db.js              # IndexedDB database helpers
│   ├── qr.js              # QR code scanning
│   └── ui.js              # Screen management & UI logic
├── sw.js                  # Service worker (offline support)
└── .claude/
    └── launch.json        # Dev server config
```

## Use Cases

- **Bedtime (001):** Evening wind-down checklist
- **Driving (002):** Pre-drive vehicle inspection
- **Water (003):** Tank filling & maintenance
- **Maintenance (004+):** Various RV systems
- **Kitchen:** Appliance procedures
- **Safety:** Emergency checklists

## AMS Workout Sync

A second, separate app in this repository, under `workout/`. It installs as its own
home-screen icon and reads a training plan straight out of an Excel workbook in
Dropbox — then writes what you log after a session back into that same workbook's
existing cells.

**Live:** https://marsch124.github.io/AMS-Instructions/workout/

### What it does

- **Today** — the session planned for today, broken into warm-up, intervals,
  technique and cool-down, colour-coded by discipline (swim, bike, run, mobility,
  stretching, strength).
- **Plan** — the whole schedule, grouped by day, showing what is still to come and
  what has already been logged.
- **Log** — a form that asks only for the numbers that make sense for that sport
  (pace for a run, power for a ride, per-100m pace for a swim) and only for the
  ones your sheet actually has a column for.
- **Sheet setup** — the app guesses which column is which from your headings, in
  English or German, and lets you correct the guess once.

### How it writes to Excel

The workbook is edited surgically rather than rebuilt. An `.xlsx` is a zip of XML
parts; the app rewrites only the `<c>` elements for the cells you filled in and
copies every other part across still compressed, byte for byte. In testing, logging
a session changed exactly one of fourteen parts in the file — charts, conditional
formatting, freeze panes, column widths, number formats and every formula in the
columns it did not touch all came through untouched. Cells that had a formula and
were logged into lose that formula (a stale one would recompute over your value),
`calcChain.xml` is dropped so Excel rebuilds it, and `fullCalcOnLoad` is set so
totals and charts recalculate the moment the file opens.

Durations are converted to whatever the sheet already uses — decimal hours,
minutes, or a real Excel time value — inferred from the existing data and
overridable in Sheet setup.

### Connecting Dropbox

The app is a static page, so it uses OAuth with PKCE: there is no server and no
client secret. You create a Dropbox app once (Settings walks through it), paste in
the public app key, and the tokens live only on your phone. Uploads carry the
`rev` of the copy that was downloaded, so if you edited the workbook on a laptop in
the meantime Dropbox rejects the write and the app replays onto the newer version
instead of overwriting your changes.

### Offline

Logging never waits on the network. An entry is queued on the phone and shown
immediately; syncing then downloads the current workbook, replays the queue onto
it, and uploads. The last workbook read is cached, so today's session is readable
with no signal at all. Without Dropbox, "Open a file" and "Save a copy" do the same
job by hand.

### Developing

```bash
python3 -m http.server 7794
```

Then open `http://localhost:7794/workout/`. No build step and no dependencies — the
zip and xlsx layers are written against the browser's own Compression Streams.

## Version History

**v1.0 (2026-08-12)**
- Initial release with QR scanning, instruction management, favorites, and offline support

## Features in Detail

### QR Scanning
- Uses jsQR library for real-time code detection
- Fallback manual number entry if scanning fails
- Auto-advances to instruction when code is recognized

### Data Storage
- IndexedDB for persistent local storage
- Zero cloud dependency — your data stays on your device
- Supports up to 999 unique instructions

### Service Worker
- Automatic offline caching
- Works without internet connection
- Cache invalidation & updates on new app versions

### Categories & Styling
- 6 built-in categories with color coding
- Custom category support
- Dark mode optimized for mobile

## Tips

- Use **Favorites (★)** for instructions you access frequently
- **Recently Viewed** auto-populates as you scan codes
- **Export** periodically to backup your instructions
- **Search** by number, title, or category

## Privacy

AMS Instructions stores all data locally on your device. No data is sent to servers or external services.

## License

Available for personal and non-commercial use.

---

Made for mobile. Built with PWA standards. No tracking, no ads, no clouds.
