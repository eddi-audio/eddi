# Eddi — Where We Are

_Last updated: 2026-07-01_

Source-of-truth snapshot. The web side (`eddi.audio`) is live; the current push
is the React Native Android app toward production. See `docs/RUNBOOK.md` for how
to build/run and fixes for problems already hit.

## Session log — 2026-07-01 (dev1/mc: hardware whack-a-mole → the real bug was a hardcoded touch port)

A long hardware night on the Pi 5 (`mc`). A card-presence **microswitch** wired to GPIO17 kicked
off a cascade of confusion. What actually happened, in order:

- **"Freezes/outages" = undervoltage brownouts, not switch *logic*.** Nothing in software reads
  GPIO17 (`card_present` is derived from NFC state), so the switch can only hurt *electrically*. The
  supply is marginal (`EXT5V_V ≈ 4.92V`, recurring `hwmon Undervoltage detected!` — one was literally
  the last log line before a hard reset). Same PSU as the stable days prior, so the added wiring
  loaded the rail. **Reminder: BCM GPIO17 = physical pin 11, but physical pin 17 is 3.3V** — a lead on
  a rail + the switch bridging to GND = a short. Wire switches GPIO↔GND only; get "HIGH" from an
  internal pull-up, never a power pin.
- **Reader went down** (`RuntimeError: Failed to detect the PN532`, crash-looping) — an SPI wire
  knocked loose during the switch work. Reseated per the PN532 pinout; reads cards again.
- **Touch "dead" → then "rotated" → root cause was a HARDCODED port.** Panel + cable were fine (raw
  digitizer events flow). The bug: labwc `rc.xml` hardcoded `<touch mapToOutput="HDMI-A-2">` while the
  panel came up on **HDMI-A-1** — so the display rotated (autostart auto-detects the output) but touch
  stayed mapped to a dead port and every tap landed 90° off. **Fixed properly:** `kiosk/labwc-autostart`
  now pins the touch mapping to the *auto-detected* live output + `labwc --reconfigure` — self-heals on
  any port/cable change, no hardcode. rc.xml vendored.
- **Blur + wave restored + deployed.** Both had been left OFF as leftover `DIAG` flags
  (`filter:none`, `animation:none`) from the 06-30 CPU-loop hunt (the real culprit was fixed
  elsewhere). Re-enabled (`blur(34px)`, `pw-scroll 1s`), rebuilt, deployed. Wave ≈18% CPU while
  playing — `steps(15)` knob noted if it runs hot.
- **`device/dev2/` is now committed** (was untracked); rc.xml vendored; RUNBOOK entry + a
  `feedback-no-hardcoded-ports` memory added.

**Verify on device:** tap play (touch aligned?), blur behind the art, wave animating. Power is still
marginal — a proper **5.1V/5A** supply + short cable is the real follow-up.

## Session log — 2026-06-30 (dev2: holistic hardening — the cascade was ONE root cause)

**The whole dev2 "everything's broken" cascade traced to one bug.** A `useInvalidateQueue()`
that returned a fresh function every render (no `useCallback`) made `usePlayback`'s SDK-listener
effect re-run every render → a `getCurrentState → setState → re-render` loop that **pinned a core
at ~90% CPU**. That single loop produced: seconds-late UI (taps registered but the screen couldn't
repaint), the heat (82 °C → throttling/undervoltage flags), and the perceived "touch/volume/screen
not working." Fix = one memoization (`useQueue.js`). After it: **renderer 90%→0% idle, 82→53 °C,
`throttled=0x0`** (was 0xf0008). Verified on a real reboot: comes up **portrait, no white screen,
0% idle** — the whole nightmare gone.

