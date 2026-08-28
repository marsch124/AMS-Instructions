# AMS Instructions

A mobile-first PWA (Progressive Web App) for quick-reference, step-by-step instructions,
reached by a printed 3-digit number. Built for an RV, but it suits a workshop, a boat, a
holiday let — anywhere a job has to be done the same way each time, by whoever happens to
be standing in front of it.

**Live:** https://marsch124.github.io/AMS-Instructions/

Everything lives on the device. No account, no server, no tracking.

## What it does

- 📱 **Numbered instructions** — point the camera at a printed number, or type it, and the job is on screen
- 🔍 **Search that reads the whole instruction** — steps, warnings, equipment, notes, location and owner, not just the title, and it tells you which field matched
- 🗂 **Grouped, filtered, sorted** — categories with their own colours, filters by owner, status and due state, and four sort orders (number, title, most overdue, recently changed) that are remembered between visits
- ✅ **Keeps your place** — tick steps as you go; the progress survives leaving the screen
- 📸 **Photos beside the step they belong to** — a picture pinned to step 4 shows up at step 4
- 🕓 **Done, and who did it** — mark a job done, name the person, and it goes into the Done History with the date
- 📅 **Due tracking** — give an instruction a frequency and it works out what is due or overdue
- 🏃 **Run a Set** — work through several instructions as one checklist
- 📋 **Actions** — a to-do list with priority and due dates, including findings promoted straight out of an audit
- 👥 **People** — name the owner of a job once; their colour-coded pill follows them down the list
- 🩺 **Library Health** — what is missing from the library itself (no owner, no steps, no category), with one-tap fixes for the groups that can fix themselves
- 🧾 **Revision history and audit log** — what changed, when, and at whose hand
- 💾 **Backups you can verify** — export to JSON, and a dry-run restore that says whether a backup would actually come back
- 🌙 **Dark mode** and 📡 **offline**, by way of a service worker — only the camera's OCR
  library is fetched from a CDN, and manual number entry works without it

## Getting Started

### For Users

1. **Install on your device:**
   - iOS: Safari → Share → Add to Home Screen
   - Android: Chrome → Menu → Install app

2. **Fill the library:**
   - Settings → **Restore from a Backup File** to load `AMS-Instructions-starter-library.json`
     (205 instructions across 15 categories), or
   - Instructions → **+** to write your own

3. **Add the people** who own the jobs: Settings → Manage People. Anna and Martin are
   seeded on first run — delete them if they are not your people.

4. **Print the numbers.** Print each 3-digit number large and clear, and attach it where
   the job happens.

5. **Scan and follow.** Tap "Scan Instruction", hold the number in the scan box, work down
   the steps, then mark it Done.

6. **Back it up.** Settings → Back Up Now. Data Safety will tell you whether the backups
   already on the phone would restore.

There is a full guide inside the app: **Settings → How This Works**.

### For Developers

**Requirements:** Python 3 (or any static file server) and a modern browser.

```bash
cd AMS-Instructions
python3 -m http.server 7793
```

Then open `http://localhost:7793`.

The service worker is registered under the `/AMS-Instructions/` scope to match GitHub
Pages, so it will 404 when served from the root locally. The app itself works regardless;
only offline caching is unavailable in that case.

**Project structure:**
```
├── index.html                          # App shell — every screen lives here
├── manifest.json                       # PWA configuration
├── sw.js                               # Service worker (offline cache, versioned)
├── AMS-Instructions-starter-library.json  # 205-instruction starter library
├── css/
│   └── style.css                       # Styling (light/dark, responsive)
├── icons/                              # App, maskable and favicon assets
└── js/
    ├── app.js                          # App-wide startup and mobile gesture guards
    ├── ui.js                           # Screens, rendering, editors, APP_VERSION
    ├── db.js                           # IndexedDB: instructions, people, audits,
    │                                   #   actions, favorites, recents, settings
    ├── qr.js                           # Camera number recognition (Tesseract.js OCR),
    │                                   #   with manual entry as the fallback
    ├── hybrid-storage.js               # On-device backup, two generations deep
    ├── persistence.js                  # Recovery checks over those backup slots
    └── version-sync.js                 # Detects a stale cache and reloads
```

**Versioning:** `APP_VERSION` in `js/ui.js` and `CACHE_NAME` / `APP_VERSION` in `sw.js` must
be bumped together — `version-sync.js` compares the running version against the served one
and forces a reload when they drift. Asset links in `index.html` carry a cache-busting
token that is refreshed on release.

## Data

- **IndexedDB** holds instructions, people, audits, actions, favourites, recents and settings.
- **localStorage** holds two generations of on-device backup (`hybrid-storage.js`), plus
  small bits of UI state: open groups, sort order, step progress, the current run.
- Nothing leaves the device unless you export it yourself.

## Version History

**v40.0 (2026-08)** — Owner pills on list rows, coloured per person; four owner shapes;
sorting the list; search across the whole instruction; photos beside their step;
Library Health; Actions; Run a Set; backup verification.

**v1.0 (2026-08-12)** — Initial release: number scanning, instruction management,
favourites, offline support.

The full log is in the app: **Settings → Version Log**.

## Privacy

AMS Instructions stores all data locally on your device. No data is sent to servers or
external services.

## License

Available for personal and non-commercial use.

---

Made for mobile. Built with PWA standards. No tracking, no ads, no clouds.
