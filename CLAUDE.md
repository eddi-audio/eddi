# Eddi — Project Instructions

## ⚡ Do this at the START of every session

1. **Read `docs/STATUS.md`** — current state (what's live, done, open). It's the
   source of truth; trust it over reconstructing state from `git log`.
2. **Skim `docs/RUNBOOK.md`** — build/deploy/run commands + fixes for every
   problem already hit. Check it BEFORE re-debugging anything familiar.
3. **If commands return garbled/duplicated output, get SIGKILL'd, or you see
   `ENOSPC` / "temp filesystem full":** it's the session temp dir, NOT the disk
   (`df -h /` has hundreds of GB free). Recover with:
   ```bash
   rm -rf packages/app/android/app/build packages/app/android/app/.cxx \
          packages/app/android/.gradle packages/app/android/build
   rm -rf /private/tmp/claude-*/node-compile-cache \
          /private/tmp/claude-*/v8-compile-cache-* /private/tmp/claude-*/metro-cache
   ```

## ⚡ Do this at the END of meaningful work

- **Update `docs/STATUS.md`** so the next session doesn't have to
  reverse-engineer the repo. Add to `docs/RUNBOOK.md` if you solved a new tricky
  problem. Keeping these current is the whole point.

## Goal direction

We are **building toward production**, not just dev. When working on the app,
prefer the prod path (signed release builds, real config) over leaving things in
dev defaults. See `docs/ANDROID-RELEASE.md` for the dev→prod checklist.

## Project facts

- **Real code is in `packages/`**: `web` (live site, Cloudflare Workers),
  `backend` (AWS CDK), `app` (React Native 0.85.3). Also tracked: `device/`
  (RPi firmware), `infra/` (Cloudflare `worker.ts` + `wrangler.toml`), `docs/`.
- **Non-code material is in the folder but git-ignored:** `business/`
  (legal/research/branding), `hardware/` (CAD/renders), `archive/` (old
  prototype + scripts — do not build on it; the real app is `packages/app`).
- **App identity `audio.eddi`** is the Android package name (reverse-DNS), NOT a
  domain. The domain is `eddi.audio`.
- **Credentials/setup** live in `SETUP.md` (repo root, gitignored). ⚠️ It
  contains a plaintext Spotify client secret — never commit/copy/paste it; the
  authoritative secret is in AWS SSM.
- **AWS:** always `--profile eddi` (SSO). For CDK, export creds first:
  `eval $(aws configure export-credentials --profile eddi --format env)`.
- **React must be pinned EXACT** (19.2.3) across all workspaces + root
  `overrides`, or the RN renderer breaks. See RUNBOOK.

## Dev machine (as of 2026-05-30)

- **MacBook Pro 15" mid-2015 (MacBookPro11,5), Intel Core i7, x86_64, 16 GB RAM.**
- **macOS 15.7.7 Sequoia, running via OpenCore Legacy Patcher** (this Mac is not
  officially supported on Sequoia).
- **Android builds work** natively here. Signing is wired; release builds read
  `~/.gradle/gradle.properties` (`EDDI_RELEASE_*`), falling back to debug signing
  if absent.
- **iOS builds are NOT possible on this machine.** Xcode 16+ requires Apple
  Silicon — it will not run on an Intel Mac at all. Only Command Line Tools 16.4
  are installed (good for CLI/Android tooling, but no `Xcode.app`). iOS work
  needs an Apple Silicon Mac or a cloud Mac (see `docs/RUNBOOK.md`).
