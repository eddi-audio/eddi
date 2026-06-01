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

> **Specs, research & architecture live in Notion** (the "Eddi Audio" workspace
> → Artifacts database), not in git. They exist on disk in `docs/` locally but
> are gitignored — Notion is the source of truth so every contributor and Claude
> session references one copy. Only the operational orientation docs (this file,
> STATUS, RUNBOOK, ANDROID-RELEASE) are tracked in the repo.

## What is Eddi?

NFC cards that, when tapped, open `eddi.audio/c/{id}` — a linktree-style page
for a song/album with service buttons. Plus a `/write` page (and a native app)
for writing cards.

## Repo map

| Path | What |
|------|------|
| `software/` | The npm monorepo — **run `npm` from here**. Contains everything below. |
| `software/packages/web` | The live site (Vite + React 19 + Tailwind v4). Deployed to Cloudflare Workers. |
| `software/packages/backend` | AWS CDK — DynamoDB + Lambdas (card lookup/write, event log, OG image). |
| `software/packages/app` | **The real** React Native app (RN 0.85.3). Android + iOS native projects inside. |
| `software/infra/` | Cloudflare deploy: `worker.ts` (OG/Twitter SSR for bots on `/c/{id}`) + `wrangler.toml`. |
| `device/` | Raspberry Pi firmware / services (was `pi/`) + `SETUP.md`. Git-tracked. |
| `docs/` | Operational orientation only (STATUS, RUNBOOK, README, ANDROID-RELEASE). Specs/research are local-only here and canonical in Notion. |
| `business/` | Legal, research, branding (was `Biz Docs/`). In the folder, **git-ignored**. |
| `design/` | Visual assets / artwork. In the folder, **git-ignored**. |
| `hardware/` | CAD, renders, materials. In the folder, **git-ignored**. |
| `archive/` | Old prototype + old scripts. Reference only, **git-ignored**. Do not build on it. |

## Specs & research → Notion (Artifacts DB)

These are **gitignored** (local-only on disk in `docs/`); the source of truth is
the Notion "Eddi Audio" workspace → Artifacts:

- `architecture-system.md` / `architecture-handoff.md` — system architecture.
- `SAVE-TO-LIBRARY.md` — cross-service playlist handoff spec.
- `CROSS-SERVICE-GRAPH.md` — anonymous cross-service engagement graph (V1).
- `resolver-research.md` — cross-service ISRC resolver research.
- `nfc-native-research.md` — NFC read/write on Android & iOS.
- `app-integration-research.md` — deep-linking into Spotify/Apple/etc.
- `architecture.json` — machine-readable architecture summary.

(Raspberry Pi / device setup notes live with the code: `device/SETUP.md`.)

## The one rule for keeping this useful

When you finish a meaningful chunk of work, update **STATUS.md** (and add to
**RUNBOOK.md** if you solved a new tricky problem). That's the whole point —
so nobody has to reverse-engineer the repo state from `git log` again.
