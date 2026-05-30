# Eddi Runbook

How to build, deploy, and run things — plus a catalog of problems we've already
hit and how we fixed them. **Check the Troubleshooting section before
re-debugging anything that feels familiar.**

For current project state see [STATUS.md](STATUS.md). For local credentials see
`SETUP.md` (repo root, gitignored).

> **All software lives under `software/`.** Paths below are from the repo root;
> the npm workspace root is `software/`. From there, `npm run deploy:web` and
> `npm run deploy:backend` are shortcuts for the web/backend deploys.

---

## Common operations

### Web (`software/packages/web`)
```bash
cd software/packages/web
npm run dev          # local dev server
npm run build        # production build (reads VITE_API_URL from .env.local)
```
Deploy the site (Cloudflare Workers + Assets) — config lives in `software/infra/`:
```bash
cd software && npm run deploy:web        # builds web, then wrangler deploy from infra/
```

### Backend (`software/packages/backend`, AWS CDK)
SSO creds don't flow through `--profile` for CDK, so export them first:
```bash
aws sso login --profile eddi
eval $(aws configure export-credentials --profile eddi --format env)
cd software/packages/backend
npm run diff         # cdk diff
npm run deploy       # cdk deploy --require-approval never
```
- Account `733652933079`, region `us-east-1`.
- Spotify secret lives in SSM: `/eddi/prod/spotify/client_id`, `/eddi/prod/spotify/client_secret`.

### Android app (`software/packages/app`)
Debug build / run on device:
```bash
cd software/packages/app/android
./gradlew :app:installDebug
```
Production-signed release APK (arm64 = the Pixel 8a alpha device):
```bash
cd software/packages/app/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# output: app/build/outputs/apk/release/app-release.apk
```
For Google Play, build an AAB instead (`:app:bundleRelease`) and don't restrict
architectures.

**Verify an APK is signed with the prod cert (not the debug fallback):**
```bash
APKSIGNER=$(ls $HOME/Library/Android/SDK/build-tools/*/apksigner | tail -1)
"$APKSIGNER" verify --print-certs path/to/app-release.apk | grep -i SHA-256
# expect: B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4
```
Signing is wired in `software/packages/app/android/app/build.gradle`: it reads
`EDDI_RELEASE_*` from `~/.gradle/gradle.properties` and **falls back to debug
signing if those props are absent** — so the repo builds for anyone, but only a
machine with the secret produces a Play-uploadable build.

> ⚠️ **Back up `~/.eddi-keystore/eddi-release.jks` + its password** (password
> manager + offsite). Lose them and the published app can never be updated again.

---

## Troubleshooting — problems we've already solved

### 🔴 Session/terminal "crashes", garbled or duplicated command output, processes killed
**Symptom:** Commands return mangled output (repeated lines), get SIGKILL'd, or
the terminal dies. May see `ENOSPC` / "temp filesystem ... is full (0MB free)".

**Cause:** NOT the main disk (check `df -h /` — we have hundreds of GB free).
It's the assistant session's **temp dir** (`/private/tmp/claude-502/...`) hitting
a small per-session quota. Android build artifacts (`app/build` ~520MB,
`.cxx` ~400MB) plus tool caches overflow it.

**Fix:**
```bash
# Delete regenerable Android build artifacts (always safe — they rebuild):
rm -rf software/packages/app/android/app/build software/packages/app/android/app/.cxx \
       software/packages/app/android/.gradle software/packages/app/android/build
# Clear assistant tool caches if still tight:
rm -rf /private/tmp/claude-502/node-compile-cache \
       /private/tmp/claude-502/v8-compile-cache-502 \
       /private/tmp/claude-502/metro-cache
df -h /private/tmp   # confirm space recovered
```
**Prevent:** these dirs are now git-ignored. If it keeps happening, set
`CLAUDE_CODE_TMPDIR` to a roomier path.

### 🔴 RN app: "Incompatible React versions" / "Invalid hook call" / "useEffect of null"
**Cause:** `react`/`react-dom` not pinned to the EXACT version React Native was
built against (currently **19.2.3** for RN 0.85.3). A caret that floats, or a
mismatched copy in another workspace, produces a duplicate/incompatible React.

**Fix:** Pin `react` + `react-dom` to the exact version in `packages/app`,
`packages/web`, AND the root `overrides` block together. Then **clean install**
(`overrides` only applies on a fresh install):
```bash
rm -rf node_modules package-lock.json && npm install
# verify: exactly one react under node_modules, no nested copies
find node_modules packages/*/node_modules -path '*/react/package.json' 2>/dev/null
```
Fixed in commit `47ad079`.

### 🔴 Android Gradle can't find react-native / Codegen / Hermes compiler
**Cause:** This is a monorepo with `node_modules` hoisted to the repo root, but
the RN gradle scaffold assumes `node_modules` is one level up from `android/`.

**Fix (already applied):** `software/packages/app/android/app/build.gradle` sets `root`,
`reactNativeDir`, `codegenDir`, `cliFile`, and `hermesCommand` to
`../../../../node_modules/...`, and `settings.gradle` points the gradle-plugin
`includeBuild` at `../../../node_modules/...`. Also the gradle wrapper is pinned
to **8.13** (the scaffold's 9.3.1 was incompatible with the RN 0.85 plugin).
Fixed in commit `75543a5`.

### 🔴 Release APK crashes / NFC stops working only in release builds
**Cause:** R8 minification strips `react-native-nfc-manager`'s native classes
(it ships no consumer proguard rules).

**Fix (already applied):** keep rule in `software/packages/app/android/app/proguard-rules.pro`:
```
-keep class community.revteltech.nfc.** { *; }
```

### 🔴 NFC write fails on a blank tag
**Cause / fix:** handled in commit `47ad079` (blank-tag write path). If
revisiting, that commit is the reference.

### 🟡 Spotify "editorial" playlists return 404
e.g. "Today's Top Hits". Under client-credentials auth, only user/public
playlists and albums/tracks resolve. Known limitation, not a bug.

### 🟡 CDK deploy fails with credentials error despite `--profile eddi`
SSO creds don't propagate through the `--profile` flag in CDK. Run
`eval $(aws configure export-credentials --profile eddi --format env)` first.

---

## Open / not-yet-done

See the "Open / not done" section in [STATUS.md](STATUS.md). Highlights:
- `api.eddi.audio` custom domain (currently using the raw API Gateway URL).
- App launch/runtime not yet verified on a physical device.
- `/write` NFC flow untested on real hardware.
