# Eddi — Project Instructions

## Top-level layout

`eddi/` is the whole company folder. One discipline per top-level dir:

| Dir | What | Git |
|-----|------|-----|
| `software/` | The npm monorepo: `packages/` (web, app, backend), `infra/` (Cloudflare worker + wrangler), `node_modules/`, `package.json`, lockfile. **All npm/build commands run from here.** | tracked |
| `device/` | Raspberry Pi firmware / services + `SETUP.md` | tracked |
| `docs/` | Operational orientation only (STATUS, RUNBOOK, README, ANDROID-RELEASE). Specs/research are local-only & **canonical in Notion** | mixed |
| `business/` | Legal, patent, research, branding | **ignored** |
| `design/` | Visual assets / artwork | **ignored** |
| `hardware/` | CAD, renders, materials | **ignored** |
| `archive/` | Old prototype + scripts — do not build on it | **ignored** |

The real app is `software/packages/app`.

## ⚡ Do this at the START of every session

1. **Get the lay of the land from Notion** (the "Eddi Audio" workspace is the
   canonical source of truth — specs/research are gitignored, so the repo alone
   is incomplete). If the Notion MCP is connected:
   - `notion-fetch` the hub **🎵 Eddi Audio** (`34c50a9f-f3c3-8046-9be9-fecc5cbf8f6b`)
     for current state, active workstreams, and critical path.
   - Check the **Tasks** DB (`collection://01337f84-c65c-4161-8428-140f88277ac9`)
     for what's open/in-progress.
   - Before designing anything, check **Artifacts** for the relevant spec and the
     **Decision Log** (`collection://7f6c11d5-7f09-4df7-8d0d-8b788e4797ff`) for
     *why* it's that way. Search the Decision Log BEFORE adding a new decision.
   - Keep Notion updated as work happens (new spec → Artifact; real decision →
     Decision Log). Surface any Notion rate-limits/errors to Daniel.
2. **Read `docs/STATUS.md`** — current repo/build state (what's live, done, open).
   Trust it over reconstructing state from `git log`.
3. **Skim `docs/RUNBOOK.md`** — build/deploy/run commands + fixes for every
   problem already hit. Check it BEFORE re-debugging anything familiar.
4. **If commands return garbled/duplicated output, get SIGKILL'd, or you see
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
