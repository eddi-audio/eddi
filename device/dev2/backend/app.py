#!/usr/bin/env python3
# Flask backend for Cardcast NFC music player.
# Responsibilities:
#   - Maintain the currently-present NFC card state (set by nfc_reader.py)
#   - Provide a Spotify access token to the frontend (with caching to avoid revoking refresh tokens)
#   - Store optional card-to-URI mappings in card_mappings.json

from flask import Flask, jsonify, request
from flask_cors import CORS
import os
import re
import json
import time
import threading
import subprocess
import requests
from dotenv import load_dotenv

# Load SPOTIFY_CLIENT_ID, SPOTIFY_REFRESH_TOKEN, etc. from backend/.env
load_dotenv()

app = Flask(__name__)
CORS(app)  # Allow requests from the React frontend on port 3000

CLIENT_ID = os.getenv('SPOTIFY_CLIENT_ID')
REFRESH_TOKEN = os.getenv('SPOTIFY_REFRESH_TOKEN')
# Optional. If set (confidential app, e.g. the eddi.audio prod app), refreshes
# use HTTP Basic auth with the secret. If unset, refresh is PKCE-style
# (client_id only) — both are supported so either app can be configured.
CLIENT_SECRET = os.getenv('SPOTIFY_CLIENT_SECRET')

# Eddi backend that resolves new-format "linktree" cards (eddi.audio/c/{id}).
# nfc_reader.py reads the card id off the tag and posts it here; we resolve it
# to a playable Spotify URI (plus title/artwork) via GET {API_BASE}/cards/{id}.
API_BASE = os.getenv('EDDI_API_BASE',
                     'https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod')

# Token cache — Spotify rotates refresh tokens on every use and will revoke them
# if the same token is sent multiple times in quick succession. We cache the
# access token in memory and only call the refresh API once every 55 minutes.
# Flask runs multi-threaded, so a lock is required: without it, concurrent requests
# that all see an empty cache will all call Spotify simultaneously with the same
# refresh token, triggering multiple rotations and eventual revocation.
_cached_token = None
_token_fetched_at = 0
TOKEN_TTL = 55 * 60  # seconds — Spotify tokens last 60 min, refresh at 55
_token_lock = threading.Lock()  # ensures only one thread refreshes at a time

# In-memory state set by nfc_reader.py via POST /nfc/update
current_card_uid = None
current_spotify_uri = None
# Resolved metadata (title/type/artwork) for a new-format Eddi card, or None for
# legacy cards where we still fall back to card_mappings.json / Spotify lookup.
current_card_meta = None
# Eddi card id of the present card. Kept even when the resolve FAILS (e.g. a card
# left in the reader across a reboot, read before the network came up) so the
# background _resolve_retry_loop can finish resolving + play it with no re-tap.
current_eddi_card_id = None

# Cache of resolved Eddi cards: card_id -> {spotify_uri, name, type, artwork_url}.
# Card content is immutable, so once resolved we never need to hit the API again.
_card_cache = {}
_card_cache_lock = threading.Lock()

# Cache of Spotify item names looked up for legacy (non-Eddi) cards, keyed by
# spotify_uri, so the frequently-polled /nfc/current doesn't re-hit Spotify.
_name_cache = {}


def to_spotify_uri(value):
    """Normalise a Spotify share URL or URI to spotify:type:id, or None."""
    if not value:
        return None
    if value.startswith('spotify:'):
        return value
    match = re.search(
        r'open\.spotify\.com/(album|playlist|track|show|episode|artist)/([A-Za-z0-9]+)',
        value
    )
    return f"spotify:{match.group(1)}:{match.group(2)}" if match else None


def resolve_eddi_card(card_id):
    """
    Resolve a new-format Eddi card id to playable metadata via GET /cards/{id}.
    Returns {spotify_uri, name, type, artwork_url} or None if the card can't be
    resolved (404, no Spotify URI, or network error). Results are cached.
    """
    with _card_cache_lock:
        if card_id in _card_cache:
            return _card_cache[card_id]
    try:
        resp = requests.get(f'{API_BASE}/cards/{card_id}', timeout=8)
        if resp.status_code == 404:
            # Genuinely unlinked card — cache the miss so the resolve-retry loop
            # doesn't hammer the API for a dead id (vs. a transient network failure).
            print(f"Eddi resolve {card_id}: 404 (unlinked)", flush=True)
            with _card_cache_lock:
                _card_cache[card_id] = None
            return None
        if resp.status_code != 200:
            # Transient (5xx / gateway) — do NOT cache, so it retries.
            print(f"Eddi resolve {card_id}: HTTP {resp.status_code} (transient)", flush=True)
            return None
        card = resp.json()
        spotify_uri = to_spotify_uri((card.get('service_uris') or {}).get('spotify'))
        if not spotify_uri:
            print(f"Eddi card {card_id} has no Spotify URI", flush=True)
            with _card_cache_lock:
                _card_cache[card_id] = None
            return None
        result = {
            'spotify_uri': spotify_uri,
            'name': card.get('title', 'Unknown'),
            'type': card.get('content_type', 'playlist'),
            'artwork_url': card.get('artwork_url'),
            # Eddi data surfaced in the dev2 player's "Current Card" panel.
            'tap_count': card.get('tap_count'),
            'track_count': card.get('track_count'),
            'attribution': card.get('source_attribution') or card.get('created_by_display'),
            'description': card.get('description'),
            'artwork_palette': card.get('artwork_palette'),
        }
        with _card_cache_lock:
            _card_cache[card_id] = result
        print(f"Resolved Eddi card {card_id} -> {spotify_uri} ({result['name']})", flush=True)
        return result
    except Exception as e:
        # Network error / timeout (e.g. no link yet at boot) — do NOT cache, so the
        # resolve-retry loop tries again once connectivity returns.
        print(f"Eddi resolve error for {card_id}: {e} (transient)", flush=True)
        return None


