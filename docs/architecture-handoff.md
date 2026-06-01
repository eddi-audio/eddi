# Eddi Audio — Linktree Card Page Build Brief

## What you're building

A web page at `eddi.audio/c/{id}` — one page per Eddi card. This is the most important page in the entire Eddi ecosystem. Every NFC card ever made points here as its first NDEF record.

## What is Eddi

Eddi Audio is a physical music player. You slide an NFC card into a slot and it plays audio from whatever streaming service you already use. Pull the card out, it stops. The device has a small display, physical knobs, an LED matrix — but it is not a screen-forward product. It's a single-purpose listening device.

**Company:** Eddi Audio, Inc. (Delaware C-corp)
**Tagline:** "Listen purposefully."
**Domains:** eddi.audio (primary), eddiaudio.com (secondary)
**Brand handle:** @eddiaudio

The product is anti-walled-garden by design. Cards are open NFC (NTAG215), service-agnostic, and user-writable. The device works without Eddi's servers. If the company disappeared, every device and card still functions.

## What this page does (triple duty)

Every card has an ID. Every card's first NDEF record is a URL: `eddi.audio/c/{id}`. This page serves three audiences simultaneously:

### 1. Play surface
Anyone with a phone can tap an Eddi card (or receive the link) and play the content on their own streaming service. The page must offer playback links for every service the card has URIs for. The card data contains direct URIs for some or all of: Spotify, Apple Music, YouTube Music, Amazon Music, Tidal.

### 2. Brand introduction
Many people who land on this page will have never heard of Eddi. They tapped a card someone handed them, or found one in a magazine, or got it in the mail. This page is how they discover the product. It needs to introduce Eddi — what it is, what the device does — without being a hard sell. The card experience they just had IS the pitch.

### 3. Card attribution
If the card was made by a user (not an official Eddi card), the page credits the maker. Cards are made to be passed around — shared, lent, gifted, traded. The maker gets credit on the page.

## Why this page matters to the business

**The card works without the device.** Anyone with a phone can tap any Eddi card and use this page. They don't need to own an Eddi player. This makes the card a standalone marketing vehicle:

- Magazine inserts — a card stuck to a cover, tap it, get a playlist
- Direct mail — card in an envelope
- Event/concert giveaways
- Brand partnerships with artists, labels, podcasters
- Influencer seeding

The card costs pennies. Every one is a physical sample of the Eddi experience. The device is the upgrade. And the linktree page is always `eddi.audio` — every tap is brand exposure.

**Propagation is the marketing channel.** Cards circulate like CDs once did. Every hand they pass through lands someone new on this page.

## Card data model

Each card is an NTAG215 NFC card. The data is written in NDEF format with multiple records:

- **Record 1:** URL — `eddi.audio/c/{id}` (this page)
- **Records 2+:** Service URIs — direct deep links to the content on each streaming service

Example service URIs:
- Spotify: `spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE` or `https://open.spotify.com/album/...`
- Apple Music: `https://music.apple.com/album/...`
- YouTube Music: `https://music.youtube.com/playlist?list=...`
- Amazon Music: `https://music.amazon.com/albums/...`
- Tidal: `https://tidal.com/album/...`

The device reads the card, finds a URI matching the user's connected service, and plays it. This page does the same thing for phones — presents all available services and lets the user pick.

## Card server / backend

There needs to be a server-side component. Each card ID maps to a record that stores:

- Card ID
- Content metadata (title, description, maker)
- Service URIs (the same ones on the physical card)
- Card art / visual (see aesthetic section below)
- Maker attribution (if user-created)
- Card type (official Eddi / user-created / Eddi Currents subscription)

**P1 requirement:** Every card placement on a device should trigger server reconciliation — the device reports the service URIs it read from the card, and the server updates the linktree page to match. This keeps the web page in sync with whatever is actually on the physical card, even if the card has been rewritten.

**Open question (do not solve, just be aware):** Whether card plays should be tied to user accounts for analytics. There is a tension between tracking (useful for business intelligence, card replacement, subscription metrics) and the no-ecosystem-capture positioning.

## Page requirements

### Functional
- Display the content title, description, and card art
- Present playback buttons for each streaming service the card has URIs for
- Deep link into the native app if installed, fall back to web player
- Show card maker attribution if user-created
- Introduce Eddi Audio to first-time visitors (what the device is, link to learn more / buy)
- Responsive — works on any phone (this is primarily a mobile surface, people are tapping physical cards)
- Fast — sub-second render. People just tapped a card, the feedback loop needs to feel instant.

### Not required for v1
- User accounts or login
- Playback on the page itself (we link out to services)
- E-commerce / purchase flow (link to main site)
- Card writing (that's the app)

## Brand and aesthetic direction

### Device brand
- **Tagline:** "Listen purposefully."
- **Design language:** industrial, not toy-like. Steel, powder coat, Torx fasteners, felt-lined card slot. The device looks like equipment, not a gadget.
- **Anti-corporate.** Warm, human, intentional. Not slick startup, not minimalist tech.

### Card aesthetic
The visual identity for cards evokes the **burned CD era** — deliberately anti-corporate. Six categories of card art identified:

1. **Pure Sharpie / Utility First** — handwritten text, track listing, raw
2. **Doodler** — drawings, doodles, characters
3. **Tracklist / Liner Notes** — formatted track listings, credits
4. **Collage / Zine** — cut-and-paste, mixed media
5. **Title Card** — bold text, minimal design
6. **Colored Sharpie Artist** — colorful hand-drawn art

We deliberately avoid using Spotify-sourced album art on cards — both for licensing reasons and to build Eddi's own visual identity.

### Color and typography
TBD — no formal brand guidelines yet. The page should feel warm and intentional, not cold-tech. The card art is the hero of the page, not chrome around it.

## Subscription service context

Eddi has a card subscription service called **Eddi Currents** with the tagline **"Stay Current."**

The name comes from eddy currents (the electromagnetic phenomenon that makes NFC work) + "stay current" (stay up to date). The subscription sits in a lineage: radio → Now That's What I Call Music → Apple Charts → Discover Weekly → Eddi Currents.

Subscription cards (Eddi Currents cards) land on the same `eddi.audio/c/{id}` page as any other card. They may have distinct visual treatment but use the same infrastructure.

## Target audience for this page

This page is hit by everyone, across all segments:

- **Gen Alpha** — kids in screen-conscious households (parents tapping for them)
- **Gen Z** — tactile-media revival cohort, vinyl/cassette collectors
- **Parents** — the "Intentional Parent" buying for kids
- **Elderly** — audiobooks, books-on-tape, accessibility

The page needs to work for all of them. No age-gating, no demographic targeting on the page itself. Universal.

## Tech stack context

- **Hosting:** Cloudflare Pages
- **Domain:** eddi.audio (Cloudflare DNS)
- **Current state:** mbar.app is a PHP/LAMP POC on Digital Ocean that will be deprecated. The linktree page replaces part of what mbar.app does.
- **App stack (for context, not this build):** Cross-platform mobile via Expo / React Native. Separate web stack for marketing + store.

## What "done" looks like

A page at `eddi.audio/c/{id}` that:
1. Loads fast on mobile
2. Shows the card's content with art and metadata
3. Gives clear, tappable buttons to play on each available streaming service
4. Introduces Eddi to people who don't know what it is
5. Credits the card maker if applicable
6. Looks good enough to be the first impression of the brand for thousands of people who've never heard of Eddi
7. Has a backend that stores card data and can be updated by device reconciliation

This is the front door. Every card ever made knocks on it.
