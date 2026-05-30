# Eddi

NFC cards that open a linktree-style page (`eddi.audio/c/{id}`) for a song or
album when tapped.

## 📍 Where do I start?

**[`docs/README.md`](docs/README.md)** is the entry point. In short:

- **[`docs/STATUS.md`](docs/STATUS.md)** — current state: what's live, done, open.
- **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** — how to build/deploy/run + fixes for
  every tricky problem we've hit (including the "session keeps crashing" one).
- **`SETUP.md`** (gitignored) — local credentials & machine setup.

## Folder layout

One discipline per top-level dir:

- `software/` — **all code** (run `npm` from here): `packages/web` (live site),
  `packages/backend` (AWS CDK), `packages/app` (React Native), `infra/`
  (Cloudflare deploy).
- `device/` — Raspberry Pi firmware.
- `docs/` — STATUS, RUNBOOK, research, architecture.
- `business/`, `design/`, `hardware/`, `archive/` — non-code material, kept in
  the folder but **git-ignored**. (`archive/` holds the old prototype — don't
  build on it; the real app is `software/packages/app`.)
