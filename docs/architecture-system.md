# Eddi Linktree Page — Architecture & Design Spec

`eddi.audio/c/{id}` — the brand-discovery surface, service router, and card propagation engine.

---

## 1. System Overview

Every Eddi card carries `eddi.audio/c/{id}` as NDEF Record 1. When a phone taps a card, this is the page that loads. It does triple duty: play the content on the tapper's preferred service, introduce the Eddi brand, and attribute user-created cards. This page is the only Eddi surface most non-customers will ever see — it IS the marketing channel.

### The three audiences for this page

1. **Card owner** — tapped their own card on their phone. Wants to play it or share it.
2. **Wild tapper** — found/received/borrowed a card, tapped it. Has never heard of Eddi. Needs to play the content AND understand what they just touched.
3. **Link recipient** — someone texted/shared `eddi.audio/c/{id}` to them. No NFC involved. Same needs as wild tapper but on any device.

---

## 2. Data Architecture

### 2.1 Card Database (DynamoDB)

Primary data store for all card metadata. This is the backend the linktree page reads from.

**Table: `cards`**

| Field | Type | Description |
|---|---|---|
| `id` | String (PK) | Card identifier. Short, URL-safe. Generated at write time. |
| `title` | String | User-supplied or auto-resolved title (e.g., "Chill Vibes Playlist") |
| `description` | String (optional) | Short description or user note |
| `artwork_url` | String | Album/playlist art. Resolved from primary service at write time. |
| `artwork_palette` | Object | Dominant colors extracted from artwork (for page theming) |
| `content_type` | Enum | `track`, `album`, `playlist`, `artist`, `show`, `episode` |
| `service_uris` | Map | `{ spotify: "https://open.spotify.com/playlist/xxx", apple_music: "https://music.apple.com/...", youtube: "https://music.youtube.com/...", amazon: "https://music.amazon.com/...", tidal: "https://listen.tidal.com/..." }` |
| `created_by` | String (optional) | Creator user ID (null for Eddi Currents / curated cards) |
| `created_by_display` | String (optional) | Display name for attribution |
| `created_at` | ISO 8601 | Write timestamp |
| `updated_at` | ISO 8601 | Last update (device reconciliation or manual edit) |
| `source` | Enum | `user`, `currents`, `promo` |
| `tap_count` | Number | Incremented on every page load |
| `is_active` | Boolean | Kill switch for reported/problematic cards |

**Table: `card_events`** (analytics)

| Field | Type | Description |
|---|---|---|
| `event_id` | String (PK) | UUID |
| `card_id` | String (SK) | FK to cards |
| `event_type` | Enum | `tap`, `play`, `share`, `duplicate`, `write` |
| `service_selected` | String (optional) | Which service the user chose |
| `referrer` | String (optional) | Where the link came from (NFC, iMessage, Instagram, etc.) |
| `user_agent` | String | Device/browser fingerprint |
| `geo` | Object | Country/region (IP-derived, no precise location) |
| `timestamp` | ISO 8601 | |

### 2.2 Card NDEF Structure & the Resolution Flow (authoritative)

**The flow, stated correctly:** Every scan — phone *and* Eddi device — reads **Record 1 (`eddi.audio/c/{id}`) first**, and pings the Eddi server. The server is always in the runtime path.

- **Phone:** Record 1 → linktree page renders → introduces Eddi → tapper picks their streaming service → plays on their service.
- **Eddi device:** Record 1 → device pings the server → server resolves the card to the device's configured service → device just plays.

**The Eddi device is always online. There is no offline playback of playlist cards, by design.** Routing every play through the server is the deliberate choice that *avoids* per-device token management, credential refresh, and staleness handling — resolution and any service-token work happen server-side, once, centrally, not baked onto each card or managed on each device. This is a feature, not a limitation: it's how Eddi sidesteps the entire class of problems that come from trying to keep service tokens and resolved URLs fresh on the card or the device.

**Record layout (NDEF):**
- **Record 1 — Linktree (always first, MB=1):** TNF `0x01`, type "U", prefix `0x04` (`https://`), body `eddi.audio/c/{id}` (6–12 char base62 id). Read first by every consumer. Both the brand-discovery surface (phone) and the resolution entry point (device). Pinging it is also the "this card was tapped" event.
- **Records 2..N — per-service URIs (HTTPS):** the resolved direct address for each service. These exist as the **durability / openness layer** and align with the filed patent's card-as-multi-service-pointer claim — they make the card's content readable by any future or third-party tool directly off the card. They are **not** the shipping device's runtime playback path (the device goes through the server). HTTPS everywhere (decided 2026-05-27): one canonical format across card + DB + linktree, no native URI schemes.

