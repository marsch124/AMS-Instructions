# AMS Instructions: native iOS app

This is a native SwiftUI version of AMS Instructions for iPhone and iPad, running iOS 17 or later. It does everything the web app does, and it syncs your library between devices through iCloud.

## Releases: GitHub to TestFlight, no Xcode

Nobody needs to open Xcode. `.github/workflows/ios-testflight.yml` builds the app on a GitHub Mac, signs it and uploads it to TestFlight:

- automatically, on every push that changes `ios/` (on `main` and on `claude/…` branches)
- by hand, from Actions → iOS TestFlight → Run workflow

The build number is the workflow's run number, so nothing needs bumping. Every build goes to the internal TestFlight group "Me", and appears in the TestFlight app on your iPhone a few minutes after the run turns green.

It works the same way as AMS-Workout-Sync-iOS: team `D24ENP83QQ`, bundle ID `com.schabbauer.AMSInstructions`, an unsigned archive, and signing only at the export step with the App Store Connect API key. That way no runner uses up a development certificate.

### One-time setup (browser only)

1. **Secrets.** Under Settings → Secrets and variables → Actions in this repository, add `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the full text of the .p8 file). Use the same key as the other apps.
2. **App record.** In App Store Connect, press + → New App: iOS, bundle ID `com.schabbauer.AMSInstructions`, SKU `AMSInstructions`. Apple doesn't let an API key create apps. The workflow registers the bundle ID and switches on iCloud and push notifications by itself (`ios/tools/asc.py`).

If either is missing, the run stops at its first steps and says which.

### iCloud sync

The library syncs as **one file in the app's own iCloud Drive folder** (`Documents/Library.json` in the container `iCloud.com.schabbauer.AMSInstructions`), the same way the other AMS apps sync. There is no iCloud database, so there's no schema and nothing to deploy. The file is an ordinary backup, in the same JSON as Back Up Now (`Backup/FileSync.swift`).

- A device sends its library a few seconds after a change and when the app goes to the background. It checks for a newer file at launch, when the app comes to the front, and whenever iCloud reports the file changed.
- **The most recent version wins.** Before this device's library is replaced by a newer one from iCloud, it is saved into the automatic backup slot, so it can be put back from Data Safety.
- Deletions sync too: taking over the cloud file replaces the library completely.
- Per-device things stay per device: ticked steps, the run in progress, sort order, and recently viewed.
- Settings → Data Safety → **iCloud sync** shows the last send, the last receive and any problem in words, with a **Sync Now** button.

If Apple won't provision the iCloud container, the TestFlight workflow uploads the build without iCloud, marked with a warning. The app then works on one device only.

### First launch

The library starts empty. Under **Settings**, either restore a web-app backup file (Restore from a Backup File) or press Load the Starter Library. Do this on one device only; the others receive the library through iCloud Drive.

## Labels

Every instruction is labelled **AMS#xxx**, for example AMS#007. A label shows a QR code holding `AMS#007` and the code in large type, plus the title on the wider formats. They are printed on a label printer, one label per page:

- **One label:** instruction screen → **Print Label** (the button below Mark Done).
- **Many:** Instructions → filter (a category, say) → Apply to all → Print labels for all N.
- **Formats:** 12 mm tape (text only), 24 mm tape, 36 mm tape, 62 × 29 mm roll. The choice is remembered on the device.
- **Print…** goes to AirPrint printers. **Send to the printer's app…** hands a PDF, plus a PNG per label for up to 20 labels, to Brother iPrint&Label or DYMO Connect.

The scanner prefers `AMS#…` over any other number in view, so a "12V" beside the label can't open the wrong instruction. Older labels with just the number still scan. The web app's scanner keeps only the digits, so it reads the new labels too.

## Recognising items without a label

An instruction can also be opened by pointing the camera at the item itself.

- **Teach:** instruction screen → **Recognise this item** → Take Teaching Photo. Take 2–3 photos from the angles you would scan from (up to 5). Touch and hold a photo to remove it.
- **Recognise:** Scan → **Item** → point at the item → **Recognise**. A clear match opens the instruction. If it is unsure it shows the likeliest three to tap; if nothing is close it says "Not recognised".

It runs on the phone with Apple Vision "feature prints" (a fingerprint of each photo), so no internet is needed. The teaching photos go into backups and iCloud sync. Items that look alike, or very different light, can confuse it; the thresholds live in `Logic/Recognition.swift`.

## New from Photos (AI drafts)

Instructions → **New** → **New from Photos** starts with the photos instead of the form:

1. Take or choose 2–5 photos of the item, and optionally say in a few words what the instruction should cover.
2. **Draft with Claude** sends the photos to the Anthropic API (`Logic/AIDraft.swift`, model `claude-opus-5`, a JSON-schema answer), which drafts every field. Without a key, **Continue** leads to the same pages, empty.
3. Ten pages, one topic each (title, place, category, safety, equipment, steps with a photo per step, afterwards, schedule, owner/tags/notes, check and save), with a progress bar and Back/Next.
4. Save creates the instruction with the next free number, stores the photos, and uses them as teaching photos for Scan → Item. **Print Label** is offered straight away.

The key is pasted once under Settings → **AI Drafts**. It lives in the Keychain (`Logic/APIKeyStore.swift`), never in backups or the sync file. Each draft costs a few cents on the Anthropic API account.

## How the data is kept

| What | Where | Synced? |
|---|---|---|
| Instructions, photos, people, audits, to-dos | SwiftData, on the device | Yes, as one file in the app's iCloud Drive folder |
| Ticked steps, the run in progress, sort order, "who did it" last time | On the device (UserDefaults) | No, like localStorage in the web app |
| Automatic backups (current and previous) | App storage on each device | No. Saved whenever you leave the app |
| Backup files | Wherever you save them | You choose |

Backup files use exactly the same JSON format as the web app. A web backup restores in the native app, and a native backup restores in the web app.

## Project layout

```
ios/
├── AMSInstructions.xcodeproj
├── Config/                  Info.plist additions and iCloud entitlements
└── AMSInstructions/
    ├── App/                 App entry point, tab bar
    ├── Models/              SwiftData records
    ├── Backup/              Backup file format, restore/backup, automatic backups, backup check
    ├── Logic/               Due dates, search, sorting, colours, per-device state
    ├── Views/               Home, Instructions, instruction screen, Scan, Actions, Settings
    ├── Resources/           The starter library
    └── Assets.xcassets      App icon and accent colour
```

`Config/ExportOptions.plist` and `tools/asc.py` belong to the TestFlight workflow.

The project uses Xcode's folder-synchronised groups: any Swift file added under `AMSInstructions/` is part of the app automatically, with no project file edits needed.

## Checks

Every push that touches `ios/` is also built by `.github/workflows/ios-build.yml`, a quick compile check on a GitHub Mac. A red run means the project does not compile. The build log is attached to the run.

## Differences from the web app

- **Scanning** uses Apple's live camera scanner. It reads QR codes and the printed number itself, and only accepts a number that exists in your library.
- **Favourites and Recently Viewed** sync through iCloud with the rest of the library.
- **How This Works** is a shorter native guide. The version log stays with the web app.
