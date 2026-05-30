# Android: Dev → Production Checklist

The app currently runs on the Pixel as a **debug build**. This is the gap between
that and a real production release. Work down this list toward prod.

## What "the app is on the Pixel in dev" means right now

When you `installDebug` (or `npx react-native run-android`), you get a build that
is **not** production-ready in several ways:

- **Signed with the debug key**, not the prod keystore → can't be uploaded to Play.
- **JS served from the Metro dev server** (your laptop), not bundled into the APK
  → the app breaks the moment Metro isn't running / laptop isn't reachable.
- **No R8 minification** → larger, unoptimized, and doesn't exercise the proguard
  rules (so release-only NFC stripping bugs stay hidden until release).
- **`versionCode 1 / versionName "1.0"`**, default `EddiApp` label, and the
  **stock React Native launcher icon**.

## Status of each prod requirement

| # | Requirement | State |
|---|-------------|-------|
| 1 | Release signing wired (prod keystore, debug fallback) | ✅ done |
| 2 | Keystore + password backed up offsite | ⬜ **confirm** — do not skip |
| 3 | R8 minify + shrinkResources on for release | ✅ done |
| 4 | NFC proguard keep rule | ✅ done |
| 5 | applicationId `audio.eddi` | ✅ done |
| 6 | JS bundled into release APK (not Metro) | ✅ automatic in `assembleRelease` |
| 7 | App display name → "Eddi" | ✅ done |
| 8 | Custom launcher icon (currently stock RN icon) | ⬜ design + add adaptive icon |
| 9 | versionCode / versionName bump per release | ⬜ bump from 1 / "1.0" |
| 10 | API base URL — config vs hardcoded | ⚠️ hardcoded raw execute-api URL |
| 11 | Test the **release** build on the Pixel (not just debug) | ⬜ do this |
| 12 | Google Play listing + upload (AAB) | ⬜ when ready to ship |

## How to build & verify a release (the prod path)

```bash
cd software/packages/app/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: app/build/outputs/apk/release/app-release.apk

# Verify it's signed with the PROD cert (not debug fallback):
APKSIGNER=$(ls $HOME/Library/Android/SDK/build-tools/*/apksigner | tail -1)
"$APKSIGNER" verify --print-certs app/build/outputs/apk/release/app-release.apk | grep -i SHA-256
# expect: B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4

# Install the release build on the connected Pixel:
adb install -r app/build/outputs/apk/release/app-release.apk
```

For Google Play, ship an **AAB** instead and don't restrict architectures:
```bash
./gradlew :app:bundleRelease   # app/build/outputs/bundle/release/app-release.aab
```

## The specific gaps to close (details)

### #7 App display name ✅
`software/packages/app/android/app/src/main/res/values/strings.xml` now sets
`app_name` to `Eddi`, so the home-screen label reads **Eddi**. Note: the
JS-registered component name (`app.json` `name` ↔ `index.js` `registerComponent`
↔ MainActivity `getMainComponentName`) stays `"EddiApp"` — those three must match
each other and are internal, not user-visible. Don't change them casually.

### #8 Launcher icon
Still the stock RN icon (`ic_launcher.png` / `ic_launcher_round.png` across
`mipmap-*`, no `mipmap-anydpi-v26` adaptive icon). Needs a branded icon — ideally
an adaptive icon (foreground + background) generated into all densities.

### #9 Versioning
`versionCode 1`, `versionName "1.0"` in `software/packages/app/android/app/build.gradle`. Bump `versionCode`
(integer, +1) every Play upload; set `versionName` to the human version.

### #10 API URL is hardcoded
`software/packages/app/src/api/cards.ts` hardcodes
`https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod`. Works, but tied to
the raw API Gateway URL. When `api.eddi.audio` exists (see STATUS), switch to it.
Consider a build-time config (debug vs release base URL) rather than a constant.

### #2 Backups (do not skip)
Keystore `~/.eddi-keystore/eddi-release.jks` + its password must be backed up to a
password manager **and** offsite. If lost, the published app can never be updated.