def save_refresh_token(new_token):
    """
    Persist a rotated refresh token back to .env.
    Spotify PKCE issues a new refresh token on every use and invalidates the old one.
    If we don't save the new one immediately, the next refresh will fail.
    """
    global REFRESH_TOKEN
    REFRESH_TOKEN = new_token  # update in-memory value right away
    try:
        env_path = os.path.join(os.path.dirname(__file__), '.env')
        lines = []
        replaced = False
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    if line.startswith('SPOTIFY_REFRESH_TOKEN='):
                        lines.append(f'SPOTIFY_REFRESH_TOKEN={new_token}\n')
                        replaced = True
                    else:
                        lines.append(line)
        if not replaced:
            lines.append(f'SPOTIFY_REFRESH_TOKEN={new_token}\n')
        with open(env_path, 'w') as f:
            f.writelines(lines)
        print(f"Refresh token updated in .env", flush=True)
    except Exception as e:
        print(f"Failed to save refresh token: {e}", flush=True)


def safe_json(resp):
    """Parse a response body as JSON, returning None on a malformed/empty body instead of
    raising. Spotify (or a captive portal / proxy) occasionally returns 200 with non-JSON; an
    unguarded resp.json() would 500 a request thread — or, worse, silently kill a daemon thread
    mid-task (e.g. the card-removal pause)."""
    if resp is None:
        return None
    try:
        return resp.json()
    except Exception:
        return None


def get_access_token():
    """
    Return a valid Spotify access token.
    Uses a 55-minute in-memory cache so we only call Spotify's API once per hour.

    The lock is critical: Flask is multi-threaded, so without it, concurrent requests
    that all see an empty/expired cache will all call Spotify simultaneously with the
    same refresh token. Spotify rotates the token on each use — multiple concurrent
    calls with the same token create a branching rotation chain that Spotify eventually
    detects and revokes entirely. The lock ensures only one thread refreshes at a time.
    """
    global _cached_token, _token_fetched_at

    # Fast path: return cached token without acquiring the lock
    if _cached_token and (time.time() - _token_fetched_at) < TOKEN_TTL:
        return _cached_token

    # No refresh token means we can't get a new access token
    if not REFRESH_TOKEN:
        return os.getenv('SPOTIFY_ACCESS_TOKEN')

    # Slow path: acquire lock, then re-check cache (another thread may have
    # already refreshed while we were waiting for the lock)
    with _token_lock:
        if _cached_token and (time.time() - _token_fetched_at) < TOKEN_TTL:
            return _cached_token  # Another thread already refreshed — use its result

        try:
            # Exchange the refresh token for a new access token. Confidential apps
            # (CLIENT_SECRET set) authenticate via HTTP Basic; public/PKCE apps
            # send the client_id in the body instead.
            data = {'grant_type': 'refresh_token', 'refresh_token': REFRESH_TOKEN}
            auth = None
            if CLIENT_SECRET:
                auth = (CLIENT_ID, CLIENT_SECRET)
            else:
                data['client_id'] = CLIENT_ID
            response = requests.post('https://accounts.spotify.com/api/token',
                                     data=data, auth=auth)

            print(f"Token refresh response: {response.status_code}", flush=True)

            if response.status_code == 200:
                data = response.json()
                token = data['access_token']
                print(f"Got new token: {token[:20]}...", flush=True)
                _cached_token = token
                _token_fetched_at = time.time()
                # Spotify may issue a new refresh token — save it immediately if so
                if 'refresh_token' in data:
                    save_refresh_token(data['refresh_token'])
                return token
            else:
                print(f"Token refresh failed: {response.text}", flush=True)
        except Exception as e:
            print(f"Token refresh error: {e}", flush=True)

    # If refresh failed, return whatever we have (may be expired but better than nothing)
    return _cached_token or os.getenv('SPOTIFY_ACCESS_TOKEN')


# ─── Playback control ────────────────────────────────────────────────────────
# Audio is rendered by the OFFICIAL Spotify Web Playback SDK in the kiosk browser
# (Chromium → PipeWire → amp); we use the official SDK because librespot (an
# unofficial client) is refused audio keys on this new account. The backend
# starts/stops playback via the Spotify Web API, targeting the EXACT SDK device
# id the frontend registers (see /spotify/device) — never by matching a device
# *name*, because stale offline registrations (old SDK sessions, the retired
# librespot) linger in Spotify's device list under the same name "Eddi" and
# targeting one by name would play to a dead device.

# Remember where each card was when it was removed so re-placing the same card
# resumes instead of restarting. Keyed by spotify_uri.
_resume_state = {}
_resume_lock = threading.Lock()
RESUME_TTL = 6 * 60 * 60  # seconds a saved position stays valid


