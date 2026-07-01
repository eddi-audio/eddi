# Eddi Runbook

How to build, deploy, and run things — plus a catalog of problems we've already
hit and how we fixed them. **Check the Troubleshooting section before
re-debugging anything that feels familiar.**

For current project state see [STATUS.md](STATUS.md). For local credentials see
`SETUP.md` (repo root, gitignored).

> **All software lives under `software/`.** Paths below are from the repo root;
> the npm workspace root is `software/`. From there, `npm run deploy:web` and
> `npm run deploy:backend` are shortcuts for the web/backend deploys.

---

## Common operations

### Web (`software/packages/web`)
```bash
cd software/packages/web
npm run dev          # local dev server
npm run build        # production build (reads VITE_API_URL from .env.local)
```
Deploy the site (Cloudflare Workers + Assets) — config lives in `software/infra/`:
```bash
cd software && npm run deploy:web        # builds web, then wrangler deploy from infra/
```

### Backend (`software/packages/backend`, AWS CDK)
SSO creds don't flow through `--profile` for CDK, so export them first:
```bash
aws sso login --profile eddi
eval $(aws configure export-credentials --profile eddi --format env)
cd software/packages/backend
npm run diff         # cdk diff
npm run deploy       # cdk deploy --require-approval never
```
- Account `733652933079`, region `us-east-1`.
- Spotify secret lives in SSM: `/eddi/prod/spotify/client_id`, `/eddi/prod/spotify/client_secret`.

### Android app (`software/packages/app`)
Debug build / run on device:
```bash
cd software/packages/app/android
./gradlew :app:installDebug
```
Production-signed release APK (arm64 = the Pixel 8a alpha device):
```bash
cd software/packages/app/android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# output: app/build/outputs/apk/release/app-release.apk
```
For Google Play, build an AAB instead (`:app:bundleRelease`) and don't restrict
architectures.

**Verify an APK is signed with the prod cert (not the debug fallback):**
```bash
APKSIGNER=$(ls $HOME/Library/Android/SDK/build-tools/*/apksigner | tail -1)
"$APKSIGNER" verify --print-certs path/to/app-release.apk | grep -i SHA-256
# expect: B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4
```
Signing is wired in `software/packages/app/android/app/build.gradle`: it reads
`EDDI_RELEASE_*` from `~/.gradle/gradle.properties` and **falls back to debug
signing if those props are absent** — so the repo builds for anyone, but only a
machine with the secret produces a Play-uploadable build.

> ⚠️ **Back up `~/.eddi-keystore/eddi-release.jks` + its password** (password
> manager + offsite). Lose them and the published app can never be updated again.

---

## Troubleshooting — problems we've already solved

### 🔴 Session/terminal "crashes", garbled or duplicated command output, processes killed
**Symptom:** Commands return mangled output (repeated lines), get SIGKILL'd, or
the terminal dies. May see `ENOSPC` / "temp filesystem ... is full (0MB free)".

**Cause:** NOT the main disk (check `df -h /` — we have hundreds of GB free).
It's the assistant session's **temp dir** (`/private/tmp/claude-502/...`) hitting
a small per-session quota. Android build artifacts (`app/build` ~520MB,
`.cxx` ~400MB) plus tool caches overflow it.

**Fix:**
```bash
# Delete regenerable Android build artifacts (always safe — they rebuild):
rm -rf software/packages/app/android/app/build software/packages/app/android/app/.cxx \
       software/packages/app/android/.gradle software/packages/app/android/build
# Clear assistant tool caches if still tight:
rm -rf /private/tmp/claude-502/node-compile-cache \
       /private/tmp/claude-502/v8-compile-cache-502 \
       /private/tmp/claude-502/metro-cache
df -h /private/tmp   # confirm space recovered
```
**Prevent:** these dirs are now git-ignored. If it keeps happening, set
`CLAUDE_CODE_TMPDIR` to a roomier path.

