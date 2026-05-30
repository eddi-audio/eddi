# Eddi Companion App — Integration Research

_Last updated: 2026-05-29_

---

## 1. App Tech Stack Options

### React Native

**Pros for Eddi:**
- Single codebase for iOS + Android.
- NFC is well-supported via `react-native-nfc-manager` (actively maintained, covers NDEF read/write on both platforms).
- The existing web codebase is already React + TypeScript; the write-flow logic (`WritePage.tsx`, `cards.ts` API client) ports almost directly — the same `resolveUrl` / `createCard` / `ndef.write` pattern translates to native NFC calls with minimal change.
- Strong ecosystem for Bluetooth (`react-native-ble-plx`) and local HTTP (`fetch` works natively).
- Expo managed workflow removes most native toolchain friction for an early-stage product.

**Cons:**
- Performance ceiling is lower than native for anything UI-intensive (not a concern here).
- NFC background scanning (auto-launch app when a tag is tapped without opening the app first) is native-only on iOS — React Native can intercept NFC intent on Android but iOS CoreNFC background scanning requires a native entitlement and foreground session.
- BLE peripheral mode (making the app act as a BLE accessory, not needed here) is limited.

### Flutter

**Pros:**
- Single codebase, good `nfc_manager` plugin.
- Excellent UI performance.

**Cons:**
- No shared code with the existing TypeScript/React stack. The team (currently one person) would context-switch between Dart and TS. The API client, types, and write-flow logic must be rewritten from scratch.
- The `nfc_manager` plugin is less battle-tested than `react-native-nfc-manager` for NDEF multi-record writes.
- BLE support via `flutter_blue_plus` is solid but the ecosystem is smaller.

### Native Swift (iOS) + Kotlin (Android)

**Pros:**
- Full platform fidelity; NFC background launch entitlement on iOS is straightforward.
- Best Bluetooth/WiFi integration.
- CoreNFC on iOS and Android NfcAdapter give direct control over NDEF record ordering.

**Cons:**
- Two codebases, two review cycles. At Eddi's current stage this doubles the maintenance surface for what is essentially a thin API wrapper + NFC I/O layer.

### Recommendation

**React Native with Expo** is the right call for now. The existing write-flow maps directly, `react-native-nfc-manager` covers all required NDEF operations, and the API client (`packages/web/src/api/cards.ts`) is a copy-paste port. Native Swift/Kotlin can be revisited when hardware Bluetooth control demands tighter OS integration, but that can be added incrementally via an Expo dev client + native module rather than a full rewrite.

---

## 2. NFC Reading in the App

### Current card format (NDEF, up to 5 records)

| Record index | Content | Example |
|---|---|---|
| 0 | Eddi card page URL | `https://eddi.audio/c/ab3x7k9p` |
| 1 | Spotify HTTPS URL | `https://open.spotify.com/album/5Z9iiGl2FcIfa3BMiv6OIw` |
| 2 (future) | Apple Music HTTPS URL | `https://music.apple.com/us/album/...` |
| 3 (future) | Tidal HTTPS URL | `https://tidal.com/browse/album/...` |
| 4 (future) | YouTube Music HTTPS URL | `https://music.youtube.com/browse/...` |

### Reading with `react-native-nfc-manager`

```ts
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager'

async function readEddiCard(): Promise<string[]> {
  await NfcManager.requestTechnology(NfcTech.Ndef)
  const tag = await NfcManager.getTag()
  await NfcManager.cancelTechnologyRequest()

  return (tag?.ndefMessage ?? [])
    .filter(r => r.tnf === Ndef.TNF_WELL_KNOWN && String.fromCharCode(...r.type) === 'U')
    .map(r => Ndef.uri.decodePayload(r.payload))
}
```

### Decision logic after reading

```
records = readEddiCard()
record[0] always = "https://eddi.audio/c/{id}"   → parse cardId from URL
record[1..n] = streaming service URLs

1. Look up user's preferred service (AsyncStorage key "eddi_service_pref")
2. Find the matching record for that service
3. If found → deep-link directly (see section 3)
4. If not found → fetch card from API (GET /cards/{id}) and show the service picker UI
   — the API response has service_uris for all resolved services even if not on the tag
5. Log event: POST /cards/{id}/events  { event_type: "tap", service_selected: "spotify" }
```