Also landed a holistic hardening pass (Phase 1+2, deployed + verified): heart can't like the prior
card's track during load; like-state honest (`proxy_like` returns Spotify's real status, `useLiked`
restores the prior set on failure); duplicate-liked-playlist race closed; pause-on-removal can't
abort (`safe_json` guards every parse site — no more 500s/dead daemon threads); rAF/timer/promise
cleanup on unmount; kiosk watchdog now `pkill -9` (SIGKILL — SIGTERM can't kill a frozen renderer).

**Other dev2 hardware/kiosk fixes this stretch:** orientation was kanshi targeting the wrong HDMI
output name (`HDMI-A-2` vs the panel's `HDMI-A-1`) → fixed + a boot-race backstop in the autostart;
the card-presence **microswitch** wired to GPIO17 (COM→GND pin9, NC-pair→pin11, card-in=HIGH);
audio is HDMI-only (no USB/I2S) via a bass-EQ filter to the display's HDMI. **Power settled** (Anker
5V/3A + PPS 5–11V/5A; 5V rail 4.96 V — fine); heatsink added.

**Still open:** the `PlayingWave` play-button animation costs ~18% CPU while playing (this Pi's GPU
won't composite the transform — harmless now with the heatsink; `steps()` or static would cut it);
the `∿ like` flow is still blocked on re-minting the device token with playlist scopes; Phase 3 =
splitting the overloaded `usePlayback` (behind tests) is the remaining structural work. Full detail:
`~/.claude/plans/okay-so-we-are-joyful-frost.md`.

## Session log — 2026-06-26 (dev2: player redesign + ∿ "like" flow)

Shipped the **Figma 116:560 player redesign** on the Pi 5 (`192.168.2.2`): blurred
backdrop (faded), **swipe-to-skip album-art carousel** (optimistic), **glassy transport**
(wide play/pause showing **∿ while playing**, the **eddi-heart favorite**, separate
shuffle-toggle + repeat off→one→all). Icons are now **inline SVG components**
(`components/icons.jsx`) — CSS mask failed (the Figma SVGs are 100%-sized, no intrinsic
size). Bottom sheet is now **grip-only when closed** (`.sheet-body` opacity is drag-driven).

Wired the **∿ "like" flow** (heart → "∿ liked on eddi ∿" playlist): backend
`get_or_create_liked_playlist` + `/spotify/like` + `/spotify/liked-uris`; `useLiked` +
favorite button + toast. **⚠️ Blocked on a token re-mint** — the device token lacks
`playlist-modify-*`; `get_refresh_token.py` SCOPES are updated, Daniel must re-run it +
paste the new `SPOTIFY_REFRESH_TOKEN` into the device `.env` + restart `nfc-backend`.

**Open UI action items** (recorded, not done): (1) progress bar doesn't track reliably —
seek works but it then pauses / never starts / sticks ~0:30 (look at `usePlayback` ticker +
the `width 1s` transition); (2) animate the play/pause ∿ as a live sine wave; (3) add a
little snap to the bottom-sheet drag-scroll. **Next build:** card duplication / "add to
others" + NFC **write mode** (registry → new owned playlist → `POST /cards` → write a blank
NTAG215). Full detail in the plan file `~/.claude/plans/okay-so-we-are-joyful-frost.md`.

## Session log — 2026-06-25 (dev2 on the Pi 5: touch scroll, NFC robustness)

**⚠️ Device pivot:** the dev2 portrait player now runs on the **dev1 Pi 5** (`mc`),
repurposed with the **Elecrow 5" touch panel + PN532 + USB speakers (HDMI→aux)**. The
Pi Zero 2 W (`eddi2`) is set aside (too slow to first paint). This session reached the
Pi over **ethernet → the Mac** (macOS Internet Sharing, Pi at `192.168.2.2`; also
`mc.local`/`10.0.0.51` on WiFi). Same `nfc-player` stack + the dev2 Vite UI.

Fixed, all verified on-device:

- **🏆 Touch scroll — root cause was the input layer, not CSS/JS.** The track list
  wouldn't scroll. The panel (`wch.cn USB2IIC_CTP_CONTROL`) is a genuine 5-point
  touchscreen (`ID_INPUT_TOUCHSCREEN=1`, libinput `touch`; the `mouse0` handler is just
  mousedev compat), but **Chromium ran under XWayland**, which delivers touch to X11
  clients as an **emulated mouse** — so taps/drag worked but mouse-drag can't scroll a
  div. Fix: **`--ozone-platform=wayland`** in the kiosk launcher → Chromium is a native
  Wayland client → real multi-touch. Persisted; **survives reboot** via the self-heal
  loop. (See RUNBOOK "kiosk touch scroll".)
- **Queue bottom sheet — rewritten without vaul.** vaul coupled drag+scroll (it
  pointer-captured every touch). Replaced with a hand-rolled sheet: **drag only on the
  grab handle** (pointer events → translateY → snap, with flick momentum), and the list
  is a **self-driven scroller** (`touch-action: none` + pointer-events move `scrollTop`,
  with flick momentum + tap-guard) so it works for touch *and* mouse with zero conflict.
  Bundle dropped 280→218 KB. Drag, tap-to-jump, scroll all confirmed.
- **NFC truncated-id bug** (caused "stuck loading / Card not recognized"): the reader
  sometimes read a partial NDEF → a short eddi id (e.g. `8jp548kq`→`8jp5`) that 404s.
  Fix in `nfc_reader.py`: reject NDEF records shorter than declared, require eddi ids ==
  8 chars (nanoid len 8), and **re-read across polls** (up to ~4 bursts) before giving up
  — a flaky placement self-heals with no re-tap. Plus a frontend **"Card not recognized"**
  state instead of an infinite spinner.
- **Boot-transient self-heal** (`app.py`): a card left in the reader across a reboot is
  read *before* the network is up, so its resolve fails. Now the backend keeps the eddi
  id and a **`_resolve_retry_loop`** retries every 5s until the link returns, then plays —
  no re-tap. Genuine 404s are cached so dead cards don't hammer the API. Verified by
  black-holing the API then restoring it (self-healed in ~5s).

## Session log — 2026-06-22 (dev2: portrait player UI — the Figma build, LIVE)

Built the **dev2 portrait player UI** from the Figma file *Eddi-Audio* (node
`80:861`, pulled live via the Figma Dev Mode MCP) and shipped it to eddi2. **It's
running end-to-end on the device:** tap a card → resolves → plays → the portrait
player shows live album art, title/artist, progress, transport — verified on
screen (Imagine Dragons "Radioactive") and by card tap.

- **Stack:** new **Vite + React** app at `device/dev2/frontend/` (built on the Mac,
  167KB JS / 55KB gz, served from `frontend/build/` by `serve_build.py`). SDK +
  backend wiring ported from dev1's `SpotifyPlayer.js` into a `usePlayer` hook;
  presentation rebuilt to the design. Components: Player, QueueSheet (drag-up
  Current-Card panel + track list + long-press dialog), WaitingState. Brand/icon
  SVGs exported from Figma. Roboto installed on the Pi.
- **Backend:** `app.py` `resolve_eddi_card` + `/nfc/current` now pass through eddi
  data (`tap_count`, `track_count`, `attribution`, `artwork_palette`, …); added
  `/spotify/shuffle` + `/spotify/repeat` broker endpoints.
- **Design note:** the player's left pill is a **shuffle/smart-shuffle** toggle in
  the design, not a Spotify/Tidal "source" badge (built to the design; shuffle is
  wired, smart-shuffle is visual-only — Spotify-proprietary).
- **⚠️ The big lesson (cost us hours):** on the 512MB Zero 2 W, Chromium takes
  **MINUTES to first paint** (cold start swapping under the SDK + Widevine). A
  black/white screen right after boot is **slow, not broken** — it eventually
  paints the full UI. See RUNBOOK. Working render config = **software**
  (`--disable-gpu`). Also fixed the stock **<1GB-RAM dialog** (`--no-memcheck`),
  the **keyring** prompt (`--password-store=basic`), and **stripped the desktop**
  (minimal `/etc/xdg/labwc/autostart`) to free RAM. For production snappiness, a
  **Pi 4** makes first paint seconds, not minutes.
- ⏳ Still to confirm by hand: audio out the speakers + the queue bottom-sheet
  drag (Daniel verifying); touch-driven controls.

## Session log — 2026-06-22 (dev2: baseline + portrait screen stood up)

New **dev2** device — a **Pi Zero 2 W** + Elecrow 5" 800×480 HDMI touchscreen +
HDMI audio extractor → powered speakers — to harden the stack on small hardware
while we wait to build the real eddi (Daniel's dad arrives in a few weeks). It
reuses the dev1 architecture (Chromium kiosk → official Web Playback SDK → Flask
broker → PN532), on `eddi2.local` (10.0.0.28, user `dancalt`, key
`~/.ssh/eddi_dev1`). On-device source vendored at `device/dev2/`.

Baseline stood up and **verified across a cold reboot** (all of this comes up on
boot, no hand-holding):
- **Portrait 480×800** — labwc output `HDMI-A-1` rotated via
  `wlr-randr --transform 90`, persisted in `~/.config/labwc/autostart`. (Flip to
  `270` if the panel is remounted the other way.)
- **Kiosk** — dev1's self-healing Chromium launcher (profile/cache in `/dev/shm`
  = zero SD writes), portrait, auto-launches. Serves a 480×800 placeholder until
  the player UI lands.
- **Services** — `nfc-backend` (:5000), `nfc-frontend` (:3000), `nfc-reader`
  (PN532) all active on boot. New venv-python units for backend/reader.
- **NFC** — PN532 over SPI (soft-CS `D25`), firmware v1.6. End-to-end proven: tap
  `eddi.audio/c/dw9ga5hu` → resolved via Eddi API → `spotify:track:…` (Radioactive).
- **Spotify** — dev2 has its **own PKCE refresh token** (no rotation contention
  with dev1; same eddi.audio Premium account). Token broker returns valid tokens.
  Minter is `device/dev2/backend/get_refresh_token.py` (PKCE, no secret).
- **Audio** — HDMI is the default PipeWire sink; test tone confirmed by ear
  through the extractor → powered speakers. (No amp EQ — that was Merus-HAT
  specific to dev1; dev2 uses a plain line-level extractor.)
- **WiFi** — `99-no-powersave.conf` + ported `wifi-watchdog` (CONN
  `netplan-wlan0-Altbach Seattle`), timer active.

⏳ **Open:** (1) **touchscreen** — the screen's bundled USB is charge-only, so
touch doesn't enumerate (`lsusb` = root hub only); needs a real **data** cable
into the Pi's middle micro-USB (data/OTG) port, then touch-alignment to the
rotation. (2) **Player UI** — the 480×800 portrait React UI is the only remaining
build; Figma designs incoming. Until then the kiosk shows the placeholder and
card taps resolve but have no SDK device to play to ("No target device registered
yet" is expected).

## Session log — 2026-06-20 (dev1: WiFi self-heal + audio tuning)

Two things: dev1 kept **falling off the network** (twice; once mid-playback —
which kills the Spotify SDK stream, so "the player suddenly stopped"). Signal
(−46 dBm) and power (`throttled=0x0`) were fine → driver disassoc / NetworkManager
giving up, not range/power. Hardened so it **self-heals** (all persistent, all
verified):

- **`wifi-watchdog`** (vendored `device/dev1/systemd/`): timer pings the gateway
  every 60s → `nmcli con up` on failure, and **reboots** after ~5 min still-down
  (the systemd HW watchdog only catches CPU freezes, not off-network-but-alive).
- **NM `autoconnect-retries=0`** (infinite) — default gives up after a few tries;
  likely why it used to stay dead after a reboot.
- **Persistent journald** — RPi's `40-rpi-volatile-storage.conf` was wiping logs
  every reboot (so drops were never captured); overridden to `Storage=persistent`.
- Verified: forced `nmcli con down` self-recovered in ~10s; a deliberate reboot
  rejoined WiFi on its own in ~44s (no power-cycle).

**Audio tuned** (fuller bass at a ~25%-lower max, persistent): PipeWire bass-EQ
filter-chain (low-shelf +9dB@120, kick +2dB@80) as default sink → Merus amp at
−14 dB ceiling (`alsactl store`). Config vendored at `device/dev1/audio/bass-eq.conf`.
⏳ Pending: final by-ear confirmation from Daniel (kick clean / loudness right).

## Session log — 2026-06-17/18 (dev1: Spotify playback — the long way round)

Long, painful session. The headline finding that matters most:

> **librespot (and every fork: go-librespot, spotifyd, raspotify) — all
> *unofficial* clients sharing one audio-key path — are refused audio keys on the
> NEW `daniel@eddi.audio` Premium account** (`Service unavailable { audio key
> error }`, identical across librespot 0.6/0.7/0.8). The **official Spotify Web
> Playback SDK works** for the same account. So: **do not use librespot for Eddi
> playback — use the official Web Playback SDK.** (Verified: sound plays from the
> SDK device "Eddi". Likely a Spotify anti-abuse gate on new accounts × unofficial
> clients.)

We first migrated dev1 to **librespot Connect**, chased the audio-key failures for
hours (version downgrades, rate-limit theories — all dead ends), then pivoted to
the official SDK. Current deployed architecture (`device/dev1/`, on the Pi):

- **Browser = official Web Playback SDK** (Chromium → PipeWire → Merus amp). State
  comes from `player_state_changed` push events (no polling); controls are local
  SDK methods. No "Tap to activate" gate (`activateElement()` + kiosk autoplay flag).
- **Frontend makes ZERO direct `api.spotify.com` calls.** It talks only to the SDK
  websocket and our backend (localhost). It registers its SDK device id with the
  backend on 'ready' (`POST /spotify/device`).
- **Backend (`app.py`) is the single Spotify-REST broker:** token, play-on-card-tap
  (targets the EXACT registered SDK device id — never by name), queue, suggestions,
  playlist — all through one 429-safe `spotify_request()` with caching.
- **raspotify/librespot: stopped + disabled** (retired; binary still installed).

Status: ✅ sound plays via the SDK (phone-initiated). ⏳ full card-tap→backend→sound
end-to-end pending — a self-inflicted **Web API 429 lockout** is mid-cooldown
(see below); it clears and then the card path can be verified.

**Code is deployed to the Pi but UNCOMMITTED in the working tree** (`device/dev1/backend/app.py`,
`device/dev1/frontend/src/SpotifyPlayer.js`).

### WiFi — SOLVED (don't "just use ethernet")
dev1 WiFi was dropping hard (24% packet loss, 55 KB/s). Root cause = **brcmfmac
band-steering / firmware roaming** (it sat on the weaker 5GHz AP with roaming on).
Fix, persistent and verified (0.5% loss, 3.75 MB/s): `/etc/modprobe.d/brcmfmac.conf`
= `options brcmfmac roamoff=1 feature_disable=0x82000`, **plus** lock the band:
`nmcli con modify "Altbach Seattle" 802-11-wireless.band bg`. Also **broken IPv6**
on this network was poisoning DNS/connections — disabled via
`/etc/sysctl.d/99-disable-ipv6.conf`. See RUNBOOK.

### Self-inflicted gotchas (now fixed)
- The display-only build polled `/me/player` **every 1s**; over hours it tripped a
  **~15h Web API 429 lockout** (`Retry-After` ≈ 53705s). Fix: SDK pushes state, and
  all REST goes through the backend broker. (Was still decaying as of session end.)
- Repeated `pkill chromium` churn spawned **two kiosk loops → two SDK "Eddi" devices**.
  A reboot collapses to one (labwc autostart launches one loop on boot).
- "Eddi Audio" in the device list is NOT the Pi — it's a laptop signed into the
  same account (Spotify web player). Not a bug.

## TL;DR

- **Android app runs untethered on the Pixel** — prod-signed release APK builds,
  installs, launches, and runs with no Metro/USB. Verified on device.
- **App identity `audio.eddi`** is the Android applicationId / Kotlin package
  (reverse-DNS), **not a domain**. The public domain is `eddi.audio` (live).
- **AWS API is live and the app uses it** — `GET /cards/{id}`, `POST /resolve`,
  `POST /cards`, `POST /cards/{id}/events` all respond correctly.
- **One DNS item open:** `api.eddi.audio` custom domain not set up; app + site use
  the raw API Gateway URL, which works.

## Session log — 2026-06-15

Share-sheet + write-flow night. Shipped + verified on-device:

1. **Eddi is now a share-sheet target** (Spotify/Tidal/YouTube). Approach: a
   manifest `ACTION_SEND`/`text/plain` intent-filter, plus `MainActivity`
   rewriting the `ACTION_SEND` into `ACTION_VIEW` so RN's `Linking` delivers the
   URL — **no new dependency, no native module.** See the "Share-sheet" section.
2. **Shortened the write flow** to resolve → write → done (dropped the name
   input + "Looks good" preview). Tap-to-write graphic is a placeholder for the
   album art for now.
3. **Built + installed the prod-signed release APK** on the Pixel and verified
   end-to-end: shared a **Tidal album** from the share sheet → resolved → wrote.
4. **Logged the follow-up** (album-art-on-resolve → "Writing card…" on NFC
   contact) in the Notion Tasks DB + the action item below.

Commit: `db68d26` on `fix/rn-react-dedupe-and-nfc-write`.

## Session log — 2026-05-30

Big day. In order:

1. **Recovered from a terminal crash** caused by the session temp dir filling
   (not the real disk). Documented the fix in RUNBOOK. This recurred all session;
   the cure is clearing `software/packages/app/android/{app/build,app/.cxx,.gradle,build}`
   + the claude temp caches.
2. **Committed the signing/RN work** that was uncommitted: release signingConfig,
   R8 + shrinkResources, NFC proguard keep rule, monorepo gradle path fixes,
   gradle wrapper 8.13, `com.eddiapp`→`audio.eddi`.
3. **Reorganized the repo** into one consistent structure (see Repo layout).
4. **Moved signing secrets into the project** at gitignored `software/secrets/`
   (keystore + `signing.properties`), out of `~/.gradle` / `~/.eddi-keystore`.
   User has backed these up. `build.gradle` reads them there, debug-fallback if
   absent.
5. **Renamed the app to "Eddi"** (was "EddiApp") and fixed a crash-corrupted
   `MainActivity.kt`.
6. **Fixed the react-native-screens "fragments should never be restored" crash**
   (`MainActivity.onCreate(null)`) — verified via on-device rotation test.
7. **Added the branded launcher icon** — adaptive icon (E mark + `#25243F` navy)
   from `design/eddi_icon_android_full.png`, all densities + anydpi-v26.
8. **Centralized API config** in `software/packages/app/src/config.ts`
   (`API_BASE` + `WEB_ORIGIN`); removed hardcoded URLs from call sites.
9. **Bumped version** to versionCode 2 / versionName 1.0.1.
10. **Confirmed the AWS API** is current and the app pulls from it.
11. **Researched share-sheet integration** (see "Next" / share-sheet plan).

## Android release ✅

- applicationId + namespace `audio.eddi`; JS component still `"EddiApp"`.
- versionCode 2 / versionName 1.0.1.
- Prod keystore + creds in gitignored `software/secrets/` (debug-fallback if
  absent so anyone can still build).
- R8 minify + shrinkResources ON; proguard keep rule for
  `community.revteltech.nfc.**`.
- Adaptive launcher icon, all densities.
- Built APK verified signed with prod cert SHA-256
  `B7:E7:03:8A:ED:E4:4F:AD:35:85:E6:AD:93:D9:95:93:51:F1:23:BB:E0:60:CC:05:EB:7C:F5:22:CF:28:6D:F4`.

Build: `cd software/packages/app/android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (needs `JAVA_HOME` = Android Studio's JDK; see RUNBOOK).

## AWS API ✅

Live at `https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod` (account
733652933079, us-east-1). Routes (CDK `software/packages/backend/lib/eddi-stack.ts`):
`GET /cards/{id}`, `POST /cards`, `POST /resolve`, `POST /cards/{id}/events`,
`GET /og/{id}`. Backend code committed and clean. Spotify + Tidal secrets in SSM
(`/eddi/prod/{spotify,tidal}/*`, SecureString).

**Cross-service resolver LIVE (2026-06-01): Spotify + Tidal.** `POST /resolve`
returns `service_uris` with both `spotify` and `tidal` (track by ISRC, album by
UPC), plus the extracted ISRC/UPC. Deployed + verified on the real API. Next
target resolvers: Apple Music (have account; needs MusicKit .p8), YouTube Music
(ytmusicapi). See the "Cross-Service Resolver" artifact in Notion for detail.

## DNS / domains

- **eddi.audio** — LIVE on Cloudflare Workers (deploy: `cd software && npm run deploy:web`).
- **api.eddi.audio** — ❌ not set up. One-line swap in `config.ts` once it exists.
- AWS account 733652933079, us-east-1.

## iOS — blocked on hardware

Xcode 16+ is Apple-Silicon-only; this is a 2015 Intel Mac (Sequoia via OCLP). iOS
needs an Apple Silicon Mac or a cloud Mac. Android is the production path. See
RUNBOOK.

## Share-sheet (Android) ✅ code-complete — needs on-device verify

Eddi now appears as a target when you Share a link from Spotify/Tidal/YouTube.
Implementation (no new dependency, no native module):
- **Manifest** — added `ACTION_SEND` + `text/plain` intent-filter to MainActivity.
- **MainActivity.kt** — `normalizeShareIntent()` extracts the URL from the shared
  text and rewrites the `ACTION_SEND` intent as `ACTION_VIEW` (cold start in
  `onCreate`, warm start in `onNewIntent` + `setIntent`). This is the trick that
  lets RN's `Linking` deliver it — Linking only surfaces `ACTION_VIEW` URLs.
- **navigation/index.tsx** — `navigationRef` + `Linking.getInitialURL()`
  (onReady) and `'url'` event listener route the URL into `Write`.
- **WriteScreen.tsx** — new `sharedUrl` route param auto-resolves on mount.

**Write flow shortened (same session):** dropped the name-input + "Looks good"
preview step. Now: resolve → straight into the write step (which auto-arms the
NFC write) → success. The tap-to-write graphic stands in for the album art at
the same footprint (placeholder until the real write animation). Success shows
"Card written!" + a small card preview, then auto-returns to Home (popToTop)
after ~2.6s (also a manual "Done"). Removed `display_name` from this flow.
Steps: `paste | write | success` (was `paste | preview | write | success`).
- **VERIFIED ON DEVICE (2026-06-15):** prod-signed release APK built + installed
  on the Pixel; shared a **Tidal album** from the share sheet → Eddi resolved it
  and ran the shortened write flow end-to-end. 🎉
- Note: YouTube links will appear in the sheet but **won't resolve** until the
  backend YT Music resolver lands (Spotify+Tidal resolve today).
- iOS still needs a Share Extension and is hardware-blocked.

### Action item — write-step art/state polish (deferred, no rebuild tonight)
Currently the tap-to-write graphic stands in for the album art the *whole* write
step. Desired:
1. **Show the real album art as soon as the link resolves** (the art is already
   in `resolved.artwork_url` — render it in the write step instead of the
   placeholder graphic).
2. **Only when the card is brought close** (NFC tag detected / write actually
   begins) swap the art for a **"Writing card…"** state.
This needs the NFC hook to surface a "tag detected / write started" signal so the
UI can flip on contact, rather than on entering the step. File:
`software/packages/app/src/screens/WriteScreen.tsx` (+ `hooks/useEddiNfc`).

## Next (when user returns)

- **Write-step art/state polish** (action item above).
- **Write-flow + design redesign** (user is doing this).
- Backup `software/secrets/` — ✅ done by user.
- Google Play listing + AAB upload — when ready to ship.

## Repo layout

One discipline per top-level dir:

- **`software/`** — the npm monorepo (run `npm` here): `packages/` (`app`,
  `web`, `backend`), `infra/` (Cloudflare worker + wrangler), `node_modules/`,
  `package.json`, and gitignored `secrets/`.
- **`device/`** — RPi firmware. **`docs/`** — docs + `architecture.json`.
- **Git-ignored, on disk only:** `business/`, `design/`, `hardware/`, `archive/`.
- Android build artifacts and `cdk.out/` are git-ignored.
