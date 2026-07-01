# Dev Devices — Touchscreen NFC Player Setup & Quirks

> The two **bench/dev rigs** that run the `nfc-player` stack on a touchscreen:
> **dev1** (Pi 5) and **dev2** (Pi Zero 2 W). These exist to harden the player
> stack and audio path on real hardware while we build toward the product. They
> are **not** the shipping product (Zero 2W + Waveshare 1.47" + I2S DAC — see the
> Eddi BOM) and they are a **different lineage** from the React-Native app
> (`software/packages/app`). Don't rebuild the product from these.
>
> Per-device deep dives: [`dev1/README.md`](dev1/README.md),
> [`dev2/README.md`](dev2/README.md), and the dev1 recovery notes in
> [`DEV1-OG-PROTOTYPE.md`](DEV1-OG-PROTOTYPE.md).

## What they share — the stack

Both devices run the **same** software stack (dev2's backend is dev1's, unchanged):

```
NFC tap (PN532/SPI) ─► nfc_reader.py ─► app.py (Flask :5000)
                                           │  token broker + card resolve
Chromium kiosk ──► serve_build.py (:3000) ─┘  (all Spotify REST server-side)
   │  web player (Spotify Web Playback SDK)
   └─► PipeWire (bass-EQ filter-chain) ─► audio out
```

| Piece | Role |
|---|---|
| `backend/app.py` (`nfc-backend`, :5000) | Flask **token broker** + Eddi card resolver. **Every** Spotify REST call goes through here (the frontend makes none). |
| `backend/serve_build.py` (`nfc-frontend`, :3000) | Dependency-free Python static server for `frontend/build/`, SPA fallback, `Cache-Control: no-store`. Replaced the CPU-/SD-hungry `react-scripts` dev server. |
| `backend/nfc_reader.py` (`nfc-reader`) | PN532 over SPI (soft-CS on **GPIO25**), parses NDEF, POSTs card id to `app.py`. |
| `kiosk/labwc-autostart` | labwc autostart → waits for `:3000` → launches Chromium kiosk, **profile/cache in `/dev/shm`** (zero SD writes), self-heals on crash. |
| `systemd/wifi-watchdog.{sh,service,timer}` | Pings the gateway every 60s; `nmcli con up` on drop, reboot if wedged. Fixes "alive but off-network" brcmfmac disassociations. |

**Why all Spotify calls are server-side:** dev1's frontend once made direct
Spotify REST calls and earned a **~15h 429 lockout**. `app.py` now bottlenecks
them with a single in-memory token refreshed on a ~55-min cadence (rapid
refreshes were revoking each other).

**Creds:** each device has its **own** `backend/.env` (never vendored; secret is
in AWS SSM). dev1 uses the eddi.audio **prod app** (confidential, client secret);
dev2 has its **own PKCE** app/token (no secret) so the two don't contend on token
rotation. Both stream the same eddi.audio Premium account (only one can play at a
time — Spotify single-stream limit).

**Access:** `ssh -i ~/.ssh/eddi_dev1 dancalt@<host>` — dev1 `mc.local`, dev2 `eddi2.local`.

## Per-device hardware

| | **dev1** | **dev2** |
|---|---|---|
| Board | Raspberry **Pi 5** | Raspberry Pi **Zero 2 W** (512MB) |
| Host | `mc.local` (10.0.0.51) | `eddi2.local` (10.0.0.28) |
| Display | Mediatrix **MPI5001** 800×480 HDMI touch | Elecrow 5" 800×480 HDMI touch |
| Orientation | landscape 800×480 *(portrait planned w/ new UI)* | **portrait 480×800** (`wlr-randr --transform 90`) |
| Audio out | HDMI → **monitor's 3.5mm jack** → USB-powered speakers | HDMI → **audio extractor** → USB-powered speakers |
| Amp | **none** (Merus HAT removed 2026-06-23) | none |
| Power | **USB-C 5V/5A direct** | powered USB hub |
| NFC | PN532 / SPI (GPIO25 CS) | PN532 / SPI (GPIO25 CS) |
| Frontend | old single-component `SpotifyPlayer.js` *(new Vite+React UI pending)* | **new Vite+React** player UI (Figma `80:861`), 480×800 |

## Hardware quirks (the part worth remembering)