This means the app **never needs to go to the browser** for cards with a matching service URL. The card page (eddi.audio/c/{id}) is the fallback for web browsers and for services the app doesn't handle yet.

### iOS background NFC (tag reading without opening the app)

iOS 13+ supports Core NFC background tag reading via the `com.apple.developer.nfc.readersession.formats` entitlement. When a NDEF URL record matching your associated domain is tapped while the app is closed, iOS opens the app via a Universal Link. React Native handles this via the `Linking` API. This is the most seamless UX — no need to open the app first and tap a "scan" button.

Android handles this via NFC intent dispatch; the app registers an intent filter for `ACTION_NDEF_DISCOVERED` with a host filter on `eddi.audio`. Both platforms can launch the app from a cold start on card tap.

---

## 3. Deep Linking to Streaming Services

The HTTPS URLs stored on the card are the canonical form used by each service. Both iOS and Android implement Universal Links / App Links that route these URLs to the native app automatically — no custom scheme (`spotify://`) needed.

### Spotify

- **Stored URL form:** `https://open.spotify.com/{type}/{id}`
- **iOS Universal Link:** Yes — `open.spotify.com` is in Spotify's AASA file. Tapping or opening this URL with `Linking.openURL()` opens the Spotify app directly to that album/track/playlist if installed.
- **Android App Link:** Yes — same domain, handled by `com.spotify.music`.
- **Fallback (not installed):** Opens `open.spotify.com` in the browser, which has a "Open in Spotify" banner.
- **No custom scheme needed** — the HTTPS URL is the right thing to store and open.

### Apple Music

- **Stored URL form:** `https://music.apple.com/{storefront}/album/{name}/{id}` or `/song/...` or `/playlist/...`
- **iOS:** `music.apple.com` is a Universal Link handled natively by the Music app. Opens the Music app directly on supported iOS versions (13+).
- **Android:** Apple Music has an Android app. `music.apple.com` URLs open in the Apple Music Android app if installed (via App Links), otherwise the browser.
- **Storefront note:** The storefront segment (e.g. `/us/`) is locale-specific. Apple's Cloudflare-backed redirect layer handles cross-region redirects, so a US link opened by a UK user still works.
- **Alternative:** Apple Music also supports the custom scheme `music://` but this is undocumented. Stick with HTTPS Universal Links.

### YouTube Music

- **Stored URL form:** `https://music.youtube.com/watch?v={videoId}` or `/browse/{browseId}`
- **iOS:** YouTube Music registers `music.youtube.com` as a Universal Link. Opens the YouTube Music app if installed.
- **Android:** Handled via App Links to `com.google.android.apps.youtube.music`.
- **Caveat:** YouTube Music's Universal Link handling is less reliable than Spotify's. Users may land in the browser on some configurations. Consider also storing the `vnd.youtube.music://` scheme as a fallback, but the HTTPS URL is the primary.

### Tidal

- **Stored URL form:** `https://tidal.com/browse/{type}/{id}`
- **iOS:** `tidal.com` is registered as a Universal Link by the Tidal app.
- **Android:** App Link to `com.aspiro.tidal`.
- **Reliability:** Solid on both platforms.

### Amazon Music

- **Stored URL form:** `https://music.amazon.com/albums/{id}` etc.
- **iOS Universal Link / Android App Link:** Supported via `music.amazon.com`.
- **Caveat:** Amazon Music's link handling requires the user to be signed in; unsigned users land on a sign-in screen, not the content.

### Implementation

```ts
import { Linking } from 'react-native'

async function openStreamingUrl(url: string) {
  const canOpen = await Linking.canOpenURL(url)
  if (canOpen) {
    await Linking.openURL(url)
  } else {
    // Fallback: open in in-app browser or Safari/Chrome
    // e.g. Linking.openURL(url) still works — OS routes to browser
    await Linking.openURL(url)
  }
}
```

`Linking.canOpenURL` on iOS requires the scheme to be whitelisted in `Info.plist` under `LSApplicationQueriesSchemes`. For HTTPS URLs this check always returns `true`, so the can-open check is optional but harmless.

**Summary table:**

