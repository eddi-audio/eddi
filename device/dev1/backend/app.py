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
        if resp.status_code != 200:
            print(f"Eddi resolve {card_id}: HTTP {resp.status_code}", flush=True)
            return None
        card = resp.json()
        spotify_uri = to_spotify_uri((card.get('service_uris') or {}).get('spotify'))
        if not spotify_uri:
            print(f"Eddi card {card_id} has no Spotify URI", flush=True)
            return None
        result = {
            'spotify_uri': spotify_uri,
            'name': card.get('title', 'Unknown'),
            'type': card.get('content_type', 'playlist'),
            'artwork_url': card.get('artwork_url'),
        }
        with _card_cache_lock:
            _card_cache[card_id] = result
        print(f"Resolved Eddi card {card_id} -> {spotify_uri} ({result['name']})", flush=True)
        return result
    except Exception as e:
        print(f"Eddi resolve error for {card_id}: {e}", flush=True)
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


def spotify_request(method, url, **kwargs):
    """
    Single choke point for backend→Spotify Web API calls. Honors 429/Retry-After.
    Returns a requests.Response, or None if we're in a cooldown or the call errored
    (callers should serve cached/last-known data in that case).
    """
    global _rate_limited_until
    now = time.time()
    if now < _rate_limited_until:
        print(f"[spotify] in 429 cooldown ({int(_rate_limited_until - now)}s left); skipping {method} {url}", flush=True)
        return None
    kwargs.setdefault('timeout', 8)
    headers = kwargs.pop('headers', None) or _spotify_headers()
    try:
        resp = requests.request(method, url, headers=headers, **kwargs)
    except Exception as e:
        print(f"[spotify] {method} {url} error: {e}", flush=True)
        return None
    if resp.status_code == 429:
        retry = int(resp.headers.get('Retry-After', '30'))
        _rate_limited_until = time.time() + retry
        print(f"[spotify] 429 — backing off {retry}s", flush=True)
    return resp


def play_on_connect(spotify_uri):
    """
    Start playback of a card's URI on the target device — the browser Web Playback
    SDK device the frontend registered (preferred), else name-based discovery.
    Honours a saved resume position if the same card was just removed.
    """
    device_id = get_target_device()
    if not device_id:
        print("No target device registered yet (frontend SDK not ready)", flush=True)
        return

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

    resp = spotify_request(
        'PUT', f'https://api.spotify.com/v1/me/player/play?device_id={device_id}',
        data=json.dumps(body))
    if resp is None:
        return  # rate-limit cooldown or network error
    if resp.status_code in (202, 204):
        print(f"[Play] {spotify_uri} on {device_id}", flush=True)
    elif resp.status_code == 404:
        # Stale SDK device id (browser reloaded) — drop it; the frontend re-registers
        # on its next 'ready' and the next card tap will land.
        print("[Play] 404 — target device stale; clearing (frontend will re-register)", flush=True)
        global _sdk_device_id
        with _sdk_lock:
            _sdk_device_id = None
    else:
        print(f"[Play] failed {resp.status_code}: {resp.text}", flush=True)


def save_resume_and_pause(spotify_uri):
    """
    Capture the current playback position for resume (keyed by the removed
    card's URI), then pause the Connect device via the Web API.
    """
    resp = spotify_request('GET', 'https://api.spotify.com/v1/me/player')
    if resp is not None and resp.status_code == 200 and resp.content:
        d = resp.json()
        item = d.get('item') or {}
        if spotify_uri and item.get('uri'):
            with _resume_lock:
                _resume_state[spotify_uri] = {
                    'track_uri': item['uri'],
                    'position_ms': d.get('progress_ms', 0),
                    'ts': time.time(),
                }
    pr = spotify_request('PUT', 'https://api.spotify.com/v1/me/player/pause')
    if pr is not None:
        print(f"[Pause] status {pr.status_code}", flush=True)


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


@app.route('/nfc/current')
def get_current_card():
    """
    Return the currently present NFC card and its associated Spotify URI.
    Called by the frontend every 3 seconds.
    Priority for the URI: card NDEF data > card_mappings.json entry.
    If we have a URI but no saved name, fetch the name from the Spotify API.
    """
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
                    name = r.json().get('name', 'Unknown')
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
    global current_card_uid, current_spotify_uri, current_card_meta
    data = request.json
    prev_uri = current_spotify_uri  # remember for resume-capture on removal

    # New-format Eddi card: resolve the card id via the Eddi API.
    eddi_card_id = data.get('eddi_card_id')
    if eddi_card_id:
        resolved = resolve_eddi_card(eddi_card_id)
        if resolved:
            current_card_uid = data.get('card_uid') or eddi_card_id
            current_spotify_uri = resolved['spotify_uri']
            current_card_meta = resolved
            _play_async(resolved['spotify_uri'])  # start audio on the Connect device
            return jsonify({"status": "success", "resolved": True})
        # Couldn't resolve — surface no playable content rather than stale state.
        current_card_uid = data.get('card_uid')
        current_spotify_uri = None
        current_card_meta = None
        return jsonify({"status": "error", "message": "card not resolved"}), 502

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

    if card_uid is None:
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
    global _sdk_device_id
    data = request.get_json(silent=True) or {}
    with _sdk_lock:
        _sdk_device_id = data.get('device_id') or None
    print(f"[SDK] device registered: {_sdk_device_id}", flush=True)
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


@app.route('/spotify/queue')
def proxy_queue():
    """Proxy GET /me/player/queue (next-up list)."""
    def fetch():
        r = spotify_request('GET', 'https://api.spotify.com/v1/me/player/queue')
        return r.json() if (r is not None and r.status_code == 200) else None
    return jsonify(_cached('queue', fetch) or {"queue": []})


@app.route('/spotify/suggestions')
def proxy_suggestions():
    """Proxy an artist's top tracks (used as 'suggested')."""
    artist_id = request.args.get('artist_id', '')
    if not artist_id:
        return jsonify({"tracks": []})

    def fetch():
        r = spotify_request('GET', f'https://api.spotify.com/v1/artists/{artist_id}/top-tracks')
        return r.json() if (r is not None and r.status_code == 200) else None
    return jsonify(_cached(f'sugg:{artist_id}', fetch) or {"tracks": []})


@app.route('/spotify/playlist/<playlist_id>/tracks', methods=['POST', 'DELETE'])
def proxy_playlist(playlist_id):
    """Add/remove a track to/from a playlist (heart button)."""
    url = f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks'
    resp = spotify_request(request.method, url, data=json.dumps(request.get_json(silent=True) or {}))
    if resp is None:
        return jsonify({"error": "rate-limited or unavailable"}), 503
    return ('', resp.status_code)


@app.route('/status')
def status():
    """Health check endpoint."""
    return jsonify({"status": "success", "message": "NFC Spotify Player ready"})


if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