def _spotify_headers():
    return {'Authorization': f'Bearer {get_access_token()}',
            'Content-Type': 'application/json'}


# ─── Browser Web Playback SDK device registration ───────────────────────────
# The audio renderer is the OFFICIAL Spotify Web Playback SDK running in the
# kiosk browser (Chromium → PipeWire → amp). We use the official SDK because
# librespot (an unofficial client) is refused audio keys on this new account.
# The frontend POSTs its SDK device id to /spotify/device on 'ready'; the backend
# targets that device for play/pause.
_sdk_device_id = None
_last_registered_id = None   # last DISTINCT device id seen — lets us tell a page reload
                             # (new id → orphaned playback, resume the card) from a
                             # same-device reconnect (Spotify resumes on its own).
_sdk_lock = threading.Lock()


def get_target_device():
    """The exact browser SDK device id the frontend registered, or None if the
    kiosk hasn't reported 'ready' yet. We never fall back to name matching — a
    name like "Eddi" can resolve to a stale/offline zombie device."""
    with _sdk_lock:
        return _sdk_device_id


# ─── Rate-limit guard ────────────────────────────────────────────────────────
# Spotify dev-mode apps get a rolling-window quota; exceeding it returns 429 with
# a Retry-After (which can be HOURS). All backend→Spotify calls go through
# spotify_request(), which honors the cooldown and refuses to call again until it
# passes — so a burst can never escalate into a multi-hour lockout. (The frontend
# no longer calls Spotify directly at all; that 1s /me/player poll is what caused
# the original lockout.)
_rate_limited_until = 0


# Live reachability flag — True after a successful Spotify call, False after a transient
# call fails all its retries. Surfaced via /net/status to drive the offline UI.
_spotify_online = True


def spotify_request(method, url, retries=2, **kwargs):
    """
    Single choke point for backend→Spotify Web API calls. Honors 429/Retry-After and
    RETRIES transient network errors (DNS/connection/timeout) with backoff before giving
    up — so a brief WiFi blip self-heals instead of failing the call. Returns a
    requests.Response, or None if we're in a cooldown or the call errored after retries.
    """
    global _rate_limited_until, _spotify_online
    now = time.time()
    if now < _rate_limited_until:
        print(f"[spotify] in 429 cooldown ({int(_rate_limited_until - now)}s left); skipping {method} {url}", flush=True)
        return None
    kwargs.setdefault('timeout', 8)
    headers = kwargs.pop('headers', None) or _spotify_headers()
    last_exc = None
    for attempt in range(retries + 1):
        try:
            resp = requests.request(method, url, headers=headers, **kwargs)
            _spotify_online = True
            if resp.status_code == 429:
                retry = int(resp.headers.get('Retry-After', '30'))
                _rate_limited_until = time.time() + retry
                print(f"[spotify] 429 — backing off {retry}s", flush=True)
            return resp
        except (requests.ConnectionError, requests.Timeout) as e:
            last_exc = e  # transient (incl. DNS NameResolutionError) — back off and retry
            if attempt < retries:
                time.sleep(0.5 * (2 ** attempt))
        except Exception as e:
            last_exc = e  # non-transient — don't retry
            break
    _spotify_online = False
    print(f"[spotify] {method} {url} failed after {retries + 1} tries: {last_exc}", flush=True)
    return None


# A card whose play fired before the SDK device existed (e.g. it was already on the
# reader at boot). register_device() plays this the moment the device shows up, then
# clears it. Only the *pending* card replays — so a WiFi-blip reconnect won't restart
# a track that's already playing.
_pending_card_uri = None
_pending_lock = threading.Lock()


def set_pending(uri):
    global _pending_card_uri
    with _pending_lock:
        _pending_card_uri = uri


def take_pending():
    """Atomically read + clear the pending card (avoids the SDK-reconnect race)."""
    global _pending_card_uri
    with _pending_lock:
        uri = _pending_card_uri
        _pending_card_uri = None
        return uri


def play_on_connect(spotify_uri):
    """
    Start playback of a card's URI on the target device — the browser Web Playback
    SDK device the frontend registered (preferred), else name-based discovery.
    Honours a saved resume position if the same card was just removed.
    """
    global _sdk_device_id
    device_id = get_target_device()
    if not device_id:
        print("No target device yet (SDK not ready) — queuing to play on device register", flush=True)
        set_pending(spotify_uri)
        return
    take_pending()  # we have a device and are handling the current card now

    is_track = spotify_uri.startswith('spotify:track:')
    body = {'uris': [spotify_uri]} if is_track else {'context_uri': spotify_uri}

    with _resume_lock:
        saved = _resume_state.pop(spotify_uri, None)
    if saved and (time.time() - saved['ts']) < RESUME_TTL:
        if is_track:
            body = {'uris': [spotify_uri], 'position_ms': saved['position_ms']}
        else:
            body = {'context_uri': spotify_uri,
                    'offset': {'uri': saved['track_uri']},
                    'position_ms': saved['position_ms']}

    # Runs in a daemon thread (_play_async), so we can block and retry: self-heal a
    # transient WiFi/DNS outage over ~30s instead of stranding the card at the splash.
    play_url = f'https://api.spotify.com/v1/me/player/play?device_id={device_id}'
    for attempt in range(6):
        resp = spotify_request('PUT', play_url, data=json.dumps(body))
        if resp is not None and resp.status_code in (202, 204):
            print(f"[Play] {spotify_uri} on {device_id}", flush=True)
            return
        if resp is not None and resp.status_code == 404:
            # Stale SDK device id (browser reloaded) — drop it; the frontend re-registers
            # on its next 'ready' and we replay the pending card then.
            print("[Play] 404 — target device stale; clearing (frontend will re-register)", flush=True)
            with _sdk_lock:
                _sdk_device_id = None
            set_pending(spotify_uri)
            return
        if resp is not None:
            print(f"[Play] failed {resp.status_code}: {resp.text}", flush=True)
            return
        if current_spotify_uri != spotify_uri:
            return  # a different card was tapped while we were retrying
        print(f"[Play] no response (network/cooldown) — retry {attempt + 1}/6 in 5s", flush=True)
        time.sleep(5)
    set_pending(spotify_uri)  # gave up for now; a device re-register will replay it
    print(f"[Play] gave up after retries; left pending: {spotify_uri}", flush=True)


