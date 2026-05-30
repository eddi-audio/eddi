# Cross-Service Music Resolver Research

**Purpose:** When a user writes an NFC card with a Spotify URL (track, album, or playlist), automatically find and store the equivalent URL on Apple Music, Tidal, YouTube Music, and Amazon Music.

**Stack context:** Node.js 20 ARM64 Lambda, DynamoDB (`eddi-isrc-cache` keyed by ISRC), resolver runs at card-write time.

---

## Executive Summary

| Service | ISRC Lookup | Playlist Support | Auth Model | Feasibility |
|---|---|---|---|---|
| Apple Music | Yes — native endpoint | Partial (catalog only) | Developer JWT (server-side) | **Feasible now** |
| Tidal | Yes — `/tracks?filter[isrc]=` | Yes — playlist by ID | Client credentials (server-side) | **Feasible now** |
| YouTube Music | No official API | No official API | Unofficial scraping only | **Risky** |
| Amazon Music | No public API (closed beta) | In beta spec | OAuth 2.0 (invite-only) | **Not feasible** |

**Bottom line:** Ship Apple Music + Tidal via ISRC on day one. Use Odesli (Songlink) as the universal fallback — it resolves tracks, albums, and playlists across all four platforms in a single call. Treat YouTube Music and Amazon Music as deferred or best-effort via Odesli output.

---

## Service Deep-Dives

---

### 1. Apple Music (MusicKit / Apple Music API)

#### What it can do
- **ISRC lookup:** `GET /v1/catalog/{storefront}/songs?filter[isrc]={isrc}` — batch up to 25 ISRCs per request. Returns song ID, name, artwork, and a canonical URL (`attributes.url`) in the form `https://music.apple.com/us/album/...`.
- **Album lookup:** by Apple Music album ID.
- **Catalog playlist lookup:** `GET /v1/catalog/{storefront}/playlists/{id}` — fetches any Apple Music editorial or shared playlist by its `pl.` ID.
- **Search:** `GET /v1/catalog/{storefront}/search?term=...&types=songs,albums,playlists`.
- Storefront (country code) must be specified; different storefronts have different catalog availability.

#### Accounts and registration
- Requires an active **Apple Developer Program** membership: **$99/year**.
- In the Developer Console (Certificates, Identifiers & Profiles), create a **MusicKit identifier** and download an **ES256 private key** (`.p8`). You get a Key ID and Team ID.
- No separate review or approval is needed to access the catalog API (public catalog lookup is allowed immediately).
- User-scoped endpoints (library, personal playlists) require a separate Music User Token flow — **not needed for Eddi's use case**.

#### Auth model
- **Server-side only, no user token needed for catalog reads.**
- Generate a signed **JWT** (HS256 → actually **ES256**) with:
  - `alg: ES256`, `kid: {KeyID}`
  - Claims: `iss` = Team ID, `iat` = now, `exp` = now + up to **6 months**
  - Signed with the `.p8` private key
- Send as `Authorization: Bearer {token}` on every request.
- Token rotation: max 6-month lifespan; bake token generation into Lambda env or a scheduled rotation.

#### Rate limits and cost
- Apple **does not publish hard numeric rate limits** for the Music API. Developer forum posts confirm that limits exist but Apple won't state them. Anecdotal evidence suggests hundreds of requests per second are tolerable for well-behaved clients.
- No per-call cost beyond the $99/year Developer Program fee.
- Best practice: cache results in DynamoDB; avoid re-fetching known ISRCs.

#### Playlist handling
- **Catalog playlists** (Apple-curated, editorial, shared public playlists with `pl.` IDs) can be fetched by ID without a user token.
- **User library playlists** require OAuth and a Music User Token — out of scope for Eddi.
- Cross-service playlist matching: Apple Music does not have a playlist-by-ISRC equivalent. You would need to resolve each track in the Spotify playlist individually, then construct or identify the closest Apple Music playlist. No direct "find the Apple Music equivalent of this Spotify playlist" endpoint exists.

#### Restrictions / notes
- Storefront matters: a track available in the US catalog may not exist in other storefronts. Query the user's storefront or default to `us`.
- Multiple songs can be returned for a single ISRC (remasters, editions); take the first result or pick by name similarity.

---

### 2. Tidal

