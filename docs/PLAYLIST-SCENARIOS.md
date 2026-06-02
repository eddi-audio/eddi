# Playlist & Card Access — Every Scenario (and how to reduce friction)

_Last verified live 2026-06-02 against the Spotify API with a real user token._
_Companion to the Notion artifact "Spotify Web API Access Model — definitive."_

This maps every way someone might card music, what actually works, the friction,
and the mitigation options — so we can decide where to invest vs. where to accept
a limit.

---

## First principles (the two things people conflate)

**1. PLAYING a card never needs a token or API call — ever.**
A card stores plain HTTPS links (`open.spotify.com/...`, `music.apple.com/...`)
in its NFC records + on the `eddi.audio/c/{id}` page. Tap → the OS opens the app
to that link. This works for ANY content — your playlist, a stranger's, an
editorial one — forever, even if Eddi's servers are off. **No auth, no expiry.**

**2. The only place auth matters is WRITE time, to READ a playlist's tracks** so
we can build the *other-service* buttons (Apple/Tidal/YT). That read is the gated
thing. And it's a **one-time login** — see "Token lifecycle" below.

So the entire "playlist problem" is narrowly: *"to put cross-service buttons on a
playlist card, we must read its tracklist, and Spotify only lets us read
playlists the logged-in user owns."* Everything below is about that one read.

---

## Token lifecycle — users log in ONCE (not hourly)

- **Access token** = short-lived (1 hour). This is what looked painful in testing.
- **Refresh token** = issued once at login; silently mints new access tokens
  forever. The user authorizes Spotify **one time**; never sees it again.
- In Eddi's no-account model the refresh token lives in the **app's local session
  / device keychain**, not an Eddi server user-record. (Open design note: a
  purely web write-flow has nowhere local to keep it — that path may need a
  per-session token or a minimal stored token. Decide per surface.)
- **Tap-to-play uses NO token at all.** Only writing-a-playlist-you-own does.

---

## Content-type matrix (what works, today, verified)

| Content | Play from card | Cross-service buttons | Friction |
|---|---|---|---|
| **Single track** | ✅ always | ✅ ISRC match (no login) | **None** — live now (Spotify+Tidal) |
| **Album** | ✅ always | ✅ UPC match (no login) | **None** — live now |
| **Playlist you OWN** | ✅ always | ✅ login once → read → resolve | **Low** — one-time Spotify login |
| **Playlist you FOLLOW / added to library** | ✅ always | ❌ 403 (not owner) | Spotify-only card |
| **Someone else's public playlist** | ✅ always | ❌ 403 (not owner) | Spotify-only card |
| **Spotify editorial** (`37i9…DX…`) | ✅ always | ❌ 404 (Spotify-owned) | Spotify-only card |
| **Spotify algorithmic** (Discover Weekly, `37i9…Fb…`) | ⚠️ plays, but it's a per-listener snapshot | ❌ 404 | see "the snapshot problem" |

**~80% coverage today:** tracks, albums, and own-playlists are the bulk of real
"I made you this" use. The gap is carding playlists you didn't make.

---

## VERIFIED access rules (tested 2026-06-02, not assumed)

Reading `/playlists/{id}/items` with a user token:

| Your relationship to the playlist | Result |
|---|---|
| **Own it** (you created it) | ✅ 200 — full tracklist + ISRCs |
| **Follow it / added to library / added to profile** | ❌ 403 |
| Public, someone else's | ❌ 403 |
| Editorial / algorithmic (owner = spotify) | ❌ 404 |