| Service | NDEF prefix | Body example |
|---|---|---|
| Spotify | `0x04` | `open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M` |
| Apple Music | `0x04` | `music.apple.com/us/playlist/test/pl.abc123` |
| YouTube Music | `0x04` | `music.youtube.com/playlist?list={id}` |
| Amazon Music | `0x04` | `music.amazon.com/playlists/{id}` |
| Tidal | `0x04` | `listen.tidal.com/playlist/{id}` |

**Byte budget:** worked 3-record example (linktree + Spotify + Apple) ≈ 118 B on tag, well within NTAG215's 504 B. Comfortable headroom for the records-2+ durability layer.

**Open item to confirm (do not assume):** Given the device routes through the server, the operational question is how thin Record-2+ content needs to be on the card vs. carried server-side. The records-2+ layer is retained for openness/durability + patent alignment; whether every service URL must be physically present on every card, or whether the durability guarantee is satisfied by the linktree + the Git manifest archive (Section 2.5), is a decision to lock explicitly rather than infer.

### 2.3 The Openness Guarantee (corrected)

Openness does **not** mean "the Eddi device plays offline without the company." It means **the data outlives the company** — if Eddi disappears, no card's content is lost, because the resolution recipe is public and the card's content is independently recoverable.

The guarantee is delivered by the **nightly Git manifest archive** (Section 2.5): every card's recipe — ordered ISRCs for the tracks, origin-service URL, metadata — is dumped to a public repo nightly. ISRCs never expire and are the universal cross-service key, so anyone (a community fork, the user, a future tool) can resolve any card to any service from the archive alone, forever, with no Eddi server.

So the anti-enshittification principle holds structurally, not operationally: while Eddi lives, the device and phone both route through `eddi.audio/c/{id}` for a clean, token-managed, always-current experience; if Eddi dies, the public archive means the cards are still resolvable by anyone. Eddi being in the live runtime path is fine *because* the durable artifact (the recipe) is public and not controlled by Eddi.

This applies uniformly to single tracks, albums, and playlists — all route through the server at play time, all are preserved in the public archive. (Tracks/albums are trivially exact via ISRC/UPC; playlists are faithful per-track resolutions with honest match-count UI.)

### 2.4 Patent novelty (card-as-multi-service-pointer)

The multi-record structure is the strongest novelty axis of the provisional (filed 2026-05-26, "NFC Card-Activated Audio Playback Device with Multi-Record Service Resolution"):
- **Card-as-multi-service-pointer** (one card → many services, service-agnostic at issue) is the primary novelty axis.
- **vs. Boxine US10960320B2:** Boxine looks the card UID up against an internal DB. Eddi's card encodes service URIs *directly* (records 2+) and resolves via the linktree — the card is a self-describing multi-service pointer, not an opaque UID meaningful only to one company's server. The card's content is portable and recoverable (durability layer + public archive), which is the design-around.
- Record 1 serves both the phone surface and the device resolution entry point from one encoding.
- The ISRC-based resolver that *populates* records and the archive is prior art and is not claimed.

### 2.5 Nightly Git Manifest Archive (the openness mechanism)

The durable, company-independent backstop for playlist cards. Every night, dump each card's resolution recipe to a public Git repository:

- **What's dumped:** per card ID, the ordered list of track **ISRCs** (for tracks/albums, the ISRC/UPC), plus the origin-service native URL and minimal metadata (title, creator handle if any). The *recipe*, not Eddi-hosted-playlist URLs (those are worthless once Eddi is gone).
- **Why ISRCs:** they never expire, they're the universal cross-service key, and any future tool can resolve them to any service. A community fork could rebuild full functionality from the archive alone.
- **What it guarantees:** if Eddi's servers and any hosted convenience-layer playlist objects vanish, every card's content is still recoverable — `eddi.audio/c/{id}` → archived manifest → resolve to any service. The data outlives the company. This is the structural satisfaction of the anti-enshittification principle: openness is a property of the public archive, not a promise that Eddi keeps running.
- **Cadence:** nightly. Public repo (GitHub). Essentially "every Eddi card's recipe, in the open, updated nightly."

This is what makes hosted convenience layers (cached cross-service playlists, fast resolution) acceptable: they speed things up while Eddi is alive, but nothing is *lost* if Eddi disappears, because the recipe is permanently public.

### 2.6 Service URI Resolution (at card-write time)

When a user writes a card (via app or web), they paste a single URL (e.g., a Spotify share link). The system resolves that to HTTPS URLs for all supported services. This is on by default — users don't toggle it.

**The matching mechanism:** Every track has an ISRC (International Standard Recording Code) — a 12-character unique identifier that is identical across all streaming platforms for the same recording. Albums use UPCs. The resolver gets the ISRC from the source URL, then queries each target service by that ISRC to get their URL.

#### Per-service API reality (researched May 2026)

