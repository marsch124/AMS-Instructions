# AMS Instructions

A mobile-first PWA (Progressive Web App) for quick-reference step-by-step instructions using QR codes. Perfect for RVs, workshops, or anywhere you need instant access to checklists and procedures.

**Live:** https://marsch124.github.io/AMS-Instructions/

> **Also in this repo:** [AMS PomoTimer](pomotimer/README.md) — a phased Pomodoro timer PWA (start-up, preparation, Pomodoro, pause, cool-down) with templates and quick start. Live at https://marsch124.github.io/AMS-Instructions/pomotimer/

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