**The gate is the `owner` field.** Follow / library / "add to profile" create a
*reference* — they do NOT change ownership, so they do NOT unlock reads. Only
**duplicating** a playlist (Spotify's own "Make a copy") creates a new playlist
*you own* (new ID) that reads fine. Also blocked in Dev Mode: even your own
`/me/tracks` and `/me/albums` (library reads broadly locked); only single
`/tracks/{id}` catalog lookups and owned-playlist `/items` work.

---

## The snapshot problem (why editorial/algorithmic is genuinely different)

Two distinct issues, often conflated:

- **Access:** we can't read the tracklist (404). Hard wall.
- **Content nature:** an algorithmic playlist (Discover Weekly) is a *per-person,
  auto-refreshing snapshot*. Even if we could read it, "carding" it is
  conceptually odd — it's not a fixed object, it's a feed that wipes weekly.
  Editorial (Today's Top Hits) is fixed-ish but Spotify-curated and changes.

For these, the user usually wants a **frozen snapshot** — "capture THIS version
as a card." That's a real desire (the forums are full of "I wish I could save
Discover Weekly"). The question is whether we can deliver it compliantly.

---

## Friction-mitigation options (ranked, with honest tradeoffs)

### A. Card it as Spotify-only (zero build) — ⭐ RESOLVED DEFAULT for the 20%
Any non-owned/editorial playlist still makes a working card that opens+plays in
Spotify. Just no other-service buttons. **This is the always-available floor and
the decided default.**

**Governing principle (Decision Log 2026-06-02): writing a card must NEVER fail
or block on resolution.** Cross-service is enrichment around a write that already
succeeded — not a gate. So a non-owned playlist NEVER errors; it just becomes a
Spotify-only card.

**Gentle nudge (decided):** one optional, non-blocking line at write time —
*"Plays on Spotify. Want Apple/Tidal buttons too? Make your own copy in Spotify
first."* Sets expectation + offers the upgrade path. Never a wall, never required,
keep it to one line (don't explain Spotify's API politics to a normal user).

### B. Guided "duplicate → card" — RESOLVED 2026-06-02: must happen IN Spotify, Eddi can't do it
At write time, detect the playlist isn't owned by the logged-in user, and route
the user to duplicate it.

**Verified mechanism (no token re-test needed — derived from the API surface):**
- **There is NO Spotify duplicate/copy endpoint.** The in-app "Make a Copy" is a
  first-party Spotify UI action using Spotify's own privileged access — NOT
  exposed to the Web API.
- API "duplicate" = 3 manual steps: read source items → create playlist → add
  items. **Step 1 (read a non-owned playlist) is the 403 we already proved.**
  `playlist-modify` scope only lets you write to YOUR OWN playlists — it does
  NOT let you read someone else's to copy from.
- **Therefore Eddi CANNOT duplicate a non-owned playlist for the user via API.**
  No read, no copy endpoint, no bypass.

**The only compliant duplicate path:** the **user taps "Make a Copy" inside the
Spotify app** themselves (Spotify's own action, works on anything) → that yields
a NEW playlist they own (new ID) → they bring that link to Eddi → now Eddi can
read it (owned → 200) and card it with full cross-service buttons.

**UX shape:** "This isn't your playlist. To add Apple/Tidal buttons, make your
own copy in Spotify first → [Open in Spotify] → come back and paste the new
link." A few taps, in Spotify, fully compliant. Friction is real but unavoidable.
Note: in-app copy resets "date added" and is a point-in-time snapshot (fine for a
card — a card IS a snapshot).

### C. Embed scrape to snapshot (⚠️ ToS violation — do NOT ship)
`open.spotify.com/embed/playlist/{id}` returns the tracklist with no auth (works
even for editorial). Tempting for the snapshot use case. **But Spotify Developer
Terms §IV.2.2.4 prohibits automated retrieval via non-documented surfaces** —
risks app + credential termination. The established transfer tools that "just
work" have grandfathered extended access a new app can't get. **Rejected as a
shipped path.** (Noted only so we don't keep rediscovering it as a tempting idea.)

### D. Extended Quota Mode (long game)
Lifts the user cap and *may* restore broader reads, but bar = registered business
+ launched service + ~250k MAU, ~95% rejection. Not a near-term unblock, and it's
unclear it even lifts the owner-only playlist restriction (that's relationship-
based, not quota-based). Pursue when scaled; don't plan around it.

### E. Eddi-curated equivalents (product, not API)
For the "I want Today's Top Hits as a card" desire: Eddi Currents (the
subscription) can ship *Eddi's own* curated card packs that own their playlists →
fully readable, cross-service, and a frozen snapshot by design. Turns a Spotify
limitation into a subscription feature.

---

## Recommended posture

1. **Ship A + own-playlist resolution now** — covers ~80%, zero/low friction,
   fully built (OAuth deployed + verified).
2. **Build B (guided duplicate)** as the mitigation for "card someone else's
   playlist" — pending the open test (can the API duplicate, or must the user do
   it in-app). This covers most of the remaining 20% compliantly.
3. **Lean on E (Eddi Currents)** for editorial/curated desire — it's a feature,
   not a workaround.
4. **Never C.** Keep it documented-as-rejected so it stops resurfacing.

## Open questions to resolve (before finalizing the write flow)
- [ ] Can the Spotify API replicate in-app "Duplicate" (read+copy a non-owned
      playlist into the user's account via `playlist-modify`)? Or must the
      duplicate happen inside Spotify by the user? **Test with `playlist-modify` scope.**
- [ ] Web write-flow: where does the refresh token live without a device keychain?
- [ ] UX: how to explain "Spotify-only" honestly without making it feel broken.
