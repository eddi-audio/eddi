# Eddi — Where We Are

_Last updated: 2026-05-30_

Source-of-truth snapshot. The web side (`eddi.audio`) is live; the current push
is the React Native Android app toward production. See `docs/RUNBOOK.md` for how
to build/run and fixes for problems already hit.

## TL;DR

- **Android app runs untethered on the Pixel** — prod-signed release APK builds,
  installs, launches, and runs with no Metro/USB. Verified on device.
- **App identity `audio.eddi`** is the Android applicationId / Kotlin package
  (reverse-DNS), **not a domain**. The public domain is `eddi.audio` (live).
- **AWS API is live and the app uses it** — `GET /cards/{id}`, `POST /resolve`,
  `POST /cards`, `POST /cards/{id}/events` all respond correctly.
- **One DNS item open:** `api.eddi.audio` custom domain not set up; app + site use
  the raw API Gateway URL, which works.

## Session log — 2026-05-30

Big day. In order:

1. **Recovered from a terminal crash** caused by the session temp dir filling
   (not the real disk). Documented the fix in RUNBOOK. This recurred all session;
   the cure is clearing `software/packages/app/android/{app/build,app/.cxx,.gradle,build}`
   + the claude temp caches.
2. **Committed the signing/RN work** that was uncommitted: release signingConfig,
   R8 + shrinkResources, NFC proguard keep rule, monorepo gradle path fixes,
   gradle wrapper 8.13, `com.eddiapp`→`audio.eddi`.
3. **Reorganized the repo** into one consistent structure (see Repo layout).
4. **Moved signing secrets into the project** at gitignored `software/secrets/`
   (keystore + `signing.properties`), out of `~/.gradle` / `~/.eddi-keystore`.
   User has backed these up. `build.gradle` reads them there, debug-fallback if
   absent.
5. **Renamed the app to "Eddi"** (was "EddiApp") and fixed a crash-corrupted
   `MainActivity.kt`.
6. **Fixed the react-native-screens "fragments should never be restored" crash**
   (`MainActivity.onCreate(null)`) — verified via on-device rotation test.
7. **Added the branded launcher icon** — adaptive icon (E mark + `#25243F` navy)
   from `design/eddi_icon_android_full.png`, all densities + anydpi-v26.
8. **Centralized API config** in `software/packages/app/src/config.ts`
   (`API_BASE` + `WEB_ORIGIN`); removed hardcoded URLs from call sites.
9. **Bumped version** to versionCode 2 / versionName 1.0.1.
10. **Confirmed the AWS API** is current and the app pulls from it.
11. **Researched share-sheet integration** (see "Next" / share-sheet plan).

## Android release ✅

- applicationId + namespace `audio.eddi`; JS component still `"EddiApp"`.
- versionCode 2 / versionName 1.0.1.
- Prod keystore + creds in gitignored `software/secrets/` (debug-fallback if
  absent so anyone can still build).
- R8 minify + shrinkResources ON; proguard keep rule for
  `community.revteltech.nfc.**`.
- Adaptive launcher icon, all densities.
- Built APK verified signed with prod cert SHA-256
  `B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4`.

Build: `cd software/packages/app/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (needs `JAVA_HOME` = Android Studio's JDK; see RUNBOOK).

## AWS API ✅

Live at `https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod` (account
733652933079, us-east-1). Routes (CDK `software/packages/backend/lib/eddi-stack.ts`):
`GET /cards/{id}`, `POST /cards`, `POST /resolve`, `POST /cards/{id}/events`,
`GET /og/{id}`. Backend code committed and clean. `POST /resolve` returns title +
artwork + service_uris for a streaming URL. Spotify secret in SSM.

> Not verified this session: a `cdk diff` against the deployed stack (SSO token
> expired). Endpoints respond correctly, so functionally current. Run
> `aws sso login --profile eddi` then `cdk diff` if byte-level certainty is wanted.

## DNS / domains

- **eddi.audio** — LIVE on Cloudflare Workers (deploy: `cd software && npm run deploy:web`).
- **api.eddi.audio** — ❌ not set up. One-line swap in `config.ts` once it exists.
- AWS account 733652933079, us-east-1.

## iOS — blocked on hardware

Xcode 16+ is Apple-Silicon-only; this is a 2015 Intel Mac (Sequoia via OCLP). iOS
needs an Apple Silicon Mac or a cloud Mac. Android is the production path. See
RUNBOOK.

## Next (when user returns)

- **Write-flow + design redesign** (user is doing this now). Share-sheet
  integration is intentionally **deferred until the flow is finalized** — it's a
  door *into* the Write flow, so building it first would duplicate work. Research
  is captured (Android intent-filter `ACTION_SEND` + a receive-share library;
  auto-resolve a shared URL straight into the preview step; iOS needs a Share
  Extension and is hardware-blocked).
- Backup `software/secrets/` — ✅ done by user.
- Google Play listing + AAB upload — when ready to ship.

## Repo layout

One discipline per top-level dir:

- **`software/`** — the npm monorepo (run `npm` here): `packages/` (`app`,
  `web`, `backend`), `infra/` (Cloudflare worker + wrangler), `node_modules/`,
  `package.json`, and gitignored `secrets/`.
- **`device/`** — RPi firmware. **`docs/`** — docs + `architecture.json`.
- **Git-ignored, on disk only:** `business/`, `design/`, `hardware/`, `archive/`.
- Android build artifacts and `cdk.out/` are git-ignored.
