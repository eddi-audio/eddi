# Save to Your Library — cross-service playlist handoff

_Spec. Decided 2026-05-31. Not yet built — gated on per-service accounts._

How a card made on one service becomes a real, playable playlist in a
recipient's *own* account on a different service. This is the "seamless" path
for playlist cards. Builds on the ISRC resolver (`shared/resolver/`).

## The scenario

Daniel makes a Spotify playlist, writes it to an Eddi card. His wife taps it
with her iPhone; she only has Apple Music. She should be able to play that
playlist gracefully — as an actual playlist, in her library, hers to keep.

## The model — "transfer," not "host" (decided)

We do **not** host playlists on Eddi-owned accounts (rejected: account bloat,
TTL teardown is hostile to anyone relying on the link, ToS churn from
create/delete cycling, and the playlist would show as created by "Eddi,"
erasing the real creator).

Instead we copy the transfer-tool pattern (Soundiiz / TuneMyMusic): **create the
playlist directly in the recipient's own account** via their OAuth, then walk
away. The recipient owns it; Eddi hosts nothing; nothing to tear down; it
survives Eddi dying. Aligns with the architecture's durability principle — the
durable artifact is the per-track ISRC recipe, the playlist object lives in the
user's library, not on Eddi.

## Three resolution tiers (by content type)

| Content | Path | Auth needed? |
|---|---|---|
| **Track / album** | One ISRC/UPC link per service. Already produced by the resolver. | No |
| **Playlist — "just play now"** | Card page shows the resolved tracklist; tap a song to play. No-auth fallback. | No |
| **Playlist — "save it"** | Create a named playlist in the recipient's own account, ISRC-matched. | Yes, one-time per service |

## "Save it" flow

1. Recipient on `eddi.audio/c/{id}` sees **"Add to Apple Music"** (their service).
2. First time only: native Apple auth popup (MusicKit JS user token). One tap.
3. Eddi creates a **named library playlist** from the ISRC recipe and adds the
   matched tracks.
4. Honest result: *"45 of 47 songs added to your Apple Music."*
5. It's now her playlist, in her app, permanently. No Eddi object, no expiry.

The one bit of friction — a single native auth popup per service — is consent,
not a barrier. It's exactly the pattern users have seen if they've ever moved
playlists between services.

## Suggested title (decided: **Attributed**, with the ∿ call-sign)

The create-playlist `name` is a field we set. We assemble a smart default from
the source playlist's name + original creator (the resolver already extracts
`ownerName` for attribution):

> **`{original name} ∿ from {creator}`** — e.g. `Road Trip 2026 ∿ from Daniel`

- **Separator is `∿`** (U+223F SINE WAVE), not an em dash — the wordless Eddi
  brand call-sign (audio/wave, echoes the E-mark), present inside the user's own
  library on every save. Valid Unicode; title fields accept it everywhere.
  Edge case: a device lacking the glyph shows □ — eyeball on real hardware when
  building. (Rare on modern iOS/Android music apps.)
- Lead with the **person**, not Eddi — a music gift's emotional core is the
  giver. Eddi is the courier, not the headline.
- **Description field** carries the durable backlink, not the title:
  *"Made by Daniel. Tap the original at eddi.audio/c/{id}."* Turns every saved
  playlist into a pointer back to the card.
- Let the user **edit the suggested title before confirming** — one tap to
  accept, or tweak. Seamless but not presumptuous.

> Never dump tracks into Liked Songs / saved-tracks — that scatters the gift into
> the user's existing library and it vanishes. Always a standalone named playlist.

## Per-service create-playlist support (VERIFY before building)

Read/ISRC-lookup is confirmed for resolution. **Playlist *creation* (write) is
separate and not all verified:**

| Service | Create playlist in user account | Notes |
|---|---|---|
| Apple Music | ✅ `POST /v1/me/library/playlists` (`attributes.name`) | MusicKit JS user token |
| Spotify | ✅ create-playlist (`name` required, `description` optional) | user OAuth |
| YouTube Music | ✅ via `ytmusicapi` create_playlist | unofficial, keep swappable |
| **Tidal** | ❓ **unverified** — public API may be read-only catalog | confirm before promising |
| Amazon Music | ❌ no public write API | omit; show tracklist fallback |

Services that can't create gracefully degrade to the "just play now" tracklist.

## Engine reuse

The ISRC resolver built 2026-05-31 already produces everything the create step
needs: per-track ISRCs (ordered), original playlist name, and creator. "Save to
library" = take that recipe → call the service's create-playlist API with the
recipient's user token. What's new vs. the resolver: per-service **write** calls
+ the on-card-page **user OAuth**.

## Gated on (Daniel)

- Apple Developer Program ($99/yr — also needed for iOS) → Apple Music
- Spotify user-OAuth app config (have Spotify creds; needs user-auth scopes)
- Tidal: verify create-playlist support
- Decide Amazon: omit at launch (recommended)
