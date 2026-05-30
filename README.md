# Eddi

NFC cards that open a linktree-style page (`eddi.audio/c/{id}`) for a song or
album when tapped.

## 📍 Where do I start?

**[`docs/README.md`](docs/README.md)** is the entry point. In short:

- **[`docs/STATUS.md`](docs/STATUS.md)** — current state: what's live, done, open.
- **[`docs/RUNBOOK.md`](docs/RUNBOOK.md)** — how to build/deploy/run + fixes for
  every tricky problem we've hit (including the "session keeps crashing" one).
- **`SETUP.md`** (gitignored) — local credentials & machine setup.

## Monorepo layout

- `packages/web` — the live site (Cloudflare Workers).
- `packages/backend` — AWS CDK (DynamoDB + Lambdas).
- `packages/app` — the React Native app.

> Heads up: `app/` at the repo root is an **old prototype** (git-ignored). The
> real app is `packages/app`.