### dev1 — Pi 5 audio after the amp strip-down (2026-06-23)
- **The amp HAT used to power the Pi** through itself, which blinded
  `vcgencmd get_throttled` to undervoltage. With the HAT removed and a **USB-C
  5V/5A** feed, power sensing works again. (We see `throttled=0x50000` = a past
  UV/throttle event, nothing *current* — keep an eye on the supply; if it recurs
  it's genuinely under-spec.)
- **The monitor lies about audio.** The MPI5001's EDID advertises **no audio**
  (no ELD), so by spec there should be no HDMI sound — but it physically
  **decodes HDMI audio out its 3.5mm jack** (verified by tone). WirePlumber still
  builds the `Digital Stereo (HDMI)` sink and it just works. So we need **no USB
  DAC and no HDMI extractor** — audio rides HDMI to the monitor jack to the USB
  speakers.
- **⚠️ The monitor must be POWERED ON when the Pi boots.** PipeWire/WirePlumber
  only creates the HDMI sink if a display is present at session start. Cold-boot
  with the monitor on → sink + EQ + link all auto-restore (verified). Monitor off
  at boot → **no sink** until you `systemctl --user restart pipewire wireplumber
  pipewire-pulse` after powering it on.
- **HDMI sink name is per-board.** dev1's is
  `alsa_output.platform-107c706400.hdmi.hdmi-stereo`; dev2's is
  `…platform-3f902000…`. The bass-EQ's `target.object` must point at the local
  board's sink — never copy dev2's string.
- **Audio path:** Chromium → `effect_input.bass_eq` (default sink) → EQ filter
  chain → `effect_output.bass_eq` (passive, `target.object`-pinned) → HDMI sink.
  Config: `~/.config/pipewire/filter-chain.conf.d/bass-eq.conf`, vendored at
  [`dev1/audio/bass-eq.conf`](dev1/audio/bass-eq.conf). The old Merus `−14 dB`
  ALSA ceiling is gone with the HAT; loudness is now the speaker's own knob.
- **Find the sink / re-pin (recovery):**
  ```bash
  export XDG_RUNTIME_DIR=/run/user/$(id -u)
  wpctl status                      # look for "Digital Stereo (HDMI)" under Sinks
  pw-link -l | grep -i hdmi         # confirm effect_output.bass_eq -> ...hdmi...
  # if the sink is missing, the monitor was off at boot:
  systemctl --user restart pipewire wireplumber pipewire-pulse
  ```

### dev2 — Pi Zero 2 W
- **512MB = brutally slow first paint.** Chromium cold-start (React bundle +
  Web Playback SDK + Widevine) can take **minutes** under memory pressure; a
  black/white screen right after boot is **slow, not broken**. Use **software
  render** (`--disable-gpu`), plus `--no-memcheck` (stock <1GB-RAM dialog) and
  `--password-store=basic` (keyring prompt). A **Pi 4** makes first paint seconds.
- **Audio** uses a plain HDMI **audio extractor** (line level), so dev1's
  monitor-jack trick and the Merus tuning don't apply.
- **Portrait** via `wlr-randr --output HDMI-A-1 --transform 90` (flip to `270` if
  mounted the other way); touch follows the transform once a **data** (not
  charge-only) USB cable is in.

### Both
- **WiFi** (brcmfmac) intermittently disassociates and goes "alive but
  off-network" — the `wifi-watchdog` timer self-heals it; persistent journald
  captures the cause. Wired ethernet is the bulletproof fallback.
- HDMI on the Pi 5 is **micro-HDMI** — easy to under-seat. If the kernel shows
  `disconnected` / 0-byte EDID on both ports (`/sys/class/drm/card*-HDMI-A-*/status`),
  it's physical: reseat (use HDMI0 nearest USB-C), confirm the monitor is **on**
  and on the right input, try another cable.
- **Touch must map to the LIVE HDMI output** (portrait rigs). The two micro-HDMI jacks
  enumerate as `HDMI-A-1` / `HDMI-A-2` and a moved cable flips them. `kiosk/labwc-autostart`
  auto-detects the live output and pins **both** the `wlr-randr --transform 90` **and** the labwc
  `<touch mapToOutput>` to it — **never hardcode a port.** A stale `mapToOutput` rotates the display
  fine but sends every tap ~90° off (looks perfect, feels dead). See RUNBOOK "touch works but every
  tap lands ROTATED".

## Deploy (repo → device)

```bash
# dev1 (mc.local) — frontend is currently built ON the Pi:
PI=dancalt@mc.local                                   # key: ~/.ssh/eddi_dev1
scp -i ~/.ssh/eddi_dev1 dev1/backend/*.py "$PI":'~/nfc-player/backend/'
scp -i ~/.ssh/eddi_dev1 dev1/audio/bass-eq.conf "$PI":'~/.config/pipewire/filter-chain.conf.d/'
ssh -i ~/.ssh/eddi_dev1 "$PI" 'sudo systemctl restart nfc-backend nfc-reader nfc-frontend'

# dev2 (eddi2.local) — Vite UI built on the Mac, bundle copied over:
cd dev2/frontend && npm run build
PI=dancalt@eddi2.local
scp -i ~/.ssh/eddi_dev1 build/* "$PI":'~/nfc-player/frontend/build/'
ssh -i ~/.ssh/eddi_dev1 "$PI" 'sudo systemctl restart nfc-frontend'
```

> Planned (Phase B): bring dev1's frontend up to dev2's new portrait UI (same
> 800×480 panel → rotate to 480×800). Tracked separately; audio strip-down is done.