**Spotify Web API**
- Endpoint: `GET /v1/tracks/{id}` returns `external_ids.isrc` in the response. Search by ISRC: `GET /v1/search?q=isrc:{code}&type=track`.
- ISRC field was nearly killed: Spotify tried to remove `external_ids` in their February 2026 API lockdown, then reverted it in March 2026. Available today but Spotify has shown willingness to yank it.
- **Dev Mode restrictions (February 2026):** Premium account required for app owner. Limited to 5 authenticated users. 1 client ID per developer. Spotify is "moving away from the Client Credentials flow for metadata endpoints." Rate limits are rolling 30-second window, unpublished exact numbers for dev mode but significantly lower than extended quota. Search pagination capped at 10 results.
- **Extended Quota Mode** requires a registered business (have it), a launched service with 250,000+ MAU (won't have for a long time), and manual approval. Chicken-and-egg, and the dev community is loud about it.
- **Two separate Spotify gates — both Phase-gated, already understood (not blockers to the resolver):**
  1. *eSDK Hardware Partner / Systems Integrator gate* — for Spotify Connect playback on the device. Cannot be applied for during the Pi phase; the SI path requires custom production hardware (Allwinner SoM / custom PCB). This is **Phase 3**, post-funding. Partner status unlocks broader Web API access as part of the relationship — we've already confirmed this in the partner docs review.
  2. *Web API Extended Quota gate (250K MAU)* — the standalone metadata-API gate. Independent of the eSDK gate and also not clearable early.
- **What this means for the resolver right now:** during Pi prototyping and early launch, neither official elevated path is open, so the resolver uses the same mechanism the open-source tools use. Spotify catalog reads (`GET /v1/tracks/{id}` for ISRC, search by ISRC) work under client credentials in dev mode today. If Spotify tightens client credentials for catalog endpoints, fallback is the authenticated user's own Spotify token — the app already holds it for device pairing, so no extra auth burden on the user. Once we're a hardware partner (Phase 3), the elevated Web API access removes the dev-mode ceiling entirely.

**Apple Music API**
- Endpoint: `GET /v1/catalog/{storefront}/songs?filter[isrc]={isrc}` — dedicated ISRC lookup.
- Requires Apple Developer account ($99/year — needed anyway for iOS app).
- Rate limit: 20 requests/second per developer token. A 50-track playlist resolves in 2.5 seconds.
- Auth: Server-to-server JWT (ES256 signed with MusicKit private key). No user OAuth needed for catalog lookups.
- Storefront caveat: A track may exist in the US storefront but not others. Default to US, fall back to user's region if available. Check `playParams` field to verify actual playability — some results return greyed-out/unavailable tracks.
- **Verdict: cleanest API of the five. No restrictions on catalog access. No MAU gates.**

**Tidal Developer API**
- ISRC lookup endpoint in catalogue v2 API: `GET /tracks?filter[isrc]={isrc}`.
- API is still in beta. Free access through developer.tidal.com.
- Rate limits: not publicly documented, reportedly generous during beta.
- **Verdict: works, but beta status means it could change. Lower priority — Tidal's market share is small.**

**YouTube Music**
- The official YouTube Data API v3 is a trap for this use case: 10,000 quota units/day, search costs 100 units = only 100 searches/day. Unusable. **This is NOT the path.**
- The actual path every transfer tool uses (SpotTransfer, SongShift, TuneMyMusic, Soundiiz) is **`ytmusicapi`** — an open-source Python library that emulates the YouTube Music web client's internal API. It does not consume YouTube Data API quota. Search is effectively unmetered for normal usage (subject only to soft anti-abuse throttling, mitigated by request pacing and our cache).
- No ISRC support on YouTube's side, so matching is title + artist + duration. `ytmusicapi` returns structured results that distinguish actual songs (artist-uploaded) from videos (user uploads), so we filter to songs and pick the closest duration match.
- **Tradeoff:** unofficial API. Against YouTube's ToS in the strict sense, and could break if Google changes their internal API. This is the same risk every competitor in the space runs — it's the de facto industry standard for YouTube Music matching. For a commercial product, isolate it behind our resolver interface so it can be swapped (e.g., for a paid resolver like Musicfetch) without touching the rest of the system.
- **Verdict: solved via ytmusicapi. Scales fine. Carry the ToS/breakage risk consciously and keep it swappable.**

**Amazon Music**
- No openly-documented public catalog API. Amazon's developer music APIs are behind invitation-only partner programs.
- The commercial transfer tools (Soundiiz, TuneMyMusic, FreeYourMusic) handle Amazon by OAuth into the user's Amazon Music account (read/write their library) rather than anonymous catalog lookup. There are also unofficial/reverse-engineered approaches similar in spirit to ytmusicapi, but they're less mature and higher-maintenance than the YouTube equivalent.
- Amazon Music is the smallest of the five by relevant market share and the highest-friction to integrate.
- **Verdict: lowest priority. Options ranked: (1) Musicfetch/third-party resolver for Amazon coverage, (2) unofficial client approach if a maintained library exists, (3) ship without Amazon at launch and add later — the card NDEF can hold the Amazon URL whenever resolution becomes available, no rewrite needed.**

#### Third-party resolver fallback: Musicfetch

Musicfetch (musicfetch.io) is a dedicated cross-platform resolver covering 40+ services. Single API call in, multi-service URLs out, JS/TS client available. Request-based monthly pricing with overage (exact tiers require signup).

- **Role for Eddi:** fallback/insurance, not the primary path. Apple Music and Tidal have good official APIs; YouTube is handled by ytmusicapi. The one place Musicfetch earns its keep is Amazon Music coverage, where no clean alternative exists. It's also a clean drop-in if we ever want to stop maintaining unofficial clients and pay for reliability instead.
- Keeping resolution behind one interface means we can route specific services to Musicfetch without re-architecting.

**Songlink/Odesli:** 10 requests/minute. Confirmed non-starter at volume.

#### Recommended architecture: hybrid resolver

| Target Service | Resolution Method | Why |
|---|---|---|
| **Apple Music** | Official API (ISRC lookup) | Best API, 20 req/sec, no MAU gate, $99/yr already paid |
| **Tidal** | Official API (ISRC lookup) | Free beta, ISRC supported |
| **YouTube Music** | `ytmusicapi` (unofficial, title+artist match) | Official Data API quota is unusable; ytmusicapi is the industry-standard path and scales |
| **Amazon Music** | Musicfetch / third-party, or defer | No open catalog API; lowest priority |
| **Spotify** (source + reverse) | Official API, client credentials or user token | Catalog reads work in dev mode today |

All resolution sits behind a single internal resolver interface so any per-service method can be swapped (official ↔ unofficial ↔ paid third-party) without touching card-write or device code.

**Resolution pipeline:**

```
1. User pastes a URL from any supported service
2. Identify source service from URL domain
3. Hit source service API → get track metadata + ISRC
4. Check isrc_cache in DynamoDB — if all target services resolved, return immediately
5. Cache miss → fan out:
   a. Apple Music: direct ISRC lookup (fastest, most reliable)
   b. Tidal: direct ISRC lookup
   c. YouTube + Amazon: single Musicfetch API call (returns both)
6. Cache all results: isrc_cache table, ISRC as key, 90-day TTL
7. Store resolved URLs in cards.service_uris + encode into NDEF records
```

**Caching economics:** A track resolved once is pre-resolved for every future card containing that track. Popular music is a small catalog tapped repeatedly — at scale, the cache eliminates most API calls. The ISRC never changes for a recording.

**UI treatment:**
- Cross-service resolution is on by default. The card just works on every service.
- If a track can't be matched on a service (catalog gaps, regional restrictions), that service button is omitted from the linktree page for that card.
- For playlists: "45 of 47 tracks available on Apple Music" — honest, not hidden.

**Content type behavior:**

| Content Type | Match Method | Match Quality | Notes |
|---|---|---|---|
| Track | ISRC | Near-perfect | Same recording everywhere |
| Album | UPC | Near-perfect | Same release everywhere |
| Artist | Name + ID matching | High | All services have the artist |
| Playlist | Per-track ISRC | Best-effort | Playlist is source-service-only; other services get per-track matches with honest count |
| Podcast/Show | Title + RSS matching | Medium | Podcasts distribute via RSS — same show, different URLs |

**Costs (annual):**
- Apple Developer Program: $99/year (needed for iOS app anyway — not incremental)
- Tidal API: free (beta)
- Spotify Web API: free (dev mode, Premium already held)
- YouTube Music via `ytmusicapi`: free (open-source, self-hosted) — carries ToS/breakage risk, not dollar cost
- Musicfetch: optional, only if used for Amazon coverage — evaluate pricing against just deferring Amazon at launch

**Phase dependency (understood, not a blocker):**
Spotify Hardware Partner status (Phase 3, post-custom-hardware) grants elevated Web API access, removing the dev-mode ceiling. Until then, the resolver runs on dev-mode client credentials + user-token fallback, which is sufficient for prototyping and early launch volume. The 250K MAU Extended Quota gate and the eSDK partner gate are both Phase-3 concerns we've already mapped — they do not block the resolver from working now.

**Patent note:**
The ISRC-based cross-service resolver is prior art (Songlink, MusicBrainz, Soundcharts, Musicfetch, every playlist transfer tool). Not patentable and not claimed. The provisional patent covers encoding resolved multi-service URIs into NFC card NDEF records and device-side iteration — the card-as-multi-service-pointer, not the resolver.


---

## 3. Service Buttons & App Opening

Service buttons should open the user's native app (Spotify, Apple Music, etc.), not a mobile browser. This works automatically with no custom logic.

### The approach: HTTPS anchor tags — the OS handles the rest

No custom deep-link JavaScript needed. Both iOS (Universal Links) and Android (App Links) intercept taps on HTTPS URLs and open the corresponding app automatically — as long as the link is a real `<a href>` tap, not a programmatic `window.location` redirect.

Each service button is a plain anchor tag with the service's standard HTTPS URL:

```html
<a href="https://open.spotify.com/playlist/xxx">Listen on Spotify</a>
<a href="https://music.apple.com/us/album/xxx">Open in Apple Music</a>
<a href="https://music.youtube.com/playlist?list=xxx">Open in YouTube Music</a>
<a href="https://music.amazon.com/albums/xxx">Open in Amazon Music</a>
<a href="https://listen.tidal.com/album/xxx">Open in Tidal</a>
```

**What happens on tap:**
- App installed → OS intercepts, opens the app directly (no browser flash)
- App not installed → opens in the mobile browser (web player or store redirect)
- Desktop → opens the web player in a new tab

**What you need to build:**
- Store the HTTPS web URL per service in the database (resolved at card-write time via in-house ISRC/UPC resolver)
- Service button component: styled `<a>` tags, one per available service, with service logo + label
- Service preference cookie: if user previously picked Spotify, promote that button to the top on return visits

No native URI schemes (`spotify:`, `music://`, etc.) in the database. No JavaScript redirect logic. No platform detection. HTTPS URLs handle everything.

---

## 4. Analytics Architecture

Skip Google Analytics. You're already on AWS. Keep the analytics pipeline in-house.

**Recommended stack:**

| Layer | Service | Why |
|---|---|---|
| **Event ingestion** | API Gateway → Lambda → DynamoDB (`card_events` table) | Serverless, scales to zero, no standing cost |
| **Real-time counters** | DynamoDB atomic counters on `cards.tap_count` | Updated on every page load, shown on page |
| **Batch analytics** | DynamoDB → S3 export → Athena | Ad-hoc queries for pitch deck metrics |
| **Dashboard** | Athena → QuickSight (or export to CSV for deck) | Visualization |

**Why not Google Analytics:**
- GA is overkill for a single-page card surface
- GA's data model doesn't map cleanly to your card-centric analytics (you want per-card metrics, not per-page)
- GA adds a third-party script to a page that should load instantly
- You need the raw event data for pitch deck metrics — GA aggregates make that harder
- Your data, your database, no sampling

**What to track:**

| Metric | How | Why |
|---|---|---|
| Tap count per card | DynamoDB counter | Card virality, propagation proof |
| Service selection distribution | `card_events.service_selected` | Shows platform diversity (anti-walled-garden proof point) |
| Referrer breakdown | `card_events.referrer` | NFC vs. shared link vs. social |
| Geo distribution | IP → country/region | Market signal for pitch deck |
| Unique tappers per card | Fingerprint/cookie on `card_events` | Distinct reach per card |
| Wild tap ratio | Cards where tapper ≠ creator | Propagation metric — the headline number for the deck |
| Duplicate requests | `card_events.event_type = 'duplicate'` | Demand signal for card propagation model |

---

## 5. Page UI — Elements & Layout

Mobile-first. 95%+ of traffic is phones. Desktop is a responsive stretch, not a design target.

### 5.1 Page Sections (top to bottom, mobile viewport)

**A. Card Hero**
- Album/playlist artwork (large, full-width or near-full)
- Title (e.g., "Summer Drive Mix")
- Content type badge (Playlist · 47 tracks)
- Artwork extracted color palette drives page accent/background

**B. Service Buttons**
- One button per available service (only show services that have a URI for this card)
- Deep-link-with-fallback behavior (see Section 3)
- Service preference cookie: if user previously picked Spotify, Spotify button is promoted to top on return visit
- Visual: service logo + "Listen on Spotify" / "Open in Apple Music"

**C. Attribution Block**
- If `source = user`: "Made by [display_name]" with optional link to their profile/subscription page
- If `source = currents`: "An Eddi Currents pick" with Currents branding
- If `source = promo`: custom promo attribution

**D. Action Bar**
- **Share** — native share sheet (Web Share API on mobile, copy-link fallback on desktop)
- **Duplicate this card** — "Make your own copy" → links to the app (with card ID pre-filled for cloning) or the web writer flow. Android: could trigger Web NFC write directly.
- **Tap count** — "Tapped 247 times" (social proof, propagation signal)

**E. Brand Block**
- NOT a full "About Eddi" section. Keep it tight.
- Eddi logo (small) + one-line pitch: "Eddi — a music player that plays cards, not algorithms."
- CTA: "Learn more" → `eddi.audio` (main site)
- Secondary links: "Get the player" → store | "Subscribe to Currents" → subscription page

**F. Social Footer**
- @eddiaudio links (Instagram, TikTok, X, etc.)
- Minimal, icon-only row

### 5.2 Web NFC Card Writer

Route: `eddi.audio/write` (separate from the card page, not embedded in every `/c/{id}`)

**Requirements:**
- Chrome on Android only (Web NFC API constraint — `navigator.ndc` is Chrome 89+ Android only, no iOS, no desktop)
- No auth required for v1. Optional display name prompt for attribution. IP-rate-limited to prevent spam.
- Flow: Paste URL → resolve to multi-service URIs → preview card (artwork, title, services) → optionally enter display name → tap blank card to phone → write NDEF records + save to DynamoDB
- Reuses the same resolver and NDEF encoding logic as the native app
- Graceful degradation: on unsupported browsers, show "Download the Eddi app to write cards" with app store links

**Browser support matrix:**

| Browser | OS | Web NFC | Action |
|---|---|---|---|
| Chrome 89+ | Android | ✅ | Full write flow |
| Chrome | iOS | ❌ | "Use the Eddi app" |
| Safari | iOS | ❌ | "Use the Eddi app" |
| Firefox | Any | ❌ | "Use the Eddi app" |
| Desktop | Any | ❌ | "Use the Eddi app" |

### 5.3 Empty / Error States

| State | Display |
|---|---|
| Invalid card ID | "This card doesn't exist. It might have been removed." + brand block + store CTA |
| Card deactivated | "This card has been taken down." + brand block |
| No service URIs | "This card hasn't been set up yet." + "Write it with the Eddi app" CTA |
| Server error | "Something went wrong. Try tapping again." + retry button |

---

## 6. OG / Meta Tags (Rich Previews)

When someone shares `eddi.audio/c/{id}` on iMessage, Instagram, WhatsApp, Slack, X, etc., the preview must be compelling. This is free impressions at scale.

```html
<!-- Primary -->
<meta property="og:title" content="Summer Drive Mix" />
<meta property="og:description" content="A playlist on Eddi · 47 tracks · Made by @daniel" />
<meta property="og:image" content="https://eddi.audio/cards/{id}/og-image.png" />
<meta property="og:url" content="https://eddi.audio/c/{id}" />
<meta property="og:type" content="music.playlist" />
<meta property="og:site_name" content="Eddi" />

<!-- Twitter/X -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Summer Drive Mix" />
<meta name="twitter:description" content="Listen on your favorite service" />
<meta name="twitter:image" content="https://eddi.audio/cards/{id}/og-image.png" />

<!-- Apple Smart Banner (when app exists) -->
<meta name="apple-itunes-app" content="app-id=XXXXXXX, app-argument=eddi://card/{id}" />
```

**OG image generation:**
- Server-side rendered image (Lambda + Sharp/Canvas or Puppeteer)
- Template: card artwork with Eddi branding overlay, title text, content type
- Cache in S3, served via Cloudflare CDN — regenerate on card update
- Dimensions: 1200×630px (standard OG) + 1200×1200px (square for platforms that crop)

---

## 7. Infrastructure

### 7.1 Cloudflare (Edge Layer — already in place)

| Service | Purpose |
|---|---|
| **Cloudflare DNS** | DNS for `eddi.audio` + `eddiaudio.com` (already active) |
| **Cloudflare Pages** | Static hosting for the linktree SPA + OG meta tags (SSR via Cloudflare Workers for crawler previews) |
| **Cloudflare CDN** | Edge caching for static assets, OG images, API responses |
| **Cloudflare WAF** | Rate limiting, bot protection, DDoS mitigation |

### 7.2 AWS (Backend Layer)

| Service | Purpose |
|---|---|
| **API Gateway** | REST endpoints: `/api/cards/{id}`, `/api/cards/{id}/events`, `/api/write` |
| **Lambda** | Card lookup, event logging, OG image generation, NDEF encoding for web writer |
| **DynamoDB** | `cards` + `card_events` + `isrc_cache` tables |
| **S3** | OG image cache, analytics export |
| **Athena** | Ad-hoc analytics queries on exported event data |

No CloudFront, no Route 53, no AWS WAF. Cloudflare handles the entire edge. AWS handles data and compute only.

### 7.3 Rate Limiting & Abuse

- Cloudflare WAF rate limiting rules at the edge (before traffic hits AWS)
- API Gateway throttling as a second layer: 100 requests/second burst, 50 sustained per IP
- DynamoDB: on-demand capacity (scales to zero, no pre-provisioned cost)
- Card deactivation: `is_active` flag for reported cards
- No auth required to VIEW a card page (public by design — propagation model demands it)
- No auth required to WRITE or DUPLICATE in v1 (IP-rate-limited; auth can be added later without breaking existing cards if abuse emerges)

### 7.4 Performance Targets

| Metric | Target | Why |
|---|---|---|
| First Contentful Paint | < 1.0s | NFC tap → page must feel instant |
| Time to Interactive | < 1.5s | Service buttons must be tappable fast |
| Page weight | < 200KB (initial) | Mobile networks, global audience |
| API latency (card lookup) | < 100ms (p99) | DynamoDB single-item read |
| OG image serve | < 50ms | Pre-generated, CDN-cached |

---

## 8. Open Decisions

| Decision | Options | Impact | Notes |
|---|---|---|---|
| **Amazon Music coverage** | Musicfetch (paid) vs. unofficial client vs. defer to post-launch | Resolver completeness | Lowest-share service; card NDEF can hold the Amazon URL whenever resolution lands — no rewrite |
| **ytmusicapi hardening** | Self-host + pace requests + cache vs. eventually pay Musicfetch for reliability | YouTube resolution reliability | Unofficial API; isolate behind resolver interface so it's swappable if Google breaks it |
| **OG image gen** | Lambda + Sharp vs. Puppeteer vs. Cloudflare Workers | Cost, quality, latency | Sharp is lighter weight |
| **Card ID format** | Short alphanumeric (8 chars) vs. UUID vs. nanoid | URL length, collision risk, aesthetics | Short is better for the URL — `eddi.audio/c/k7x2m9q4` |
| **Web writer route** | `/write` on main domain vs. integrated into app | Scope, maintenance | Separate route, separate concern |
| **Attribution profile links** | Link to user's Spotify/Apple profile vs. Eddi profile page vs. nothing | Privacy, complexity | Start with display name only, no link |
| **Free-tier fallback** | What happens if tapper has none of the listed services? | UX for wild tappers | Show all buttons + "Don't have any? Try Spotify Free" |

---

## 9. Relationship to Other Workstreams

| Workstream | Dependency |
|---|---|
| **Software/App** | App card writer shares the same resolver, NDEF encoding, and card database. Web writer and app writer are two clients to the same API. |
| **Software/Device** | Device reconciliation (card-on-device → server ping to update `cards` table) keeps the linktree page current. |
| **Subscription (Eddi Currents)** | Currents cards are `source = currents` in the database. Linktree page shows Currents branding. Store links point to subscription page. |
| **Hardware** | No direct dependency. Linktree page is phone-side only. |
| **IP/Patent** | Multi-record NDEF service resolution is the core patent claim. The linktree page is the Record 1 implementation. |

---

## 10. v1 Scope vs. v2+

### v1 (launch)
- Card page with artwork, title, service buttons, attribution, share, brand block, social footer
- Service buttons as HTTPS anchor tags (Universal Links / App Links handle app-open automatically)
- OG meta tags with server-generated preview images
- DynamoDB card database + event logging
- Cloudflare CDN + Cloudflare Pages hosting
- Rate limiting via WAF
- Basic analytics (tap count, service selection, referrer)
- Web NFC writer at `/write` (Chrome Android only, behind auth)
- Duplicate card flow (deep-link to app with pre-filled card data)
- Error/empty states

### v2+
- **"Save to my library" — opt-in playlist save.** When a card resolves to a playlist (or queue) from a service the tapper isn't on, offer a button to save the reconstructed playlist into their own account. Requires per-service OAuth with playlist-modify scope, and on Spotify is gated by the user-scoped write quota (5-user dev-mode cap → needs partner/extended quota). Opt-in only, never automatic — see Section 11 for the invasiveness reasoning. Controlled by a user setting (default off).
- Analytics dashboard (Athena + QuickSight or custom)
- Service preference memory (cookie → account-level)
- Card collections / "deck" pages (group cards by creator or theme)
- QR code on card page (for sharing without NFC — screenshot friendly)
- Embeddable card widget (paste `eddi.audio/c/{id}` in a blog post → inline player card)
- A/B testing on brand block copy/placement
- Internationalization

---

## 11. Resolved & Remaining Gaps

### Resolved (this session)

| Item | Decision |
|---|---|
| **Auth for web writer** | No auth required for v1. User pastes a URL, resolves, writes a card. Attribution is an optional text prompt ("your name"), not a login. App has Spotify OAuth for device pairing. Store is Shopify (owns its own auth). No Eddi-native account system. Rate limiting by IP is sufficient at v1 scale. |
| **Card write metadata** | Metadata (artwork, title, track count, description) comes from the resolver or the source service API. Not a custom generation problem. Stored in DynamoDB at write time. |
| **Resolver** | Hybrid behind one swappable interface: official ISRC APIs for Apple Music + Tidal, `ytmusicapi` (unofficial, industry-standard) for YouTube Music, Musicfetch/defer for Amazon. Spotify catalog reads via dev-mode client credentials + user-token fallback now; elevated Web API access comes with Hardware Partner status in Phase 3. Songlink out (10 req/min). On by default, cached in DynamoDB (`isrc_cache`, 90-day TTL). ToS/breakage risk on unofficial clients carried consciously and isolated. See Section 2.6 for full per-service research. |
| **Content moderation** | Not needed for v1. Eddi doesn't host content — cards link to third-party services. Card titles/descriptions are user-supplied text but moderation overhead isn't justified at launch scale. `is_active` kill switch exists for manual intervention if needed. |
| **NDEF byte budget** | Already verified. NTAG215 (504 bytes) comfortably holds Record 1 + 6–8 service HTTPS URLs. Confirmed in the compendium. |
| **Duplicate card flow** | New card, same content, new ID. No provenance chain, no attribution link to original. Consistent with abundance model — burning CDs, not minting NFTs. On Chrome Android: redirect to `/write?clone={id}` pre-fills the content. On iOS/other: deep-link to app with clone parameter. |
| **Cross-service playback model** | Tracks and albums cross services exactly (ISRC/UPC). Playlists cross as faithful per-track reconstructions (~98% exact; honest match-count UI for the rest). Playback is direct: the tapper's app opens the resolved URL / queues the resolved track set — **no persisted playlist object required**, nothing saved to anyone's account by default. Resolution happens at card-write time and is cached; tapping a card never writes to a user's library or burns API quota at tap time. |
| **Auto-save to tapper's account — REJECTED as default, deferred as opt-in** | Silently writing a playlist into a stranger-card-tapper's library is invasive (you tap to listen, not to have your library modified) and requires per-service user-OAuth with write scope (Spotify write is user-scoped, gated by dev-mode 5-user cap). Decision: never automatic. Offer as an explicit opt-in "Save to my library" button + user setting (default off), v2+, post-partner. |
| **Eddi-owned lazy-rebuilt playlists — REJECTED for user cards** | Considered: Eddi holds accounts on all services, lazily rebuilds a playlist on first tap, caches X days, hands back a URL to Eddi's copy. Rejected because: (1) the playlist lives on *Eddi's* account, not the tapper's — shows "by Eddi," not saved to their library, and "breaks" when the cache expires until re-tapped; (2) it injects a stateful, expiring, server-owned object into a system whose core promise is cards-work-forever-without-the-company — inverts the anti-enshittification principle; (3) automated playlist-bot accounts on five services are a ToS/ban risk and a single point of failure (one flagged account breaks all playlist cards at once); (4) still consumes user-scoped write quota. **Exception: Eddi Currents.** Curated subscription playlists *should* be real, maintained playlists on each service under Eddi accounts — Eddi owns that content relationship, they're legitimately "by Eddi," non-expiring, and a managed product. Run service accounts for Currents, not for arbitrary user cards. |

### Still needs detail

#### Cloudflare Workers SSR for Crawlers
The linktree page is a client-side SPA, but crawlers (iMessage, WhatsApp, Twitter/X, Facebook, Slack) don't execute JavaScript. OG meta tags must be server-rendered. Pattern: Cloudflare Worker intercepts requests to `/c/{id}`, checks User-Agent. Crawler → fetch card data from AWS API, render minimal HTML with OG tags, return it. Human → serve the SPA. Well-trodden pattern, needs implementation spec.

#### CORS & API Security
Cloudflare Pages frontend (`eddi.audio`) calls AWS API Gateway (`api.eddi.audio` or similar). Needs:
- CORS headers on API Gateway allowing `eddi.audio` origin
- Public endpoints: card lookup (`GET /api/cards/{id}`), event logging (`POST /api/cards/{id}/events`) — no auth, IP-rate-limited
- Write endpoint: `POST /api/cards` — IP-rate-limited (no auth in v1, but monitor for abuse; auth can be added later without breaking existing cards)
- Rate limiting layering: Cloudflare WAF (edge) → API Gateway throttle (backend)

#### Artwork Caching Strategy
Do we store a copy of album/playlist art in S3, or hotlink to the source service CDN (e.g., Spotify's `i.scdn.co`)?
- **Hotlink:** zero storage cost, but images break if the service rotates URLs or the content is removed. Linktree page for a deleted playlist shows a broken image.
- **Cache in S3:** small storage cost, but guarantees the card page always has artwork. Also needed for OG image generation (Lambda needs the source artwork to composite the preview image).
- **Recommendation:** cache in S3 at write time. The OG image generator needs it anyway, and permanence matters for the propagation model — a card found in 3 years should still render.

#### Card ID Generation
- Server-generated (Lambda) at write time. Short alphanumeric, URL-safe. 8 characters (nanoid or similar) gives ~2.8 trillion combinations — collision-safe at any realistic scale.
- Collision check: conditional put in DynamoDB (fails if ID exists, retry with new ID). Statistically near-zero but handled cleanly.
- Format: lowercase alphanumeric, no ambiguous characters (no 0/O, 1/l/I). Example: `eddi.audio/c/k7x2m9q4`