def save_resume_and_pause(spotify_uri):
    """
    Capture the current playback position for resume (keyed by the removed
    card's URI), then pause the Connect device via the Web API.
    """
    resp = spotify_request('GET', 'https://api.spotify.com/v1/me/player')
    d = safe_json(resp) if (resp is not None and resp.status_code == 200 and resp.content) else None
    if d:
        item = d.get('item') or {}
        if spotify_uri and item.get('uri'):
            with _resume_lock:
                _resume_state[spotify_uri] = {
                    'track_uri': item['uri'],
                    'position_ms': d.get('progress_ms', 0),
                    'ts': time.time(),
                }
    # Target the SDK device explicitly (like play does). A bare /pause hits the "active"
    # device, which the Web API often reports as none even while the SDK is playing → 404,
    # so the music never pauses on card removal.
    device_id = get_target_device()
    pause_url = 'https://api.spotify.com/v1/me/player/pause'
    if device_id:
        pause_url += f'?device_id={device_id}'
    pr = spotify_request('PUT', pause_url)
    if pr is not None:
        print(f"[Pause] status {pr.status_code} (device {device_id or 'active'})", flush=True)


def _play_async(uri):
    """Fire playback in a thread so the reader's POST /nfc/update returns fast."""
    threading.Thread(target=play_on_connect, args=(uri,), daemon=True).start()


def _pause_async(uri):
    threading.Thread(target=save_resume_and_pause, args=(uri,), daemon=True).start()


def load_card_mappings():
    """Load the card UID → Spotify URI mapping file (card_mappings.json)."""
    try:
        with open('card_mappings.json', 'r') as f:
            return json.load(f)
    except:
        return {}


def save_card_mappings(mappings):
    """Persist the card UID → Spotify URI mapping file."""
    with open('card_mappings.json', 'w') as f:
        json.dump(mappings, f, indent=2)


# Frontend liveness heartbeat: the kiosk polls /nfc/current every ~2-3s. The kiosk
# watchdog reloads Chromium if these stop — a wedged/white render is still a live
# process, so the autostart's exit-relaunch loop alone can't catch it.
_last_frontend_seen = time.time()


@app.route('/health')
def health():
    """Liveness for the kiosk watchdog — seconds since the frontend last polled."""
    return jsonify({"frontend_idle_s": int(time.time() - _last_frontend_seen)})


@app.route('/nfc/current')
def get_current_card():
    """
    Return the currently present NFC card and its associated Spotify URI.
    Called by the frontend every 3 seconds.
    Priority for the URI: card NDEF data > card_mappings.json entry.
    If we have a URI but no saved name, fetch the name from the Spotify API.
    """
    global _last_frontend_seen
    _last_frontend_seen = time.time()
    if not current_card_uid:
        return jsonify({"card_present": False})

    # New-format Eddi card: title/type/artwork already came from the resolve,
    # so return them directly without a Spotify name lookup.
    if current_card_meta:
        return jsonify({
            "card_present": True,
            "card_uid": current_card_uid,
            "spotify_uri": current_card_meta['spotify_uri'],
            "name": current_card_meta['name'],
            "type": current_card_meta['type'],
            "artwork_url": current_card_meta.get('artwork_url'),
            "tap_count": current_card_meta.get('tap_count'),
            "track_count": current_card_meta.get('track_count'),
            "attribution": current_card_meta.get('attribution'),
            "description": current_card_meta.get('description'),
            "artwork_palette": current_card_meta.get('artwork_palette'),
        })

    # Look up any saved mapping for this card (name, type, fallback URI)
    mappings = load_card_mappings()
    card_data = mappings.get(current_card_uid, {})

    # Prefer the URI read directly off the card; fall back to saved mapping
    spotify_uri = current_spotify_uri or card_data.get('uri')
    name = card_data.get('name', 'Unknown')
    uri_type = card_data.get('type', 'playlist')

    # If the card has a URI but no saved name, look it up ONCE (cached) via the
    # 429-safe path — /nfc/current is polled frequently, so we must not re-hit
    # Spotify each time.
    if spotify_uri and name == 'Unknown':
        cached = _name_cache.get(spotify_uri)
        if cached:
            name, uri_type = cached
        else:
            parts = spotify_uri.replace('spotify:', '').split(':')
            if len(parts) >= 2:
                uri_type = parts[0]   # e.g. "playlist", "album", "show"
                item_id = parts[1]
                r = spotify_request('GET', f'https://api.spotify.com/v1/{uri_type}s/{item_id}')
                if r is not None and r.status_code == 200:
                    name = (safe_json(r) or {}).get('name', 'Unknown')
                    _name_cache[spotify_uri] = (name, uri_type)

    return jsonify({
        "card_present": True,
        "card_uid": current_card_uid,
        "spotify_uri": spotify_uri,
        "name": name,
        "type": uri_type
    })


