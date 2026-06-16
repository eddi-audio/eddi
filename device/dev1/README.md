# dev1 — OG NFC player (vendored)

Source of truth for the **dev1** prototype's on-device software (`nfc-player`).
This is the *original* dev device — a Raspberry Pi 5 running a Python/React NFC
jukebox — and is a **separate lineage** from the production app in
`software/packages/app`. Don't conflate them. Operational/recovery notes live in
[`../DEV1-OG-PROTOTYPE.md`](../DEV1-OG-PROTOTYPE.md).

The code here mirrors `/home/dancalt/nfc-player/` on the Pi (which is also its own
git repo). Edit here → deploy to the Pi (see **Deploy** below).

## What it does

Tap an NFC tag → resolve it → play on Spotify, shown on a fullscreen kiosk.

| Service (systemd) | Role | Port |
|---|---|---|
| `nfc-reader` | `backend/nfc_reader.py` — polls the PN532 over SPI, parses NDEF URI records off the tag | — |
| `nfc-backend` | `backend/app.py` — Flask: holds current-card state, brokers a Spotify token, **resolves new-format cards via the Eddi API** | :5000 |
| `nfc-frontend` | `backend/serve_build.py` — serves the static React build (`frontend/build`) | :3000 |
| `raspotify` | Spotify Connect client (independent audio path) | — |

Kiosk: labwc autostart (`kiosk/labwc-autostart`) launches Chromium fullscreen at
`localhost:3000`.

## Card formats (the recode)

The reader handles **both**:
- **New "linktree" cards** — NDEF URI record `https://eddi.audio/c/{id}`. The
  reader extracts `{id}` and posts it as `eddi_card_id`; `app.py` resolves it via
  `GET {EDDI_API_BASE}/cards/{id}` to a Spotify URI + title + artwork. This is the
  same card format the production app writes (`software/packages/app`).
- **Legacy cards** — a direct `open.spotify.com/...` URL on the tag (still works).

`EDDI_API_BASE` defaults to the prod API Gateway; override via env in
`nfc-backend.service` if needed.

## Stability hardening

dev1 hard-froze under heavy I/O load (webpack dev server + Chromium). Mitigations:
- **Static build instead of `react-scripts start`** — `serve_build.py` (stdlib
  only, no webpack, no npm global) removes the constant SD-card writes.
- **Chromium profile + cache in `/dev/shm` (tmpfs/RAM)** via the kiosk launcher —
  zero SD writes from the browser, and no "restore pages?" bubble (fresh profile
  each boot).
- **Self-healing kiosk** — relaunches Chromium if it exits.
- **Hardware watchdog** — `RuntimeWatchdogSec` in `/etc/systemd/system.conf`
  auto-reboots on a hard freeze (~1 min) instead of needing a manual power pull.
- **WiFi power-save disabled** (NM `conf.d/99-no-powersave.conf`).

> ⚠️ The Pi is powered *through* the amp/HAT rather than a direct 27W USB-C
> supply. A live load test showed no undervoltage flags, so the freezes look more
> like SD-I/O stalls than a sagging rail — but a proper direct 27W supply is cheap
> insurance and recommended for demos.

## Deploy (from this repo to the Pi)

```bash
PI=dancalt@mc.local   # or dancalt@10.0.0.51 ; key: ~/.ssh/eddi_dev1
scp -i ~/.ssh/eddi_dev1 backend/*.py "$PI":'~/nfc-player/backend/'
ssh -i ~/.ssh/eddi_dev1 "$PI" 'sudo systemctl restart nfc-backend nfc-reader nfc-frontend'
# systemd units + kiosk autostart in systemd/ and kiosk/ are installed once
# (see DEV1-OG-PROTOTYPE.md). Frontend code change → rebuild on the Pi:
#   ssh "$PI" 'cd ~/nfc-player/frontend && GENERATE_SOURCEMAP=false CI=false npm run build'
```

## Contents

```
backend/nfc_reader.py     PN532 reader; parses NDEF, extracts eddi card id
backend/app.py            Flask backend; resolves eddi cards via the API
backend/serve_build.py    dependency-free static server for frontend/build
kiosk/labwc-autostart     hardened self-healing Chromium kiosk launcher
systemd/nfc-frontend.service   static-serve unit (mirrors what's installed)
```

Secrets (`backend/.env` — Spotify client id / refresh token) are **not** vendored.
