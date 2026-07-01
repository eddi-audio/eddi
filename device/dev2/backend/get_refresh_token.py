#!/usr/bin/env python3
"""
One-shot Spotify PKCE refresh-token minter for dev2.

Runs on a machine WITH a browser (Daniel's Mac), not the Pi. PKCE = client_id
only, NO client secret (the secret never leaves AWS SSM). Mints a dev2-OWN
refresh token (independent of dev1 -> no rotation contention), then you paste it
into eddi2's backend/.env as SPOTIFY_REFRESH_TOKEN.

Usage:
    python3 get_refresh_token.py            # uses the eddi.audio app client id
    SPOTIFY_CLIENT_ID=xxxx python3 get_refresh_token.py

Prereq: the REDIRECT_URI below must be registered in the Spotify app's dashboard
(Settings -> Redirect URIs). Loopback 127.0.0.1 is allowed for PKCE.
"""
import base64, hashlib, http.server, os, secrets, urllib.parse, webbrowser, json, urllib.request, ssl

# Homebrew Python on macOS often ships without a CA bundle on the openssl default
# path -> token exchange fails with CERTIFICATE_VERIFY_FAILED. Load a real bundle.
_ctx = ssl.create_default_context()
for _ca in ("/etc/ssl/cert.pem", "/usr/local/etc/openssl@3/cert.pem", "/opt/homebrew/etc/openssl@3/cert.pem"):
    if os.path.exists(_ca):
        _ctx.load_verify_locations(_ca)
        break

CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "A80bc0df0de54619bad880b38fd7cc89")
REDIRECT_URI = os.environ.get("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8888/callback")
PORT = int(urllib.parse.urlparse(REDIRECT_URI).port or 8888)
# Scopes the Web Playback SDK + app.py playback control need, PLUS playlist
# create/modify/read for the "∿ liked on eddi ∿" favorites flow (and the existing
# add-to-playlist proxy). Re-run this + paste the new SPOTIFY_REFRESH_TOKEN into the
# device .env whenever scopes change.
SCOPES = ("streaming user-read-email user-read-private "
          "user-modify-playback-state user-read-playback-state "
          "user-read-currently-playing "
          "playlist-modify-public playlist-modify-private "
          "playlist-read-private playlist-read-collaborative")

verifier = secrets.token_urlsafe(64)
challenge = base64.urlsafe_b64encode(
    hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
state = secrets.token_urlsafe(16)

auth_url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode({
    "client_id": CLIENT_ID, "response_type": "code", "redirect_uri": REDIRECT_URI,
    "code_challenge_method": "S256", "code_challenge": challenge,
    "scope": SCOPES, "state": state,
})

_code = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        if q.get("state", [""])[0] != state:
            self.wfile.write(b"<h1>State mismatch - aborted.</h1>")
            return
        if "code" in q:
            _code["code"] = q["code"][0]
            self.wfile.write(b"<h1>Got it. You can close this tab.</h1>")
        else:
            self.wfile.write(b"<h1>No code returned: " + self.path.encode() + b"</h1>")

    def log_message(self, *a):  # quiet
        pass


def main():
    print(f"client_id  = {CLIENT_ID}")
    print(f"redirect   = {REDIRECT_URI}  (must be registered in the Spotify dashboard)")
    print("\nOpening browser to approve... if it doesn't open, paste this URL:\n")
    print(auth_url + "\n")
    webbrowser.open(auth_url)
    with http.server.HTTPServer(("127.0.0.1", PORT), Handler) as httpd:
        while "code" not in _code:
            httpd.handle_request()

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code", "code": _code["code"],
        "redirect_uri": REDIRECT_URI, "client_id": CLIENT_ID,
        "code_verifier": verifier,
    }).encode()
    req = urllib.request.Request("https://accounts.spotify.com/api/token", data=data,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    tok = json.loads(urllib.request.urlopen(req, context=_ctx).read())

    rt = tok.get("refresh_token")
    if not rt:
        print("\nNo refresh_token in response:\n", json.dumps(tok, indent=2))
        return
    out = os.environ.get("OUT", "/tmp/eddi2-dev2.env")
    body = (f"SPOTIFY_CLIENT_ID={CLIENT_ID}\n"
            f"SPOTIFY_REFRESH_TOKEN={rt}\n"
            "EDDI_API_BASE=https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod\n")
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.write(fd, body.encode()); os.close(fd)
    print(f"\nwrote {out}  (refresh_token {rt[:6]}…{rt[-4:]}, len {len(rt)}, scopes ok)")


if __name__ == "__main__":
    main()
