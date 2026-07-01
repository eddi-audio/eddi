# dev2 — Pi Zero 2 W touchscreen NFC player (vendored)

Source of truth for the **dev2** device's on-device software. dev2 hardens the
same stack as [`../dev1`](../dev1) on smaller hardware with a **portrait** screen,
while we wait to build the real eddi device. It reuses the dev1 architecture
(Chromium kiosk → official Spotify **Web Playback SDK** → Flask token broker →
PN532 NFC reader) — see [`../DEV1-OG-PROTOTYPE.md`](../DEV1-OG-PROTOTYPE.md) for
the shared design + recovery notes.

The code here mirrors `/home/dancalt/nfc-player/` on **eddi2**.

## Hardware

| Part | Detail |
|---|---|
| Board | Raspberry Pi **Zero 2 W** (arm64, 512MB) |
| OS | Debian 13 trixie, labwc/Wayland, lightdm autologin `dancalt` |
| Display | Elecrow 5" **800×480** HDMI capacitive touch, run **portrait 480×800** |
| Audio | HDMI → **audio extractor** → analog → powered speakers (HDMI = default sink) |
| NFC | **PN532 over SPI** (SCK/MOSI/MISO + soft-CS on **GPIO25**), same as dev1 |
| Power | powered USB hub feeds the Pi + peripherals |

Access: `ssh -i ~/.ssh/eddi_dev1 dancalt@eddi2.local` (10.0.0.28).

## What's different from dev1

- **Portrait**: `kiosk/labwc-autostart` runs `wlr-randr --output HDMI-A-1
  --transform 90` before Chromium (logical 480×800). Flip to `270` if mounted the
  other way. Touch follows the output transform once a **data** USB cable is in
  (the original cable was charge-only).
- **No amp HAT**: audio is a plain HDMI extractor (line level), so dev1's
  Merus-specific bass-EQ / ALSA ceiling do **not** apply.
- **Own Spotify creds**: dev2 has its **own PKCE refresh token** (no rotation
  contention with dev1). Same eddi.audio Premium account.

## Services (systemd)

| Unit | Role | Port |
|---|---|---|
| `nfc-backend` | `backend/app.py` (venv) — Spotify token broker + Eddi card resolve | :5000 |
| `nfc-frontend` | `backend/serve_build.py` — static-serves `frontend/build/` | :3000 |
| `nfc-reader` | `backend/nfc_reader.py` — PN532 SPI poll + NDEF parse | — |
| `wifi-watchdog.timer` | self-heals "alive but off-network" WiFi drops | — |

`backend/app.py` makes **all** Spotify REST calls (the frontend makes none — that
caused dev1's ~15h 429 lockout). Cards resolve via `EDDI_API_BASE`.

## Deploy (from this repo to eddi2)

```bash
PI=dancalt@eddi2.local   # key: ~/.ssh/eddi_dev1
scp -i ~/.ssh/eddi_dev1 backend/*.py "$PI":'~/nfc-player/backend/'
scp -i ~/.ssh/eddi_dev1 frontend/placeholder.html "$PI":'~/nfc-player/frontend/build/index.html'
scp -i ~/.ssh/eddi_dev1 kiosk/labwc-autostart "$PI":'~/.config/labwc/autostart'
# systemd units (once):
scp -i ~/.ssh/eddi_dev1 systemd/*.service systemd/wifi-watchdog.* "$PI":'/tmp/'
ssh -i ~/.ssh/eddi_dev1 "$PI" 'sudo cp /tmp/nfc-*.service /tmp/wifi-watchdog.* /etc/systemd/system/ \
  && sudo install -m755 /tmp/wifi-watchdog.sh /usr/local/bin/wifi-watchdog.sh \
  && sudo systemctl daemon-reload \
  && sudo systemctl enable --now nfc-backend nfc-frontend nfc-reader wifi-watchdog.timer'
```

## Contents

```
backend/                reused from dev1, unchanged (app.py, nfc_reader.py, serve_build.py)
backend/.env.example    template; real .env (Spotify creds) is NOT vendored
frontend/placeholder.html   480×800 portrait placeholder -> deploy to frontend/build/index.html
kiosk/labwc-autostart   portrait rotation + hardened self-healing Chromium kiosk
systemd/nfc-backend.service / nfc-reader.service   venv-python units (new for dev2)
systemd/nfc-frontend.service                       static-serve unit (from dev1)
systemd/wifi-watchdog.{sh,service,timer}           CONN = netplan-wlan0-Altbach Seattle
```

Secrets (`backend/.env`) are **never** vendored. The Spotify client secret lives
only in AWS SSM; dev2 uses PKCE (client id only, no secret).
