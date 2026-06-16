# dev1 — OG Prototype Device (NOT the production build)

> ⚠️ **This documents the *original* dev prototype ("dev1"), a Raspberry Pi 5
> running the `nfc-player` Python/React stack.** It is a different lineage from
> the product currently under development (`software/packages/app`, React
> Native). Do **not** conflate the two, and do **not** rebuild the new product
> from anything here.
>
> **The on-device source is now vendored in [`dev1/`](dev1/)** (backend, kiosk
> launcher, systemd units) — see [`dev1/README.md`](dev1/README.md) for the
> architecture + deploy steps. This file is the *operational / recovery* notes.
>
> Note: `device/SETUP.md` describes an *aspirational* librespot + setup-server
> design that was **never actually deployed** on dev1. The real running setup is
> below.

## Recent work (2026-06)

- **New-format card support** — the reader now handles `eddi.audio/c/{id}` NDEF
  tags (same format the production app writes) and resolves them via the Eddi
  API; legacy direct-Spotify-URL tags still work. See `dev1/README.md`.
- **Stability hardening** — replaced the `react-scripts` dev server with a static
  build served by a stdlib Python server, moved Chromium's profile/cache to
  `/dev/shm` (tmpfs), made the kiosk self-healing, and enabled the hardware
  watchdog (`RuntimeWatchdogSec`) so a hard freeze auto-reboots.
- **Spotify auth switched to the eddi.audio prod app** (`a80bc…`) under
  **daniel@eddi.audio**, confidential client (refreshes with the secret). The
  device now plays as that account. `app.py` supports both confidential
  (secret) and PKCE (no secret) refresh.
- **Known caveat — WiFi reconnect is flaky on reboot.** It usually associates in
  ~20s but has intermittently failed to rejoin after a reboot (boot-time race
  and/or marginal signal), leaving the box up but off-network. For a demo, use
  **wired ethernet** or add a reconnect-watchdog.
- **Known caveat — power.** The Pi 5 is fed via the amp HAT, not its USB-C PD
  port, so `vcgencmd get_throttled` can't report undervoltage. An 18W supply was
  clearly under-spec (Pi 5 + Class-D amp share the rail); 65W helped but USB-C at
  5V may still be current-limited. Use a supply that delivers a solid **5V/5A**.