### 🔴 Source file corrupted with a line repeated thousands of times
**Symptom:** a source file (seen once on `MainActivity.kt`) has a single line —
e.g. `import com.facebook.react.ReactActivityDelegate` — duplicated thousands of
times, ballooning it to ~17000 lines. Won't compile. Caused by an editor/process
killed mid-write during the full-disk crash above.

**Detect** (scan tracked source for any non-blank line repeating >15×):
```bash
for f in $(git ls-files '*.kt' '*.ts' '*.tsx' '*.js'); do
  top=$(grep '[^[:space:]]' "$f" | sort | uniq -c | sort -rn | head -1 | awk '{print $1}')
  [ "${top:-0}" -gt 15 ] && echo "⚠️ $f line repeats ${top}x"
done
```
**Fix:** restore the clean version from the last good commit, e.g.
`git show <good-commit>:<path> > <path>` then re-apply any intended edits.
`MainActivity.kt` was recovered from `47ad079` in commit `4f9c200`.

### 🔴 RN app: "Incompatible React versions" / "Invalid hook call" / "useEffect of null"
**Cause:** `react`/`react-dom` not pinned to the EXACT version React Native was
built against (currently **19.2.3** for RN 0.85.3). A caret that floats, or a
mismatched copy in another workspace, produces a duplicate/incompatible React.

**Fix:** Pin `react` + `react-dom` to the exact version in `packages/app`,
`packages/web`, AND the root `overrides` block together. Then **clean install**
(`overrides` only applies on a fresh install):
```bash
rm -rf node_modules package-lock.json && npm install
# verify: exactly one react under node_modules, no nested copies
find node_modules packages/*/node_modules -path '*/react/package.json' 2>/dev/null
```
Fixed in commit `47ad079`.

### 🔴 Android Gradle can't find react-native / Codegen / Hermes compiler
**Cause:** This is a monorepo with `node_modules` hoisted to the repo root, but
the RN gradle scaffold assumes `node_modules` is one level up from `android/`.