#### What it can do
- **ISRC lookup:** `GET /tracks?filter[isrc]={isrc}&countryCode={cc}` — returns matching tracks including track ID, title, duration, audio quality metadata, and ISRC.
- **Include relationships:** pass `include=albums,artists` to get album and artist data in the same call.
- **Playlist lookup:** `GET /playlists/{id}` — fetch a Tidal playlist by UUID. `GET /playlists/{id}/relationships/items` to get tracks.
- **Album lookup:** `GET /albums/{id}`.
- **Search:** available but ISRC is the preferred match.
- Track URLs follow the pattern: `https://tidal.com/browse/track/{id}`.

#### Accounts and registration
- Register at **developer.tidal.com** — open self-service signup, no invite required.
- Create an application to get a **Client ID** and **Client Secret**.
- New apps start in **Development mode** with a strict access quota (rate-limited, small-scale).
- To go to production scale, submit an **Application Review** request through the portal. No publicly stated approval criteria or SLA.
- Maximum 10 apps per developer account.

#### Auth model
- **Client Credentials** flow (OAuth 2.0, no user involvement needed for catalog reads).
- POST to Tidal's token endpoint with `client_id` + `client_secret` → receive an access token.
- Pass as `Authorization: Bearer {token}`.
- Token refresh is standard OAuth — handle expiry in Lambda.

#### Rate limits and cost
- Development mode: strict but undocumented quota. Suitable for testing; not for production volume.
- Production (post-review): higher limits, also not publicly documented.
- No per-call cost; free API access at both tiers.

#### Playlist handling
- Full playlist support: fetch playlist metadata and track list by Tidal playlist ID.
- Cross-service playlist matching: no direct "find a Tidal playlist equivalent to this Spotify playlist" endpoint. Track-by-track ISRC resolution is the only path.

#### Restrictions / notes
- Country code is required for most catalog endpoints.
- The official API reference lives at `tidal-music.github.io/tidal-api-reference/` — some previously documented links have broken; use the reference at that URL.
- Tidal has a first-party cross-platform sharing feature (powered by Feature.fm) but this is a consumer-facing tool, not a developer API.

---

### 3. YouTube Music

#### Official API status
**Google has no official YouTube Music API.** There is no MusicKit equivalent, no catalog ISRC lookup, no playlist resolution endpoint specifically for YouTube Music.