@app.route('/nfc/update', methods=['POST'])
def update_card():
    """
    Called by nfc_reader.py whenever a card is placed or removed.
    Sets card_uid=None and spotify_uri=None on removal.
    """
    global current_card_uid, current_spotify_uri, current_card_meta, current_eddi_card_id
    data = request.json
    prev_uri = current_spotify_uri  # remember for resume-capture on removal

    # New-format Eddi card: resolve the card id via the Eddi API.
    eddi_card_id = data.get('eddi_card_id')
    if eddi_card_id:
        current_eddi_card_id = eddi_card_id   # remembered so a failed resolve can retry
        resolved = resolve_eddi_card(eddi_card_id)
        if resolved:
            current_card_uid = data.get('card_uid') or eddi_card_id
            current_spotify_uri = resolved['spotify_uri']
            current_card_meta = resolved
            _play_async(resolved['spotify_uri'])  # start audio on the Connect device
            return jsonify({"status": "success", "resolved": True})
        # Couldn't resolve (often: no network yet at boot, card left in the reader).
        # Keep card_uid + eddi id so _resolve_retry_loop finishes the job once the
        # link is up — the UI shows "card not recognized" until then, no re-tap needed.
        current_card_uid = data.get('card_uid')
        current_spotify_uri = None
        current_card_meta = None
        return jsonify({"status": "pending", "message": "resolve deferred"}), 202

    # Legacy path: a direct Spotify URI off the tag, a UID-only mapped card, or a
    # removal (both card_uid and spotify_uri None).
    card_uid = data.get('card_uid')
    uri = data.get('spotify_uri')
    if card_uid and not uri:
        # No URI on the tag — fall back to a saved card_mappings.json entry.
        uri = load_card_mappings().get(card_uid, {}).get('uri')
    current_card_uid = card_uid
    current_spotify_uri = uri
    current_card_meta = None
    current_eddi_card_id = None   # legacy/removal — nothing to resolve-retry

    if card_uid is None:
        set_pending(None)  # a removed card must not auto-play on a later device register
        _pause_async(prev_uri)  # removal — save position and pause
    elif uri:
        _play_async(uri)        # placement — start audio on the Connect device
    return jsonify({"status": "success"})


@app.route('/nfc/map', methods=['POST'])
def map_card():
    """
    Manually map a card UID to a Spotify URI and save it to card_mappings.json.
    Useful for cards that don't have NDEF data written on them.
    """
    data = request.json
    card_uid = data.get('card_uid')
    spotify_uri = data.get('spotify_uri')
    name = data.get('name', 'Unknown')
    uri_type = data.get('type', 'playlist')

    if not card_uid or not spotify_uri:
        return jsonify({"status": "error", "message": "Missing data"}), 400

    mappings = load_card_mappings()
    mappings[card_uid] = {
        "uri": spotify_uri,
        "name": name,
        "type": uri_type
    }
    save_card_mappings(mappings)

    return jsonify({"status": "success", "message": "Card mapped"})


@app.route('/spotify/token')
def get_token():
    """Return the cached Spotify access token to the frontend (the SDK's getOAuthToken source)."""
    token = get_access_token()
    if token:
        return jsonify({"access_token": token})
    return jsonify({"error": "No refresh token configured"}), 401


# ─── Spotify broker for the frontend ─────────────────────────────────────────
# The frontend (running the official Web Playback SDK) talks ONLY to these
# localhost endpoints — it makes ZERO direct api.spotify.com REST calls. The 1s
# /me/player poll it used to do is gone (the SDK pushes state via events); these
# cover the few remaining REST needs (register device, play a chosen track, queue,
# suggestions, playlist edits), all funnelled through the 429-safe spotify_request.

# Tiny short-TTL response cache so repeat fetches (and the 429 cooldown) serve
# last-known data instead of re-hitting Spotify.
_proxy_cache = {}
_PROXY_TTL = 10  # seconds


def _cached(key, fetch):
    now = time.time()
    hit = _proxy_cache.get(key)
    if hit and now - hit[0] < _PROXY_TTL:
        return hit[1]
    val = fetch()
    if val is not None:
        _proxy_cache[key] = (now, val)
    elif hit:
        return hit[1]  # stale-but-better-than-nothing during cooldown/error
    return val


@app.route('/spotify/device', methods=['POST'])
def register_device():
    """Frontend registers/clears its Web Playback SDK device id (on 'ready'/'not_ready')."""
    global _sdk_device_id, _last_registered_id
    data = request.get_json(silent=True) or {}
    new_id = data.get('device_id') or None
    is_new_device = bool(new_id) and new_id != _last_registered_id
    with _sdk_lock:
        _sdk_device_id = new_id
    print(f"[SDK] device registered: {new_id}", flush=True)
    if new_id:
        _last_registered_id = new_id
        uri = take_pending()
        if uri:
            print(f"[SDK] device ready with a card already waiting -> playing {uri}", flush=True)
            _play_async(uri)
        elif is_new_device and current_spotify_uri:
            # A *fresh* device id means the page reloaded (deploy / crash / watchdog) and
            # the old playback is orphaned — resume the present card on the new device so
            # it doesn't sit silent. A same-id reconnect skips this (Spotify auto-resumes).
            print(f"[SDK] new device -> resuming current card {current_spotify_uri}", flush=True)
            _play_async(current_spotify_uri)
    return jsonify({"status": "ok", "device_id": _sdk_device_id})