**Fix (already applied):** `software/packages/app/android/app/build.gradle` sets `root`,
`reactNativeDir`, `codegenDir`, `cliFile`, and `hermesCommand` to
`../../../../node_modules/...`, and `settings.gradle` points the gradle-plugin
`includeBuild` at `../../../node_modules/...`. Also the gradle wrapper is pinned
to **8.13** (the scaffold's 9.3.1 was incompatible with the RN 0.85 plugin).
Fixed in commit `75543a5`.

### 🔴 Release APK crashes / NFC stops working only in release builds
**Cause:** R8 minification strips `react-native-nfc-manager`'s native classes
(it ships no consumer proguard rules).

**Fix (already applied):** keep rule in `software/packages/app/android/app/proguard-rules.pro`:
```
-keep class community.revteltech.nfc.** { *; }
```

### 🔴 NFC write fails on a blank tag
**Cause / fix:** handled in commit `47ad079` (blank-tag write path). If
revisiting, that commit is the reference.

### 🟡 Spotify "editorial" playlists return 404
e.g. "Today's Top Hits". Under client-credentials auth, only user/public
playlists and albums/tracks resolve. Known limitation, not a bug.

### 🟡 CDK deploy fails with credentials error despite `--profile eddi`
SSO creds don't propagate through the `--profile` flag in CDK. Run
`eval $(aws configure export-credentials --profile eddi --format env)` first.

### 🔴 dev1 WiFi drops hard (high packet loss / SSH drops / streaming starves)
Pi 5 `brcmfmac` band-steering: it roams onto the weaker 5GHz AP with firmware
roaming on. NOT power (PMIC showed 4.98V), NOT a driver crash (clean dmesg).
Fix (persistent, took 24%→0.5% loss): `/etc/modprobe.d/brcmfmac.conf` →
`options brcmfmac roamoff=1 feature_disable=0x82000`, **plus** lock the band:
`sudo nmcli con modify "Altbach Seattle" 802-11-wireless.band bg`. Reboot to
apply (a live `rmmod brcmfmac` can lock you out of the keyboard-less box).

### 🟢 dev1 still drops off-network sometimes — now self-heals (2026-06-20)
Despite the brcmfmac/band-lock fix above, the box **still intermittently falls
off the network** (twice on 2026-06-20, once mid-playback — kills the Spotify SDK
stream). Signal was strong (−46 dBm) and power clean (`throttled=0x0`), so it's a
driver disassoc / NetworkManager giving up, NOT range/power. The systemd HW
watchdog (`RuntimeWatchdogSec`) only catches CPU freezes, not "alive but
off-network," so it used to need a hand power-cycle. Now hardened, all persistent:
- **`wifi-watchdog`** (`/usr/local/sbin/wifi-watchdog.sh` + `.service`/`.timer`,
  vendored in `device/dev1/systemd/`): every 60s pings the gateway; on failure
  re-runs `nmcli con up`, and after ~5 min still-down it **reboots** (the only
  cure for a wedged radio). Logs to `/var/log/wifi-watchdog.log` + journal
  (`journalctl -t wifi-watchdog`).
- **NM `autoconnect-retries = 0`** (infinite) on "Altbach Seattle" — the default
  gives up after a few tries (likely why it stayed dead after a reboot).
- **Persistent journald**: RPi ships
  `/usr/lib/systemd/journald.conf.d/40-rpi-volatile-storage.conf` (volatile, for
  SD wear) → logs were wiped every reboot, so drops were never captured. Override
  with `/etc/systemd/journald.conf.d/99-eddi-persistent.conf` (`Storage=persistent`).
Verified: a forced `nmcli con down` self-recovered in ~10s; a deliberate reboot
rejoined WiFi on its own in ~44s (no power-cycle).

### 🔴 dev1: this network's IPv6 is broken (poisons DNS + Spotify connects)
DNS returns IPv6-only addrs the Pi can't route → `apresolve`/key fetches time
out. Disable IPv6: `/etc/sysctl.d/99-disable-ipv6.conf` with
`net.ipv6.conf.{all,default,wlan0}.disable_ipv6 = 1`.

### 🔴 dev1 Spotify: librespot/raspotify won't play (`audio key error`)
librespot (& all unofficial forks) are **refused audio keys on the new
`daniel@eddi.audio` account** — all versions, not a sink/rate-limit/version bug.
**Use the official Web Playback SDK** (browser) instead; it plays fine. Full
detail in the `project-dev1-audio` memory + STATUS 2026-06-17/18 log.

### 🔴 dev1: Spotify Web API 429 with a HUGE `Retry-After` (hours)
The eddi.audio app is in Dev Mode (low quota). A frequent poll (e.g. the kiosk's
old 1s `/me/player`) trips a multi-hour lockout. No manual reset — the
`Retry-After` header counts down on its own. Fix the polling: the frontend must
make ZERO direct Spotify REST calls; route everything through the backend broker.

### 🟢 dev2: portrait (480×800) on labwc/Wayland
The Elecrow panel is native 800×480 landscape. Rotate the **live compositor
output** — don't touch `cmdline.txt`:
`wlr-randr --output HDMI-A-1 --transform 90` (90 = clockwise; use `270` to flip).
Persist it by putting that line at the top of `~/.config/labwc/autostart`, before
the Chromium launch. Over SSH, `wlr-randr` needs `XDG_RUNTIME_DIR=/run/user/1000
WAYLAND_DISPLAY=wayland-0`. After a reboot the GUI session takes ~30–60s to come
up — verify portrait/kiosk at ≥1 min uptime, not at 0 min (the Wayland socket
isn't ready yet and `wlr-randr` returns nothing).

### 🔴 dev2: touchscreen doesn't enumerate (`lsusb` shows only the root hub)
The USB bundled with the screen is often **charge-only** (no data wires) — touch
never appears as an input device. Use a real **data** cable, and on a Pi Zero 2 W
plug it into the **middle micro-USB labeled `USB`** (data/OTG), not `PWR IN`.
Host mode must be on: `dtoverlay=dwc2,dr_mode=host` in `config.txt` (already set
on eddi2). Once connected, the panel shows in `lsusb` + `/proc/bus/input/devices`;
touch then follows the output transform under labwc/libinput (add a
`LIBINPUT_CALIBRATION_MATRIX` only if taps are mirrored).

### 🔴 dev2: PKCE token minter fails `CERTIFICATE_VERIFY_FAILED` on macOS
Homebrew Python ships without a CA bundle on openssl's default path, so the
token-exchange POST to `accounts.spotify.com` fails (the browser auth itself
succeeds first — and that code is single-use, so you must re-run the whole flow).
Fix: build the SSL context with a real bundle —
`ssl.create_default_context()` then `.load_verify_locations("/etc/ssl/cert.pem")`
— and pass it to `urlopen(..., context=ctx)`. Already baked into
`device/dev2/backend/get_refresh_token.py`.

### 🟢 dev2: Chromium kiosk shows a BLACK/WHITE screen for MINUTES after boot — wait it out
On the **512MB Zero 2 W**, Chromium's cold start (React bundle + Spotify Web
Playback SDK + Widevine CDM) is *brutally* slow under memory pressure (zram
swapping hard) — it can take **several minutes**, sometimes much longer, to first
paint. During that window the kiosk surface is a **solid black** (GPU path) or
**solid white** (software path), and a `grim` capture looks like a dead render.
**This is NOT a failure — it eventually paints the full UI.** Do not chase it with
GPU/GL flag tinkering (we burned hours doing exactly that). To tell "slow" from
"broken": the labwc desktop renders instantly and the app renders fine headless on
a dev machine, so the compositor + app are fine — it's just Chromium being slow on
this board. Config that works on eddi2: **software rendering** (`--disable-gpu
--disable-gpu-compositing` in `kiosk/labwc-autostart`; `--enable-gpu-rasterization`
commented out in `/etc/chromium.d/default-flags`). For production snappiness, use a
**Pi 4** — first paint there is seconds, not minutes.

### 🟡 dev2: kiosk won't auto-start / blocked by a dialog (low-RAM + keyring)
Two stock dialogs block the kiosk on a fresh 512MB board, both fixed in
`kiosk/labwc-autostart`: the **"<1GB RAM, Launch anyway?"** dialog (the
`/usr/bin/chromium` wrapper pops it when `MemTotal ≤ 512MB`) → pass the wrapper
flag **`--no-memcheck`**; and the **GNOME keyring unlock** prompt (autologin leaves
the login keyring locked, Chromium hits the Secret Service) → pass
**`--password-store=basic`** so Chromium never touches the keyring. Also strip the
desktop on this RAM-starved board: replace `/etc/xdg/labwc/autostart` with a
minimal one (no `wf-panel-pi`, `pcmanfm`, or `lxsession-xdg-autostart`) so the
panel/file-manager/gvfs stack doesn't eat the RAM the kiosk needs.

### 🟢 kiosk: the page/list won't TOUCH-SCROLL (taps & drag work, scroll doesn't)
The touch panel works for taps and hand-rolled drags but a normal `overflow:auto`
list won't scroll. Root cause is **not CSS** — it's that **Chromium is running under
XWayland**, which delivers touch to X11 clients as an **emulated mouse**, and
mouse-drag can't scroll a div. Confirm: `pgrep -a Xwayland` (present) and the kiosk
`chromium` cmdline has **no** `--ozone-platform=wayland`. Also verify the panel really
is a touchscreen (it is): `udevadm info --query=property --name=/dev/input/eventN | grep
ID_INPUT_TOUCHSCREEN` and `libinput list-devices` (Capabilities: `touch`). The
`Handlers=mouse0 eventN` in `/proc/bus/input/devices` is just mousedev compat — not a
real mouse. **Fix:** add **`--ozone-platform=wayland`** to the kiosk `chromium`
invocation (`~/.config/labwc/autostart`, vendored in `kiosk/labwc-autostart`) → native
Wayland client → real multi-touch + native scroll. (We *also* drive the queue list's
scroll ourselves via pointer events + `touch-action: none`, so it works under mouse too.)

### 🔴 kiosk: touch works but every tap lands ROTATED / offset from the UI (dev1 Pi 5)
The digitizer is fine — raw events flow (`sudo evtest /dev/input/eventN`, or `od -An -tx1
/dev/input/eventN` shows `ABS_MT_POSITION_*` + `BTN_TOUCH` on tap) and `libinput list-devices`
shows `Capabilities: touch` — but taps hit the wrong place because the **touch device isn't mapped
to the rotated output**. Root cause we hit **2026-07-01:** labwc `rc.xml` had a **hardcoded**
`<touch … mapToOutput="HDMI-A-2">` while the panel had actually come up on **HDMI-A-1** (the Pi 5's
two micro-HDMI jacks enumerate as HDMI-A-1 / HDMI-A-2 — a moved cable flips them). The *display*
still rotated (the autostart auto-detects the output for `wlr-randr --transform 90`), so it **looked
perfect while touch was mapped to a dead port** and never inherited the 90° transform — every tap
90° off. Confirm the mismatch: `wlr-randr | grep -i enabled -B2` (which output is live) vs
`grep mapToOutput ~/.config/labwc/rc.xml`.
**Fix (permanent, self-healing — no hardcoded port):** `kiosk/labwc-autostart` now detects the live
output (`wlr-randr | grep -oE '^HDMI-A-[0-9]+'`) and, alongside the transform, patches `rc.xml`'s
`mapToOutput` to that output + `labwc --reconfigure`. Manual one-off:
```bash
out=$(wlr-randr | grep -oE '^HDMI-A-[0-9]+' | head -1)
sed -i "s|mapToOutput=\"HDMI-A-[0-9]*\"|mapToOutput=\"$out\"|" ~/.config/labwc/rc.xml
labwc --reconfigure          # if that doesn't re-map at runtime, a reboot re-runs the autostart
```
If taps come out **mirrored** rather than rotated, add a `LIBINPUT_CALIBRATION_MATRIX`. **Lesson:
never hardcode a volatile port/device name next to code that already auto-detects it.**

### 🔴 NFC: card sticks on "loading"/"Card not recognized" intermittently
The PN532 occasionally returns a **truncated NDEF read**, so an 8-char eddi id comes
back short (e.g. `8jp548kq`→`8jp5`); the short id 404s on the Eddi API → no playable
URI → the UI hangs. **Fixed in `backend/nfc_reader.py`:** reject NDEF records shorter
than their declared length, require eddi ids to be **exactly 8 chars** (the API's
`nanoid` length — same guard the legacy Spotify path already had), and **re-read across
polls** (up to ~4 bursts) while the card is still present before giving up. The frontend
also shows an explicit **"Card not recognized — lift it and tap again"** state instead of
an endless spinner. To check what id was read: `journalctl -u nfc-reader | grep "Eddi card id"`.

### 🟢 NFC: a card left in the reader at boot shows "Card not recognized"
A card present when the device powers on is read **before the network is up**, so its
Eddi resolve fails and it sticks (the reader won't re-notify an already-present card).
**Fixed in `backend/app.py`:** the backend keeps the unresolved card's id and a
**`_resolve_retry_loop`** retries every 5s until connectivity returns, then plays it — no
re-tap. Genuine 404s are cached so dead cards stop hitting the API. (Watch:
`journalctl -u nfc-backend | grep resolve-retry`.)

---

## Open / not-yet-done

See the "Open / not done" section in [STATUS.md](STATUS.md). Highlights:
- `api.eddi.audio` custom domain (currently using the raw API Gateway URL).
- App launch/runtime not yet verified on a physical device.
- `/write` NFC flow untested on real hardware.