#### What actually exists
**Option A — YouTube Data API v3 (official, but limited)**
- Google's official API (`googleapis.com/youtube/v3`) covers YouTube broadly: search videos, channels, playlists.
- `GET /search?part=snippet&q={title}+{artist}&type=video` can locate a music video, but:
  - ISRC search returns no results via the API (even though ISRC is indexed in YouTube's own browser UI — a known bug/limitation).
  - Results are videos, not necessarily the "official audio" YouTube Music surfaces.
  - Free tier: **10,000 quota units/day** (a search costs 100 units → 100 searches/day free). This is very tight for a resolver.
  - Auth: API key (for public data) or OAuth. Free with a Google Cloud project.
  - Review: None required for read-only search; higher quota requires a Google Cloud quota increase request.

**Option B — Unofficial Node.js libraries**
- `ytmusic-api` (npm) — TypeScript, scrapes YouTube Music's internal endpoints, returns structured search results. Last updated actively as of early 2026. Supports `searchSongs()`, `searchAlbums()`, `searchPlaylists()`. No ISRC filter; fuzzy title+artist search only.
- `node-youtube-music` — similar approach, `searchMusics()` and `searchArtists()`.
- `youtube-music-api` — supports search types: song, video, album, artist, playlist.
- **Risk profile:** All unofficial libraries reverse-engineer internal APIs. Google can and does change internal endpoints without notice. This breaks libraries unpredictably. Violates YouTube ToS. Suitable for experimentation but fragile in a production Lambda.

**Option C — YouTube Music via Odesli (recommended)**
- Odesli's API returns a YouTube Music URL (`youtubeMusic` key) as part of its standard cross-service response. This is the lowest-risk path — let Odesli handle YTM resolution.

#### Recommendation for Eddi
Do **not** build a direct YouTube Music resolver. Rely on Odesli's response for YTM URLs. If Odesli doesn't return a YTM URL, leave the field null or fall back to a YouTube Data API v3 search (title + artist) as a best-effort.

---

### 4. Amazon Music

#### What it can do (on paper)
The Amazon Music Web API (documented at `developer.amazon.com/docs/music/`) supports:
- Metadata retrieval: albums, tracks, artists, playlists, podcasts.
- Deep links into the Amazon Music service.
- Playlist transfer (with user permission).
- Track URLs use Amazon ASINs: `https://music.amazon.com/albums/{ASIN}?trackAsin={trackASIN}`.
- Auth: OAuth 2.0 via "Login With Amazon" (LWA), requires `Authorization: Bearer {token}` + `x-api-key` header.

#### Current access status
**The Amazon Music Web API is in closed beta. Access is not publicly available.**

- Registration requires an existing Amazon Music point-of-contact (a business relationship).
- Developer community posts as of January 2026 confirm no timeline for public opening.
- No self-service signup path exists.
- The Device API (`developer.amazon.com/docs/music/API_browse_overview.html`) is separate — it is for Amazon hardware (Echo, Fire TV) integration, not general third-party use.
- An unofficial Python package (`amazon-music` on PyPI) exists but is based on reverse-engineered private endpoints and is extremely fragile.

#### Recommendation for Eddi
Amazon Music is **not feasible** via direct API access. Use Odesli's `amazonMusic` URL if available. Otherwise, leave null. Monitor developer.amazondeveloper.com for any public beta announcement.

---

## Cross-Service Databases and Open Standards

### Odesli / Songlink (song.link) — **Recommended Primary Strategy**

Odesli is a service that resolves any music URL (Spotify, Apple Music, Tidal, YouTube Music, Amazon Music, Deezer, etc.) to equivalent links across all major platforms in a single API call. It matches by ISRC and metadata.

**API details:**
- Base endpoint: `https://api.song.link/v1-alpha.1/links?url={spotify_url}`
- Also accepts: `?platform=spotify&type=song&id={spotifyId}`
- Returns a JSON object with `linksByPlatform` containing keys like `appleMusic`, `tidal`, `youtubeMusic`, `amazonMusic`, `spotify`, `deezer`, and others.
- Each platform entry includes a `url` (the direct link on that service) and `entityUniqueId`.
- Also returns `entitiesByUniqueId` with metadata (title, artist, thumbnail, ISRC if available).
- **Supports:** tracks, albums, and some playlists (playlists are harder — no universal ISRC for a playlist as a whole, but Odesli does attempt to match).

**Rate limits and cost:**
- Without API key: **10 requests/minute** — too slow for production.
- With API key: higher limits; key obtained by emailing `developers@song.link`. Free tier available; no stated pricing for paid tier.
- Contact: email `developers@song.link` for an API key.

**Playlist support:**
- Odesli supports album URLs and some playlist URLs (e.g., a Spotify playlist returns platform links where available).
- Playlist matching is approximate — there is no universal playlist ISRC, so cross-service "equivalent playlist" resolution is inherently fuzzy.

**Node.js wrapper:** `odesli.js` npm package exists for convenience.

### MusicBrainz

MusicBrainz is a free, open music encyclopedia with an API that supports ISRC lookup.

**API details:**
- ISRC lookup: `GET https://musicbrainz.org/ws/2/isrc/{isrc}?fmt=json`
  - Returns a list of recordings matching the ISRC.
- Recording lookup with URL relationships: `GET https://musicbrainz.org/ws/2/recording/{mbid}?inc=url-rels+isrcs&fmt=json`
  - The `url-rels` include parameter returns streaming URLs linked to the recording (Spotify, YouTube, Tidal, etc.). Coverage is incomplete — Apple Music and Amazon Music URLs are sparsely populated.
- Rate limit: **1 request/second per IP** (strictly enforced; exceeding results in 503s or temporary blocks).
- Auth: none required for read-only lookups. Meaningful `User-Agent` header mandatory (must include app name + version + contact URL/email).
- Cost: free.

**Usefulness for Eddi:**
- MusicBrainz URL relationships are crowd-sourced and inconsistently populated. Do not rely on them as primary resolution.
- Useful as a fallback metadata source or for enriching cache entries with MBID cross-references.
- The 1 req/sec rate limit makes it unsuitable as a high-throughput resolver step.

### ISRC as a Cross-Service Key

ISRC is the most reliable cross-service track identifier:
- Spotify returns it in `GET /v1/tracks/{id}` response under `external_ids.isrc` (still available as of March 2026 after a brief removal in Feb 2026).
- Apple Music accepts ISRC lookup natively.
- Tidal accepts ISRC lookup natively.
- MusicBrainz is indexed by ISRC.
- Odesli uses ISRC internally for matching.

**For albums and playlists:** there is no ISRC equivalent. Albums can sometimes be matched by UPC (also returned by Spotify in `external_ids.upc`), but Apple Music and Tidal don't offer UPC-based lookup. Playlist matching across services is fundamentally metadata-based (title + curator) and imprecise.

---

## Accounts Daniel Needs to Create

| Account | URL | Cost | Priority |
|---|---|---|---|
| Apple Developer Program | developer.apple.com | $99/year | **High** — needed for Apple Music API |
| Tidal Developer Portal | developer.tidal.com | Free | **High** — needed for Tidal API |
| Odesli API key | Email developers@song.link | Free (request) | **High** — needed for YTM, Amazon, and fallback |
| Google Cloud project | console.cloud.google.com | Free (within quota) | **Low** — only if direct YTM search is needed |
| Amazon Music (beta) | developer.amazon.com | N/A (invite-only) | **Skip for now** |
| MusicBrainz account | musicbrainz.org | Free | **Optional** — only needed if submitting data |

**For Apple Music:** After creating a Developer account, go to Certificates, Identifiers & Profiles → Identifiers → Register a New Identifier → MusicKit. Download the private key and note the Key ID and Team ID. Store the `.p8` key as a Lambda environment secret.

**For Tidal:** Register at developer.tidal.com, create an app, copy Client ID and Client Secret. Apply for an Application Review when ready for production volume.

**For Odesli:** Email developers@song.link with a brief description of Eddi (NFC music card product, server-side resolver, expected call volume). They provide a key informally with no stated SLA.

---

## Recommended Implementation Order

### Phase 1 — Immediate (Week 1–2)

**Step 1: Spotify ISRC extraction**
The card-write flow already has a Spotify URL. Before hitting any other service, call `GET /v1/tracks/{id}` (client credentials flow, no user token needed) to extract `external_ids.isrc` and `external_ids.upc`. Store both in DynamoDB.

> Note: Spotify's February 2026 Dev Mode changes restrict to 5 test users and require a Premium account for the app owner. `GET /v1/tracks/{id}` itself is not removed — it is still available. For production scale you need Extended Quota Mode (requires 250K MAU + registered business). In the short term, client credentials catalog lookups should still function for server-side use.

**Step 2: Apple Music ISRC lookup**
With the ISRC from Step 1:
```
GET https://api.music.apple.com/v1/catalog/us/songs?filter[isrc]={isrc}
Authorization: Bearer {devJWT}
```
Take `data[0].attributes.url` as the Apple Music link. Cache to DynamoDB.

**Step 3: Tidal ISRC lookup**
```
GET https://openapi.tidal.com/v2/tracks?filter[isrc]={isrc}&countryCode=US&include=albums
Authorization: Bearer {clientCredToken}
```
Construct URL as `https://tidal.com/browse/track/{data[0].id}`. Cache to DynamoDB.

**Step 4: Odesli call**
Pass the original Spotify URL to Odesli:
```
GET https://api.song.link/v1-alpha.1/links?url={encodedSpotifyUrl}&key={apiKey}
```
Extract `linksByPlatform.youtubeMusic.url` and `linksByPlatform.amazonMusic.url`. Use these to populate YTM and Amazon fields. Also use as a cross-check/fallback for Apple Music and Tidal if the direct ISRC lookups return nothing.

**Cache strategy:** After successful resolution, write all four platform URLs + ISRC + UPC to `eddi-isrc-cache` with the ISRC as the primary key. On subsequent card writes with the same Spotify track, skip API calls and serve from cache.

### Phase 2 — Albums (Week 3–4)

Album URLs from Spotify contain an album ID. Use `GET /v1/albums/{id}` to get the album UPC (`external_ids.upc`). Then:
- Apple Music: `GET /v1/catalog/us/albums?filter[upc]={upc}` (Apple supports UPC filtering).
- Tidal: UPC filter not documented — fall back to Odesli with the Spotify album URL.
- Odesli: handles album URLs natively, returns per-platform album links.

### Phase 3 — Playlists (Week 5+)

Playlists have no ISRC or UPC equivalent. The resolution strategy is inherently approximate:

1. **Odesli first:** Pass the Spotify playlist URL to Odesli. It attempts to find matching playlist pages on other services (results are hit-or-miss).
2. **No direct match:** Store whatever Odesli returns. For Apple Music and Tidal, a playlist resolver would require fetching all tracks, resolving each by ISRC, then creating or linking a playlist — this is a user-OAuth flow, not server-side, and is out of scope without user accounts on each service.
3. **Practical outcome:** For playlists, Eddi will likely surface a "best effort" deep link or fall back to a search URL on each platform.

### Phase 4 — YouTube Music (Deferred)

If Odesli's `youtubeMusic` field is reliably populated (test this in Phase 1), no additional work is needed. If YTM coverage is poor:
- Implement a YouTube Data API v3 search (`/search?part=snippet&q={title}+{artist}&type=video&videoCategoryId=10`) as a fallback. 10,000 quota units/day = ~100 searches free, so request a quota increase from Google Cloud if volume requires.
- Do **not** use unofficial YTM scraping libraries in production.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Spotify Extended Quota Mode blocked (250K MAU gate) | Medium | High | App already has Spotify credentials from card-write flow; ISRC extraction is the only Spotify call — assess if it's still permitted in dev mode |
| Apple Music JWT rotation forgotten | Low | High | Automate token regeneration via EventBridge + Secrets Manager rotation |
| Tidal App Review rejected or delayed | Low | Medium | Ship in dev mode first; volume at launch is low |
| Odesli API key not granted or revoked | Low | Medium | Odesli is fallback only; primary resolution via direct APIs |
| YouTube Music unofficial lib breaks | High | Low | Not using unofficial libs; YTM via Odesli only |
| Amazon Music beta never opens | Medium | Low | Odesli provides Amazon URLs as fallback |
| ISRC missing from Spotify response | Low | Medium | Fall back to title+artist search on Apple Music and Tidal |
| Multiple ISRCs per track (remasters) | Medium | Low | Take first result; store all candidates in DynamoDB |

---

## Sources

- [Apple Music API — Get Multiple Catalog Songs by ISRC](https://developer.apple.com/documentation/applemusicapi/get-multiple-catalog-songs-by-isrc)
- [Apple Music API Overview](https://developer.apple.com/documentation/applemusicapi/)
- [Apple MusicKit — Generating Developer Tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens)
- [Tidal Developer Portal — Authorization](https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization)
- [Tidal Developer Portal — Manage Apps](https://developer.tidal.com/documentation/api-sdk/api-sdk-manage-apps)
- [Tidal Web API Reference](https://tidal-music.github.io/tidal-api-reference/)
- [Tidal — How to Get a Track by ISRC](https://github.com/orgs/tidal-music/discussions/26)
- [YouTube Music API status (Musicfetch)](https://musicfetch.io/services/youtube-music/api)
- [ytmusicapi — Unofficial Python API](https://ytmusicapi.readthedocs.io/)
- [ytmusic-api npm package](https://www.npmjs.com/package/ytmusic-api)
- [YouTube Music ISRC search broken in yt-dlp](https://github.com/yt-dlp/yt-dlp/issues/15389)
- [Amazon Music Web API Overview](https://developer.amazon.com/docs/music/API_web_overview.html)
- [Amazon Music API — Closed Beta community thread](https://community.amazondeveloper.com/t/any-idea-when-the-api-in-closed-beta-will-be-open/25269)
- [Odesli/Songlink API (PublicAPI.dev)](https://publicapi.dev/songlink-odesli-api)
- [odesli.js Node.js wrapper](https://github.com/MattrAus/odesli.js/)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz API Rate Limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [musicbrainz-api npm package](https://www.npmjs.com/package/musicbrainz-api)
- [Spotify Web API — Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track)
- [Spotify February 2026 Migration Guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
- [Spotify Quota Modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify February 2026 Changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
- [Spotify March 2026 Changelog (external_ids reverted)](https://developer.spotify.com/documentation/web-api/references/changes/march-2026)
- [Tidal cross-platform sharing announcement](https://support.tidal.com/hc/en-us/articles/23553629074193-Sharing-music-links-across-streaming-platforms)
