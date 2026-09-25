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

### iCloud

The app syncs through the container `iCloud.com.schabbauer.AMSInstructions`, which is assigned to the app's identifier on developer.apple.com. If Apple won't provision it, the TestFlight workflow uploads the build without iCloud, marked with a warning. The app then keeps its library on each device and otherwise works normally.

**The iCloud data schema.** TestFlight and App Store builds write to iCloud's *Production* environment. That environment only accepts record types that were first defined in *Development* and then deployed. Xcode normally creates them by running a debug build. Here, GitHub does it instead:

- `ios/Config/CloudKitSchema.ckdb` holds the schema. It is generated from the SwiftData models by `python3 ios/tools/cloudkit_schema.py write`. Every build checks that it still matches the models (`… check`).
- `.github/workflows/ios-cloudkit-schema.yml` sends it to Development with Apple's `cktool`. It uses a CloudKit Management Token stored as the secret `CLOUDKIT_MANAGEMENT_TOKEN`, created in the CloudKit Console under Settings → Tokens.
- Then, once per schema change: CloudKit Console → the container → Schema → **Deploy Schema Changes…**

Fields deployed to Production can never change type or be removed. A new model property is fine (add it, regenerate, deploy); renaming or retyping one is not.

Settings → Data Safety → **iCloud sync** in the app shows whether sync works: the last successful sync and the last problem, in words.

### First launch

The library starts empty. Under **Settings**, either restore a web-app backup file (Restore from a Backup File) or press Load the Starter Library. Do this on one device only; the others receive the library through iCloud.

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

`Config/ExportOptions.plist` and `tools/asc.py` belong to the TestFlight workflow.

The project uses Xcode's folder-synchronised groups: any Swift file added under `AMSInstructions/` is part of the app automatically, with no project file edits needed.

## Checks

Every push that touches `ios/` is also built by `.github/workflows/ios-build.yml`, a quick compile check on a GitHub Mac. A red run means the project does not compile. The build log is attached to the run.

## Differences from the web app

- **Scanning** uses Apple's live camera scanner. It reads QR codes and the printed number itself, and only accepts a number that exists in your library.
- **Favourites and Recently Viewed** sync through iCloud with the rest of the library.
- **How This Works** is a shorter native guide. The version log stays with the web app.
