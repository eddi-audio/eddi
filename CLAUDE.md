# Eddi — Project Instructions

## Top-level layout

`eddi/` is the whole company folder. One discipline per top-level dir:

| Dir | What | Git |
|-----|------|-----|
| `software/` | The npm monorepo: `packages/` (web, app, backend), `infra/` (Cloudflare worker + wrangler), `node_modules/`, `package.json`, lockfile. **All npm/build commands run from here.** | tracked |
| `device/` | Raspberry Pi firmware / services | tracked |
| `docs/` | Cross-cutting docs (STATUS, RUNBOOK, research, architecture.json) | tracked |
| `business/` | Legal, patent, research, branding | **ignored** |
| `design/` | Visual assets / artwork | **ignored** |
| `hardware/` | CAD, renders, materials | **ignored** |
| `archive/` | Old prototype + scripts — do not build on it | **ignored** |

The real app is `software/packages/app`.

## ⚡ Do this at the START of every session

1. **Read `docs/STATUS.md`** — current state (what's live, done, open). It's the
   source of truth; trust it over reconstructing state from `git log`.
2. **Skim `docs/RUNBOOK.md`** — build/deploy/run commands + fixes for every
   problem already hit. Check it BEFORE re-debugging anything familiar.
3. **If commands return garbled/duplicated output, get SIGKILL'd, or you see
   `ENOSPC` / "temp filesystem full":** it's the session temp dir, NOT the disk
   (`df -h /` has hundreds of GB free). Recover with:
   ```bash
   rm -rf software/packages/app/android/app/build software/packages/app/android/app/.cxx \
          software/packages/app/android/.gradle software/packages/app/android/build
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

- **All software lives under `software/`** — run `npm` from there.
  `software/packages/`: `web` (live site, Cloudflare Workers), `backend`
  (AWS CDK), `app` (React Native 0.85.3). `software/infra/`: Cloudflare
  `worker.ts` + `wrangler.toml`.
- **Credentials/setup** live in `SETUP.md` (repo root, gitignored). ⚠️ It
  contains a plaintext Spotify client secret — never commit/copy/paste it; the
  authoritative secret is in AWS SSM.
- **AWS:** always `--profile eddi` (SSO). For CDK, export creds first:
  `eval $(aws configure export-credentials --profile eddi --format env)`.
- **React must be pinned EXACT** (19.2.3) across all workspaces + root
  `overrides`, or the RN renderer breaks. See RUNBOOK.
- **iOS can't be built on this machine** (Intel Mac; Xcode 16+ is
  Apple-Silicon-only). Android is the production path. See RUNBOOK.
