# Eddi — Where We Are

_Last updated: 2026-05-30_

Catch-up snapshot after the terminal crash. The web side (eddi.audio) is already
live; this focuses on the React Native app + signing/DNS push toward production.

> Note: an earlier version of this file was corrupted (repeated header lines)
> because it was written while the session's temp disk was full. This is the
> clean rewrite.

## TL;DR

- **Android release signing: DONE and verified.** A real, prod-signed release
  APK builds — the built APK was confirmed signed with the production cert, not
  the debug fallback.
- **App identity: `audio.eddi`** — this is the Android applicationId / Kotlin
  package (reverse-DNS), **not a domain**. The domain is `eddi.audio` (live).
- **DNS: one item open** — `api.eddi.audio` custom domain is not set up. App +
  site hit the raw API Gateway URL, which works.

## Android release signing ✅

Committed on branch `fix/rn-react-dedupe-and-nfc-write`:

- **applicationId + namespace** `audio.eddi`; Kotlin package renamed
  `com.eddiapp` → `audio.eddi` (JS component still registered as `"EddiApp"`).
- **Prod keystore** `~/.eddi-keystore/eddi-release.jks` (PKCS12, alias
  `eddi-release`, valid to 2053). Outside the repo.
- **Credentials** in `~/.gradle/gradle.properties` (chmod 600, never committed):
  `EDDI_RELEASE_STORE_FILE / _KEY_ALIAS / _STORE_PASSWORD / _KEY_PASSWORD`.
- **`app/build.gradle`** release `signingConfig` reads those props and **falls
  back to debug signing if absent**, so the repo still builds without the secret.
- **R8 minify + `shrinkResources` ON**; proguard keep rule for
  `community.revteltech.nfc.**` guards react-native-nfc-manager.
- **Monorepo gradle path fixes** — node_modules is hoisted to the repo root, so
  `build.gradle` (root / reactNativeDir / codegenDir / cliFile / hermesCommand)
  and `settings.gradle` point at `../../../../node_modules` / `../../../node_modules`.
- **Gradle wrapper pinned to 8.13** (from the scaffold's 9.3.1) for RN 0.85
  plugin compatibility.
- **Built artifact verified** — release APK signer SHA-256
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
0.85.3's build target). Must stay pinned EXACT monorepo-wide.

## DNS / domains

- **eddi.audio** — LIVE on Cloudflare Workers (auto-deploys via `wrangler deploy`).
- **api.eddi.audio** — ❌ NOT set up. App + site use the raw URL
  `https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod/`. To finish: add
  a CNAME in Cloudflare DNS + configure an API Gateway custom domain, then
  rebuild web with the new `VITE_API_URL`. Not blocking; clean-URL only.
- **AWS** account 733652933079, us-east-1.

## Open / not done

- [ ] `api.eddi.audio` custom domain (the remaining DNS item).
- [ ] `/write` NFC flow untested on real Android + NFC hardware.
- [ ] App launch/runtime not yet verified on a physical device.
- [ ] Palette intensity dial-up + branded fallback palette (deferred to branding).
- [ ] Editorial Spotify playlists 404 under client credentials (known limitation).

## Repo layout

- **Real code lives in `packages/`** — `app/` (RN 0.85.3), `web/`, `backend/` (CDK).
- **`app/` at repo root is the OLD prototype** — now git-ignored, kept on disk as
  reference. Do not build on it.
- Android build artifacts (`.gradle/`, `build/`, `app/build/`, `.cxx/`,
  `local.properties`) and `cdk.out/` are git-ignored.
- `worker.ts` + `wrangler.toml` at repo root are the live OG-SSR Cloudflare
  deployment.
