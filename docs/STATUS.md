# Eddi — Where We Are

_Last updated: 2026-05-30_

Snapshot of the React Native app + signing/DNS push toward production. The web
side (eddi.audio) is already live. This file is the catch-up doc after the
terminal crash.

## TL;DR

- **Android release signing: DONE and verified.** A real, prod-signed release
  APK builds today — confirmed the built APK is signed with the production cert,
  not the debug fallback.
- **App identity: `audio.eddi`** — this is the Android applicationId / Kotlin
  package (a reverse-DNS name), **not a domain**. The domain is `eddi.audio`.
- **DNS: one item open** — `api.eddi.audio` custom domain is not set up. The app
  and site currently hit the raw API Gateway URL, which works fine.

## Android release signing ✅

The branch `fix/rn-react-dedupe-and-nfc-write` carries the work (uncommitted):

- **applicationId + namespace** `audio.eddi`; Kotlin package renamed
  `com.eddiapp` → `audio.eddi` (JS component still registered as `"EddiApp"`).
  versionCode 1 / versionName 1.0.
- **Prod keystore** `~/.eddi-keystore/eddi-release.jks` (PKCS12, alias
  `eddi-release`, valid to 2053). Outside the repo.
- **Credentials** in `~/.gradle/gradle.properties` (chmod 600, never committed):
  `EDDI_RELEASE_STORE_FILE / _KEY_ALIAS / _STORE_PASSWORD / _KEY_PASSWORD`.
- **`app/build.gradle`** release `signingConfig` reads those props and **falls
  back to debug signing if absent**, so the repo still builds without the secret.
- **R8 minify + `shrinkResources` ON** (`enableProguardInReleaseBuilds = true`);
  proguard keep rule for `community.revteltech.nfc.**` guards
  react-native-nfc-manager from being stripped.
- **Monorepo path fixes** — because node_modules is hoisted to the repo root,
  `build.gradle` (root / reactNativeDir / codegenDir / cliFile / hermesCommand)
  and `settings.gradle` (gradle-plugin includeBuild) point at
  `../../../../node_modules` / `../../../node_modules`. Without these the RN
  gradle plugin can't find react-native, Codegen, or the Hermes compiler.
- **Gradle wrapper pinned to 8.13** (down from the scaffold's 9.3.1) for
  compatibility with the RN 0.85 gradle plugin.
- **Built artifact verified** — the release APK at
  `packages/app/android/app/build/outputs/apk/release/app-release.apk` reports
  signer SHA-256
  `B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4`,
  matching the recorded prod cert.

> ⚠️ Back up the `.jks` and its password (password manager + offsite). Lose them
> and a published app can never be updated.

**Build command:**
```
cd packages/app/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
```
(arm64 = the Pixel 8a alpha device; drop the flag or build an AAB for Play.)

## React renderer ✅

Single deduped `react` 19.2.3 under `node_modules/` (matches react-native
0.85.3's build target). Must stay pinned EXACT monorepo-wide — see memory
`rn-react-pinning`.

## DNS / domains

- **eddi.audio** — LIVE on Cloudflare Workers (auto-deploys via `wrangler deploy`).
- **api.eddi.audio** — ❌ NOT set up. App + site use the raw URL
  `https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod/`. To finish:
  add a CNAME in Cloudflare DNS + configure an API Gateway custom domain, then
  rebuild the web with the new `VITE_API_URL`. Not blocking; clean-URL only.
- **AWS** account 733652933079, us-east-1.

## Open / not done

- [ ] `api.eddi.audio` custom domain (the remaining DNS item).
- [ ] Commit the signing/RN branch work (currently all uncommitted).
- [ ] Android build artifacts are NOT yet git-ignored (see Repo hygiene below).
- [ ] `/write` NFC flow untested on real Android + NFC hardware.
- [ ] Palette intensity dial-up + branded fallback palette (deferred to branding).
- [ ] Editorial Spotify playlists 404 under client credentials (known limitation).

## Repo hygiene (the "messy folder")

Real code lives in `packages/` — `app/` (RN), `web/`, `backend/` (CDK).

Currently untracked / noise in `git status`:
- **Build artifacts, should be git-ignored:** `packages/app/android/.gradle/`,
  `packages/app/android/build/`, `packages/app/android/app/build/`,
  `packages/app/android/app/.cxx/`, `packages/app/android/local.properties`,
  `packages/backend/cdk.out/`. (`.gitignore` so far only added `.screenshots/`.)
- **Local/editor cruft:** `.DS_Store`, `.claude/settings.local.json`,
  `playwright.config.ts`.
- **`app/` at repo root is the OLD prototype** (`app/web/old-mbar`,
  `app/web/email-signup-pre-release`, `app/mobile apps/`). Never committed. Kept
  as reference per project notes — do not build on it.
- **Other root dirs** (`Archive/`, `Biz Docs/`, `hardware/`, `pi/`,
  `architecture.json`) — non-code material, currently untracked.
- `worker.ts` / `wrangler.toml` show untracked despite an earlier "Add Worker"
  commit — confirm whether the deployed copies diverged before committing.
