# Eddi Docs — Start Here

If you (or an AI assistant) just got dropped into this repo and need to get
oriented fast, read in this order:

1. **[STATUS.md](STATUS.md)** — current state of everything: what's live, what's
   done, what's open. The single "where are we right now" doc. **Keep it updated.**
2. **[RUNBOOK.md](RUNBOOK.md)** — how to build/deploy/run, and a catalog of every
   gnarly problem we've already hit and how we fixed it. Check here *before*
   re-debugging anything that feels familiar.
   - **[ANDROID-RELEASE.md](ANDROID-RELEASE.md)** — the dev→production checklist
     for the Android app (what's left between the debug build on the Pixel and a
     Play-ready release).
3. **`SETUP.md`** (repo root, **gitignored**) — local credentials & machine
   setup (AWS profile, keystore paths, Cloudflare). Not in git on purpose.

## What is Eddi?

NFC cards that, when tapped, open `eddi.audio/c/{id}` — a linktree-style page
for a song/album with service buttons. Plus a `/write` page (and a native app)
for writing cards.

## Repo map

| Path | What |
|------|------|
| `packages/web` | The live site (Vite + React 19 + Tailwind v4). Deployed to Cloudflare Workers. |
| `packages/backend` | AWS CDK — DynamoDB + Lambdas (card lookup/write, event log, OG image). |
| `packages/app` | **The real** React Native app (RN 0.85.3). Android + iOS native projects inside. |
| `worker.ts` / `wrangler.toml` | Cloudflare Worker doing OG/Twitter SSR for bots on `/c/{id}`. |
| `docs/` | This folder. STATUS, RUNBOOK, and research notes. |
| `app/` (repo root) | ⚠️ **OLD prototype.** Git-ignored, kept as reference. Do not build on it. |
| `hardware/`, `pi/`, `Biz Docs/`, `Archive/` | Non-code material. Git-ignored / local. |

## Research notes (background, not state)

- `app-integration-research.md` — deep-linking into Spotify/Apple/etc.
- `nfc-native-research.md` — NFC read/write on Android & iOS.
- `resolver-research.md` — cross-service ISRC resolver (future sprint).
- `pi-setup.md` — Raspberry Pi setup notes.

## The one rule for keeping this useful

When you finish a meaningful chunk of work, update **STATUS.md** (and add to
**RUNBOOK.md** if you solved a new tricky problem). That's the whole point —
so nobody has to reverse-engineer the repo state from `git log` again.