| Service | iOS Universal Link | Android App Link | Fallback |
|---|---|---|---|
| Spotify | `open.spotify.com` | `com.spotify.music` | browser + install banner |
| Apple Music | `music.apple.com` | `com.apple.android.music` | browser |
| YouTube Music | `music.youtube.com` | `com.google.android.apps.youtube.music` | browser (inconsistent) |
| Tidal | `tidal.com` | `com.aspiro.tidal` | browser |
| Amazon Music | `music.amazon.com` | `com.amazon.mp3` | browser (sign-in wall) |

---

## 4. Hardware Player Communication

### What the Eddi player is likely running

Based on the hardware designs, the Eddi player is a small embedded Linux device (Raspberry Pi or similar compute module). It will have WiFi and possibly Bluetooth. The companion app needs to:

1. **Discover** the player on the local network.
2. **Send commands** — play this card, pause, skip, volume.
3. **Receive state** — now playing, playback position, queue.
4. **Configure** — WiFi credentials, Spotify account linking, firmware updates.

### Protocol options

#### Option A: Local HTTP REST (recommended for MVP)

The player runs a small HTTP server (e.g. Express on Node, FastAPI on Python, or Go). The app sends commands as HTTP requests on the local network.

- **Discovery:** mDNS/Bonjour — the player advertises `_eddi._tcp.local`. React Native can use `react-native-zeroconf` or `@capacitor-community/mdns`. On iOS, `NetServiceBrowser` via a native module. The player's hostname could be `eddi-{serialNumber}.local`.
- **Commands:** `POST http://eddi.local/play { card_id, service }`, `POST /pause`, `GET /state`.
- **Pros:** Simple, debuggable with curl, no pairing ceremony.
- **Cons:** Same WiFi network required. Port 80/8080 needs to be open on the player's firewall.

#### Option B: Bluetooth Low Energy (BLE)

The player advertises a BLE GATT service. The app connects, writes to characteristics to send commands, subscribes to notifications for state.

- **Pros:** Works without WiFi (useful for initial WiFi setup — "provision WiFi credentials over BLE before the player is on the network").
- **Cons:** More complex pairing flow, limited bandwidth (fine for commands, not for status streaming).
- **React Native:** `react-native-ble-plx` is the standard library.
- **Recommendation:** Use BLE **only** for the WiFi provisioning flow (scan for SSIDs, write SSID + password to a characteristic). Once on WiFi, switch to local HTTP.

#### Option C: Cloud relay (AWS WebSocket or MQTT)

Commands go through the Eddi backend (API Gateway WebSocket or AWS IoT Core MQTT). The player maintains a persistent connection to the cloud.

- **Pros:** Works when app and player are on different networks (e.g. control from work).
- **Cons:** Adds latency, cloud dependency for local playback control, more infrastructure.
- **Recommendation:** Defer to v2. Local HTTP is sufficient for early adopters who are physically near the device.

### Recommended architecture

```
[Companion App]
     │
     ├── BLE (provisioning only)
     │       └── Write WiFi creds → Player
     │
     └── Local HTTP (runtime control)
             ├── GET  http://eddi-{serial}.local/state    → { playing, card, position }
             ├── POST http://eddi-{serial}.local/play     ← { card_id, service_uri }
             ├── POST http://eddi-{serial}.local/pause
             ├── POST http://eddi-{serial}.local/volume   ← { level: 0-100 }
             └── GET  http://eddi-{serial}.local/cards    → recent card history
```

### What the player needs to expose

The player firmware needs to:

1. Run an mDNS daemon (`avahi-daemon` on Linux) advertising `_eddi._tcp` on port 80.
2. Run a local HTTP server with the routes above.
3. Implement a Spotify Connect client (e.g. `librespot`) or call the Spotify Web Playback SDK. The `service_uri` sent from the app tells the player what to play.
4. Optionally: expose a BLE GATT service for provisioning. The `BlueZ` stack on Linux handles this.

### NFC card → player flow (the core UX)

```
User taps NFC card with phone
  → App reads NDEF records
  → App parses card ID + service URLs
  → App looks up preferred service URL
  → App sends POST /play { service_uri } to player on local network
  → Player starts playing
  → App shows "Now playing" UI with artwork from GET /cards/{id}
```

This flow requires the app to know the player's local IP / mDNS name. The app should cache the last-known player address and re-discover via mDNS if it stops responding.

---

## 5. Auth Model

### Current state

The web `/write` page has **no auth**. Anyone with the URL can create a card. This is intentional — the barrier to writing a card should be physical (having a blank NFC tag), not account-based.

