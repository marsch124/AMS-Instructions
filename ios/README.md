# AMS Instructions: native iOS app

This is a native SwiftUI version of AMS Instructions for iPhone and iPad, running iOS 17 or later. It does everything the web app does, and it syncs your library between devices through iCloud.

## What you need

- A Mac with Xcode 16 or later.
- An Apple Developer Program membership (99 USD a year). iCloud sync needs it. With a free Apple ID the app still runs, but only on-device (see "Without iCloud" below).

## First build

1. Open `ios/AMSInstructions.xcodeproj` in Xcode.
2. In the project navigator, select the **AMSInstructions** project, then the **AMSInstructions** target, then **Signing & Capabilities**:
   - Tick **Automatically manage signing** and choose your **Team**.
   - Change **Bundle Identifier** from `com.marsch124.AMSInstructions` to one of your own if Xcode says it's taken, e.g. `com.yourname.AMSInstructions`.
   - Under **iCloud**, make sure **CloudKit** is ticked and one container is selected. Press **+** to create one if the list is empty. Xcode offers `iCloud.<your bundle id>`, which is what the app expects.
   - **Background Modes → Remote notifications** should already be ticked. iCloud uses it to tell the app that another device made a change.
3. Connect your iPhone, select it at the top of the Xcode window, and press **Run** (⌘R).

The first launch shows an empty library. Go to **Settings** and either:

- **Restore from a Backup File**: pick a backup you made in the web app (Settings → Back Up Now there). Everything comes across: instructions, photos, people, audits, to-dos and favourites.
- **Load the Starter Library**: adds the 205 ready-made instructions.

Do this on one device only. The other devices pick the library up through iCloud.

## Without iCloud

To run the app with a free Apple ID, remove the iCloud capability under **Signing & Capabilities**: press the ✕ next to iCloud and next to Push Notifications. The app then keeps the library on the device only. Everything else works the same.

## How the data is kept

| What | Where | Synced? |
|---|---|---|
| Instructions, photos, people, audits, to-dos | SwiftData, in the app's iCloud container | Yes, through iCloud |
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

The project uses Xcode's folder-synchronised groups: any Swift file added under `AMSInstructions/` is part of the app automatically, with no project file edits needed.

## Checks

Every push that touches `ios/` is built by `.github/workflows/ios-build.yml` on a GitHub Mac runner. A red run means the project does not compile. The build log is attached to the run.

## Differences from the web app

- **Scanning** uses Apple's live camera scanner. It reads QR codes and the printed number itself, and only accepts a number that exists in your library.
- **Favourites and Recently Viewed** sync through iCloud with the rest of the library.
- **How This Works** is a shorter native guide. The version log stays with the web app.
