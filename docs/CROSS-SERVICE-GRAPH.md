# Cross-Service Graph (V1) — the music bridge

_Decided 2026-05-31: build the piping now, decide the framing later._

Eddi is the only service-agnostic node in music. Every card is an **ISRC recipe**,
not a Spotify-thing or Apple-thing — so Eddi inherently sits *between* the walled
gardens and can see what no single service can: that the same music is engaged
with across all of them.

## V1 vs V2 (decided: V1)

- **V1 — anonymous cross-service graph.** Aggregate engagement by recording and
  by card, across services, with **no user identity**. "This song is big on
  Apple AND Spotify." Pure upside, no privacy/auth exposure, on-brand. **This is
  what we build toward.**
- **V2 — social graph** (connect the *people* across services). Requires
  persistent identity + consent and cuts against the anti-ecosystem-capture
  positioning. **A deliberate company-shaping fork, not a feature. Not now.**

Keep the bridge about the **music**, not the **people**.

## Two aggregations — capture both, frame later

We log enough to roll up engagement **both** ways; how we surface it is a later
product/marketing call (cheap to keep both):

- **By card** (`card_id`) — "this specific Eddi card is loved across services."
  The social-proof the *device* can surface when it reads a card.
- **By recording** (`content_key` = ISRC/UPC) — "this *song* transcends
  services." The discovery/bridge graph. A song lives across many cards; this
  rolls them up.

## Piping built 2026-05-31 (additive, no refactor later)

The whole point was to add the join keys now so V1 is a *query*, not a migration:

1. **`isrc` / `upc` persisted on the card.** The resolver already extracted them;
   now `resolveAllServices` returns them, `card-write` threads them through
   `createCard`, and they're stored on the card record + in the shared `Card`
   type (backend, app, web).
2. **`content_key` stamped on each event.** `event-log` accepts and stores it;
   the app's `logEvent` sends the card's ISRC/UPC on `service_open`. Events now
   roll up by recording, not just by card.
3. **Event taxonomy reserved.** Documented in `event-log`:
   `card_open`, `service_open`, `library_save` (save-to-library feature),
   `device_play` (the Eddi device). `library_save` + `device_play` aren't emitted
   yet — defining them now means those features just emit an already-understood
   event.

Everything is optional/backward-compatible: cards written before the resolver
populated `isrc` simply have no key, and a Spotify-only card still logs exactly
as before.

## Known cleanup (not blocking)

The **web app uses a different event taxonomy** (`tap | play | share | duplicate
| write`) than the app + backend (`card_open | service_open | ...`). Pre-existing
inconsistency. Reconcile into one shared taxonomy when the cross-service
analytics rollup is actually built — flagged in `web/src/types/card.ts`.

## What V1 needs next (when we build the rollup)

- A nightly/streamed aggregation: scan `eddi-card-events` → group by
  `content_key` and by `card_id` → counts per `service_selected` + `event_type`.
  Store rollups (own table or recompute). The raw events table has a 30-day TTL,
  so rollups must persist the aggregate.
- Then surface: card page social proof, device "most-saved across services,"
  cross-service "also tapped" discovery.