### Should the app have auth?

**Short answer: no mandatory auth, but optional account linking for family/multi-user scenarios.**

**Rationale:**

Eddi is a household device like a record player. The target user is a family or housemate group where multiple people want to write cards and the player should respond to anyone's phone tapping a card. A mandatory login would create friction at exactly the moment of delight (unboxing, first card tap).

**Recommended model:**

| Layer | Mechanism | Purpose |
|---|---|---|
| Card creation (write flow) | No auth — same as web | Anyone can write a card |
| Card events (tap logging) | Anonymous device ID | Enables per-card analytics without login |
| Player control | Local network only (no auth, or device secret) | Prevents remote control from outside home network |
| "My cards" / history | Optional iCloud/Google account sign-in | Shows cards you've written, edit display name |
| Hardware pairing | BLE proximity + PIN on device screen | One-time setup, not per-user |

**Device secret for player control:** The player generates a random token at first boot and displays it on-screen or in the Eddi web dashboard. The app stores this token and sends it as a header (`X-Eddi-Token`) on local HTTP requests. This prevents a neighbor on the same WiFi from controlling the player. It is not user authentication — it is device pairing.

**Family sharing pattern:**
- Each family member installs the app.
- Player token is shared via QR code shown in one person's app ("Share access").
- The token is stored in iCloud Keychain / Android Keystore and synced to family devices if you implement a "family group" feature later.
- No Eddi account needed to play — tapping any card with any phone triggers the player.

**If you do add accounts later:**
- Use Sign in with Apple (required for iOS App Store if any other social login is offered) + Sign in with Google.
- Scope accounts to: card attribution (`created_by`), edit/deactivate your own cards, opt-in analytics.
- Keep hardware control token-based and separate from user identity.

---

## 6. Write Flow — App vs Web Parity

The web write flow (`WritePage.tsx`) does:

1. `POST /resolve { url }` → get title, artwork, service_uris
2. `POST /cards { ...resolved, display_name }` → get card ID
3. `NDEFReader.write` with records: [eddi URL, spotify URL, apple_music URL, ...]

The app replicates this exactly, replacing `NDEFReader` with `react-native-nfc-manager`:

```ts
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager'

async function writeEddiCard(cardId: string, serviceUris: Partial<Record<ServiceKey, string>>) {
  const records = [
    Ndef.uriRecord(`https://eddi.audio/c/${cardId}`),
    serviceUris.spotify    ? Ndef.uriRecord(serviceUris.spotify)    : null,
    serviceUris.apple_music ? Ndef.uriRecord(serviceUris.apple_music) : null,
    serviceUris.tidal      ? Ndef.uriRecord(serviceUris.tidal)      : null,
  ].filter(Boolean)

  await NfcManager.requestTechnology(NfcTech.Ndef)
  try {
    await NfcManager.ndefHandler.writeNdefMessage(records)
  } finally {
    await NfcManager.cancelTechnologyRequest()
  }
}
```

The record order matches the web writer: eddi URL first, then service URLs in the same order as the existing `WritePage.tsx`. This ensures the physical NFC card reader in the Eddi hardware can rely on record position.

The "clone" feature (`/write?clone={id}`) also ports directly — fetch `/cards/{id}`, pre-populate the resolved data, skip the paste step.

---

## 7. Open Questions / Decisions Needed

1. **Player hardware finalized?** The communication protocol choice (local HTTP vs BLE) depends on whether the player has WiFi-only or WiFi+BLE. Both are recommended; BLE for provisioning is a strong UX win.
2. **Spotify Connect vs Spotify Web API playback?** `librespot` on the player acts as a Spotify Connect target (no user token needed for playback, but requires Spotify Premium). Alternatively the player calls the Spotify Web API with an OAuth token from the user's account. Spotify Connect is simpler and more reliable.
3. **App Store package ID:** The `WritePage.tsx` unsupported state already references `audio.eddi` as the Android package ID (`play.google.com/store/apps/details?id=audio.eddi`) and `https://apps.apple.com/app/eddi/id0000000000` for iOS (placeholder). Confirm and register these before any App Store submission.
4. **ISRC cache table:** `eddi-isrc-cache` is provisioned but empty. The resolver sprint that populates this (cross-service matching via ISRC) will directly determine how many services appear in `service_uris` on each card, which affects how many records the app writes and which deep links are available.