- **OPEN — audio skips every 1–3 min.** Ruled out: the bass-EQ PipeWire
  filter-chain, the CPU governor (set to `performance`), and largely power (65W
  didn't fix it; stream position advances smoothly while audio drops). Root cause
  is almost certainly the **Spotify Web Playback SDK running in Chromium on ARM
  Linux** (unsupported; DRM/decode hiccups). **Next step:** play via
  **raspotify/librespot (Spotify Connect)** — already installed, and the
  *intended* design per the Spotify app description — instead of the browser SDK.
  Needs raspotify logged into daniel@eddi.audio + playback re-pointed to it.

## Identity & access

| Thing | Value |
|-------|-------|
| Board | Raspberry Pi 5 Model B Rev 1.0 |
| OS | Debian GNU/Linux 13 (trixie), labwc / Wayland desktop |
| Hostname | `mc` → `mc.local` (NOT `eddi.local`) |
| Last IP | `10.0.0.51` (DHCP) |
| Login user | `dancalt` (password unknown to us — only a hash is on the card) |
| SSH | key-based, no password needed: `ssh -i ~/.ssh/eddi_dev1 dancalt@mc.local` |

The SSH keypair `~/.ssh/eddi_dev1{,.pub}` (on Daniel's Mac) was installed into
`dancalt`'s `authorized_keys` via the headless recovery procedure below.

## What runs on it (the `nfc-player` stack)

App lives at `/home/dancalt/nfc-player/` (its own git repo). Tap an NFC card →
the reader resolves it → the kiosk plays the mapped Spotify content.

| systemd service | What | Port |
|-----------------|------|------|
| `nfc-backend`   | Flask backend `backend/app.py` (venv) — card→URI mapping, Spotify token broker | `:5000` |
| `nfc-frontend`  | `react-scripts start` (`frontend/`) — the kiosk UI + Spotify Web Playback SDK | `:3000` |
| `nfc-reader`    | `backend/nfc_reader.py` — PN532 NFC reader loop | — |
| `raspotify`     | Spotify Connect client (librespot). Independent audio path; device shows as `mc` | — |

**Kiosk launch:** `~/.config/labwc/autostart` waits for `localhost:3000` then
runs `chromium --kiosk … http://localhost:3000`.

**Card mappings:** `backend/card_mappings.json`. Map a new card:
`curl -X POST http://localhost:5000/nfc/map -H 'Content-Type: application/json'
-d '{"card_uid":"…","spotify_uri":"spotify:playlist:…","name":"…","type":"playlist"}'`

## Spotify creds — the messy reality

There are **two** Spotify apps referenced on the device:

- **`37a483…51`** — the app whose `SPOTIFY_REFRESH_TOKEN` is in `backend/.env`.
  Its `SPOTIFY_CLIENT_SECRET` in `.env` is **corrupted (only 4 chars)**, so
  `app.py` cannot refresh, and the cached `SPOTIFY_ACCESS_TOKEN` is **expired**.
  → The **Web Playback SDK path is broken** (frontend gets its token from
  `app.py`'s `/token`, which can only return the dead token).
- **`464aac…05`** — a different app, hardcoded (id + full secret) in
  `backend/get_token.sh` and `backend/get_token.py`, and used by `auth.py`.
  Its secret does **not** match the `37a483` refresh token, so it can't repair
  the `.env` path.

**To durably fix Web-SDK playback** you need the **real client secret for app
`37a483…51`** from <https://developer.spotify.com/dashboard> (it is *not*
anywhere on the device). Then, from the Mac (no Pi keyboard needed — that was
the original blocker, now moot via SSH):

```bash
ssh -i ~/.ssh/eddi_dev1 dancalt@mc.local
cd ~/nfc-player/backend
# edit .env: set the correct SPOTIFY_CLIENT_SECRET (32 hex)
# re-mint a refresh token if needed (get_refresh_token.py serves an auth link),
# then: sudo systemctl restart nfc-backend nfc-frontend
```

If casting via Spotify Connect (`raspotify`) is all that's needed, none of the
above matters — that path is independent of `.env`.

## Headless recovery — how to fix WiFi / get access with NO keyboard

dev1's keyboard is dead (mouse works). The reliable way to reconfigure it is the
**`firstrun.sh` boot-partition hook** — macOS can only write the FAT `bootfs`
partition (not ext4), but a script hooked via `cmdline.txt` runs as root *on the
Pi's own OS* at next boot and can do anything.

1. Put the SD card in the Mac (mounts as `/Volumes/bootfs`).
2. Write `/Volumes/bootfs/firstrun.sh` (logs to `/boot/firmware/firstrun.log`).
   It can: write a NetworkManager keyfile to
   `/etc/NetworkManager/system-connections/` for the current WiFi, install an
   SSH pubkey into `dancalt`'s `authorized_keys`, disable WiFi power-save, etc.
   End it by stripping its own hook out of `cmdline.txt` and exiting 0.
3. Append to the single line in `/Volumes/bootfs/cmdline.txt`:
   `systemd.run=/boot/firmware/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target`
4. Eject, boot the Pi. First boot is minimal (black/text) → runs the script →
   auto-reboots into the normal kiosk, now reconfigured.

**Gotchas learned the hard way:**
- Editing cloud-init's `network-config` on `bootfs` does **nothing** on an
  already-provisioned system — cloud-init only reads it on first boot; the live
  net config is NetworkManager keyfiles on ext4. Use the `firstrun.sh` hook.
- **WiFi power-save was the "drops off the network" cause.** Fix is permanent:
  `/etc/NetworkManager/conf.d/99-no-powersave.conf` → `[connection]\nwifi.powersave = 2`
  (verified `power_save: off`).
- WiFi network is `Altbach Seattle` (2.4/5GHz). Passphrase was recoverable from
  the Mac's Keychain when the Mac was on the same network.