@app.route('/spotify/play', methods=['POST'])
def proxy_play():
    """Play chosen tracks/context on the registered SDK device (queue/suggestion clicks)."""
    device_id = get_target_device()
    if not device_id:
        return jsonify({"error": "no device"}), 409
    body = request.get_json(silent=True) or {}
    resp = spotify_request(
        'PUT', f'https://api.spotify.com/v1/me/player/play?device_id={device_id}',
        data=json.dumps(body))
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/shuffle', methods=['PUT'])
def proxy_shuffle():
    """Toggle shuffle on the registered SDK device (the player's play-mode pill)."""
    state = request.args.get('state', 'false')
    url = f'https://api.spotify.com/v1/me/player/shuffle?state={state}'
    device_id = get_target_device()
    if device_id:
        url += f'&device_id={device_id}'
    resp = spotify_request('PUT', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/repeat', methods=['PUT'])
def proxy_repeat():
    """Set repeat mode (off|context|track) on the registered SDK device."""
    state = request.args.get('state', 'off')
    url = f'https://api.spotify.com/v1/me/player/repeat?state={state}'
    device_id = get_target_device()
    if device_id:
        url += f'&device_id={device_id}'
    resp = spotify_request('PUT', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/pause', methods=['PUT'])
def proxy_pause():
    """Pause playback on the registered SDK device (play/pause button)."""
    device_id = get_target_device()
    url = 'https://api.spotify.com/v1/me/player/pause'
    if device_id:
        url += f'?device_id={device_id}'
    resp = spotify_request('PUT', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/resume', methods=['PUT'])
def proxy_resume():
    """Resume playback on the registered SDK device (no body = resume current)."""
    device_id = get_target_device()
    url = 'https://api.spotify.com/v1/me/player/play'
    if device_id:
        url += f'?device_id={device_id}'
    resp = spotify_request('PUT', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/next', methods=['POST'])
def proxy_next():
    """Skip to next track on the registered SDK device."""
    device_id = get_target_device()
    url = 'https://api.spotify.com/v1/me/player/next'
    if device_id:
        url += f'?device_id={device_id}'
    resp = spotify_request('POST', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/previous', methods=['POST'])
def proxy_previous():
    """Skip to previous track on the registered SDK device."""
    device_id = get_target_device()
    url = 'https://api.spotify.com/v1/me/player/previous'
    if device_id:
        url += f'?device_id={device_id}'
    resp = spotify_request('POST', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/seek', methods=['PUT'])
def proxy_seek():
    """Seek to position_ms on the registered SDK device (progress-bar tap)."""
    pos = request.args.get('position_ms', '0')
    device_id = get_target_device()
    url = f'https://api.spotify.com/v1/me/player/seek?position_ms={pos}'
    if device_id:
        url += f'&device_id={device_id}'
    resp = spotify_request('PUT', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/queue')
def proxy_queue():
    """Proxy GET /me/player/queue (next-up list)."""
    def fetch():
        r = spotify_request('GET', 'https://api.spotify.com/v1/me/player/queue')
        return safe_json(r) if (r is not None and r.status_code == 200) else None
    return jsonify(_cached('queue', fetch) or {"queue": []})


@app.route('/spotify/suggestions')
def proxy_suggestions():
    """Fresh Finds: tracks by the current artist, via SEARCH. Spotify locked down
    top-tracks, related-artists, recommendations, and the personalization endpoints
    (all 403/404 for this app as of the Nov-2024 API changes), but `/search` still
    works and returns full track objects with album art. Pass `q` = the artist name."""
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify({"tracks": []})

    def fetch():
        # Spotify now caps search `limit` at 10 (12+ → 400 "Invalid limit").
        params = {'q': q, 'type': 'track', 'market': 'US', 'limit': '10'}
        r = spotify_request('GET', 'https://api.spotify.com/v1/search', params=params)
        if r is None or r.status_code != 200:
            return None
        items = ((safe_json(r) or {}).get('tracks') or {}).get('items', [])
        # Plain search can return covers / other artists — keep tracks actually by them.
        ql = q.lower()
        items = [t for t in items if any(ql in (a.get('name', '').lower()) for a in (t.get('artists') or []))]
        return {"tracks": items}
    return jsonify(_cached(f'sugg:{q}', fetch) or {"tracks": []})


@app.route('/spotify/queue/add', methods=['POST'])
def proxy_queue_add():
    """Add a track to the Spotify playback queue — the Fresh Finds '+'. Targets the
    registered SDK device so it queues onto THIS box, and busts the cached up-next so
    the added track shows in the queue right away."""
    uri = (request.get_json(silent=True) or {}).get('uri')
    if not uri:
        return jsonify({"error": "missing uri"}), 400
    device_id = get_target_device()
    url = f'https://api.spotify.com/v1/me/player/queue?uri={uri}'
    if device_id:
        url += f'&device_id={device_id}'
    resp = spotify_request('POST', url)
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    if resp.status_code in (200, 204):
        _proxy_cache.pop('queue', None)  # next /spotify/queue refetch includes the add
    return ('', resp.status_code)


@app.route('/spotify/playlist/<playlist_id>/tracks', methods=['POST', 'DELETE'])
def proxy_playlist(playlist_id):
    """Add/remove a track to/from a playlist (heart button)."""
    url = f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks'
    resp = spotify_request(request.method, url, data=json.dumps(request.get_json(silent=True) or {}))
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/spotify/playlist/<playlist_id>/track-uris')
def proxy_playlist_uris(playlist_id):
    """All track URIs already on a playlist — drives the queue's '+' affordance
    (show '+' only for songs NOT already on the card's playlist). Paged + cached."""
    def fetch():
        uris = []
        url = (f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks'
               '?fields=items(track(uri)),next&limit=100')
        while url:
            r = spotify_request('GET', url)
            if r is None or r.status_code != 200:
                return None
            data = safe_json(r)
            if data is None:
                return None
            for it in data.get('items', []):
                t = it.get('track') or {}
                if t.get('uri'):
                    uris.append(t['uri'])
            url = data.get('next')
        return uris
    result = _cached(f'pluris:{playlist_id}', fetch)
    if result is None:
        return jsonify({"uris": [], "ok": False}), 503  # failed/cooldown — frontend keeps "+" hidden
    return jsonify({"uris": result, "ok": True})


# ── "∿ liked on eddi ∿" favorites ────────────────────────────────────────────────────
# The heart in the player saves the playing track to a single account-wide playlist. We
# find-or-create it once and persist its id. Needs the playlist-modify scopes on the token
# (re-mint get_refresh_token.py if /spotify/like 503s with "no liked playlist").
LIKED_PLAYLIST_NAME = '∿ liked on eddi ∿'
_liked_playlist_id = None
_liked_lock = threading.Lock()
_LIKED_FILE = os.path.join(os.path.dirname(__file__), 'liked_playlist.json')


def _persist_liked(pid):
    try:
        with open(_LIKED_FILE, 'w') as f:
            json.dump({'id': pid, 'name': LIKED_PLAYLIST_NAME}, f)
    except Exception as e:
        print(f"[liked] persist failed: {e}", flush=True)


def get_or_create_liked_playlist():
    """Return the '∿ liked on eddi ∿' playlist id (cached → file → search → create)."""
    global _liked_playlist_id
    with _liked_lock:
        if _liked_playlist_id:
            return _liked_playlist_id
        try:
            with open(_LIKED_FILE) as f:
                pid = json.load(f).get('id')
                if pid:
                    _liked_playlist_id = pid
                    return pid
        except Exception:
            pass
        me = spotify_request('GET', 'https://api.spotify.com/v1/me')
        user_id = (safe_json(me) or {}).get('id') if (me is not None and me.status_code == 200) else None
        if not user_id:
            print(f"[liked] /me failed ({me.status_code if me else 'none'}) — token scope?", flush=True)
            return None
        url = 'https://api.spotify.com/v1/me/playlists?limit=50'
        while url:
            r = spotify_request('GET', url)
            if r is None or r.status_code != 200:
                # Transient (cooldown/network). NEVER fall through to CREATE — that would spawn a
                # DUPLICATE "∿ liked on eddi ∿" and scatter/lose likes. Defer; retry next time.
                print("[liked] playlist search failed/cooled — deferring (not creating a dup)", flush=True)
                return None
            data = safe_json(r) or {}
            for pl in data.get('items', []):
                if pl.get('name') == LIKED_PLAYLIST_NAME and (pl.get('owner') or {}).get('id') == user_id:
                    _liked_playlist_id = pl['id']; _persist_liked(pl['id'])
                    return pl['id']
            url = data.get('next')
        # Reached only after a COMPLETE search that didn't find it → safe to create.
        cr = spotify_request('POST', f'https://api.spotify.com/v1/users/{user_id}/playlists',
                             data=json.dumps({'name': LIKED_PLAYLIST_NAME, 'public': False,
                                              'description': 'Songs you loved on eddi ∿'}))
        pid = (safe_json(cr) or {}).get('id') if (cr is not None and cr.status_code in (200, 201)) else None
        if not pid:
            print(f"[liked] create failed ({cr.status_code if cr else 'none'}) — token scope?", flush=True)
            return None
        _liked_playlist_id = pid; _persist_liked(pid)
        print(f"[liked] created '∿ liked on eddi ∿' -> {pid}", flush=True)
        return pid


@app.route('/spotify/like', methods=['POST'])
def proxy_like():
    """Toggle the playing track in the liked playlist."""
    body = request.get_json(silent=True) or {}
    uri, liked = body.get('uri'), bool(body.get('liked'))
    if not uri:
        return jsonify({"error": "missing uri"}), 400
    pid = get_or_create_liked_playlist()
    if not pid:
        return jsonify({"error": "no liked playlist (token scope?)"}), 503
    url = f'https://api.spotify.com/v1/playlists/{pid}/tracks'
    resp = (spotify_request('POST', url, data=json.dumps({'uris': [uri]})) if liked
            else spotify_request('DELETE', url, data=json.dumps({'tracks': [{'uri': uri}]})))
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    if resp.status_code in (200, 201):
        _proxy_cache.pop(f'pluris:{pid}', None)  # bust membership so the heart reflects it
        return jsonify({"liked": liked})
    # Surface Spotify's failure so the frontend reverts the optimistic heart (api.js throws on non-2xx).
    return jsonify({"error": "spotify rejected the like", "status": resp.status_code}), resp.status_code


@app.route('/spotify/liked-uris')
def proxy_liked_uris():
    """The liked playlist's track-uri set — drives the heart state."""
    pid = get_or_create_liked_playlist()
    if not pid:
        return jsonify({"uris": []})
    def fetch():
        uris = []
        url = f'https://api.spotify.com/v1/playlists/{pid}/tracks?fields=items(track(uri)),next&limit=100'
        while url:
            r = spotify_request('GET', url)
            if r is None or r.status_code != 200:
                return None
            data = safe_json(r)
            if data is None:
                return None
            for it in data.get('items', []):
                t = it.get('track') or {}
                if t.get('uri'):
                    uris.append(t['uri'])
            url = data.get('next')
        return uris
    return jsonify({"uris": _cached(f'pluris:{pid}', fetch) or []})


@app.route('/status')
def status():
    """Readiness probe — backend up + Spotify reachability + SDK device + current card."""
    return jsonify({
        "status": "ok",
        "spotify_online": _spotify_online,
        "sdk_device": bool(_sdk_device_id),
        "card_present": bool(current_spotify_uri),
    })


@app.route('/dev/exit-kiosk', methods=['POST'])
def exit_kiosk():
    """Dev escape hatch: drop the kiosk to the labwc desktop so the touchscreen/mouse can
    reach WiFi/settings (dead keyboard otherwise traps you in fullscreen Chromium). The
    frontend hits this after 10 taps in the top-right corner. We write a flag the kiosk
    launcher checks, then kill Chromium so the launcher loop sees the flag and stops
    relaunching. A reboot clears the tmpfs flag and the kiosk returns."""
    try:
        open('/dev/shm/eddi-exit-kiosk', 'w').close()
        subprocess.run(['pkill', '-f', 'chromium'], timeout=5)
        return jsonify({"status": "success", "message": "kiosk dropped to desktop"})
    except Exception as e:
        print(f"exit_kiosk error: {e}", flush=True)
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route('/net/status')
def net_status():
    """Network/Spotify reachability for the offline UI. `online` reflects whether recent
    Spotify calls are succeeding; ssid/signal come from nmcli (best-effort)."""
    ssid, signal = None, None
    try:
        out = subprocess.run(['nmcli', '-t', '-f', 'IN-USE,SSID,SIGNAL', 'dev', 'wifi'],
                             capture_output=True, text=True, timeout=4).stdout
        for line in out.splitlines():
            if line.startswith('*'):
                parts = line.split(':')
                ssid = parts[1] if len(parts) > 1 else None
                signal = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else None
                break
    except Exception:
        pass
    return jsonify({"online": _spotify_online, "ssid": ssid, "signal": signal})


@app.route('/net/refresh', methods=['POST'])
def net_refresh():
    """Re-kick WiFi (sudo nmcli) and replay the current card — the 'Refresh' action on the
    offline toast. The device sudoers allows nmcli without a password."""
    def kick():
        try:
            out = subprocess.run(['nmcli', '-t', '-f', 'NAME,DEVICE', 'connection', 'show', '--active'],
                                 capture_output=True, text=True, timeout=5).stdout
            target = None
            for line in out.splitlines():
                if line.rstrip().endswith(':wlan0'):
                    target = line.rsplit(':', 1)[0]
                    break
            if target:
                subprocess.run(['sudo', '-n', 'nmcli', 'connection', 'up', target], timeout=25)
            else:
                subprocess.run(['sudo', '-n', 'nmcli', 'device', 'reapply', 'wlan0'], timeout=25)
        except Exception as e:
            print(f"[net] refresh error: {e}", flush=True)
        time.sleep(2)
        if current_spotify_uri:
            _play_async(current_spotify_uri)  # resume the card now that we're back
    threading.Thread(target=kick, daemon=True).start()
    return jsonify({"status": "refreshing"})


def _resolve_retry_loop():
    """Self-heal a card that was present before the network came up — e.g. a card left
    in the reader across a reboot, read before WiFi/uplink was ready, so its Eddi
    resolve failed. Every few seconds, if a card is present but unresolved, retry the
    resolve; on success, play it — no re-tap needed. resolve_eddi_card() caches genuine
    404s, so a truly-unlinked card stops hitting the API after one miss."""
    global current_spotify_uri, current_card_meta
    while True:
        time.sleep(5)
        uid, cid = current_card_uid, current_eddi_card_id
        if not uid or not cid or current_card_meta is not None:
            continue
        resolved = resolve_eddi_card(cid)
        # Only act if the same card is still present and still unresolved.
        if resolved and current_card_uid == uid and current_card_meta is None:
            current_spotify_uri = resolved['spotify_uri']
            current_card_meta = resolved
            print(f"[resolve-retry] {cid} resolved late — playing", flush=True)
            _play_async(resolved['spotify_uri'])


threading.Thread(target=_resolve_retry_loop, daemon=True).start()


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
