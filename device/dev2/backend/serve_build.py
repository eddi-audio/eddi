#!/usr/bin/env python3
"""
Tiny dependency-free static server for the production React build (frontend/build).

Replaces `react-scripts start` (the webpack dev server) on dev1. The dev server
keeps a webpack process watching/recompiling and writing to the SD card; serving
a prebuilt static bundle is dramatically lighter and was part of fixing the
under-load freezes. No npm global install needed — stdlib only.

Serves on :3000 with SPA fallback (any non-file path -> index.html) and
no-store caching so a rebuild is always picked up on the next kiosk reload.
"""
import http.server
import socketserver
import os

PORT = int(os.environ.get('PORT', '3000'))
BUILD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'build')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BUILD_DIR, **kwargs)

    def end_headers(self):
        # Kiosk should always get the freshest bundle after a rebuild.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        # SPA fallback: serve index.html for any path that isn't a real file
        # (and isn't a hashed static asset).
        path = self.path.split('?', 1)[0]
        fs_path = self.translate_path(self.path)
        if not os.path.isfile(fs_path) and not path.startswith('/static/'):
            self.path = '/index.html'
        return super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    if not os.path.isfile(os.path.join(BUILD_DIR, 'index.html')):
        raise SystemExit(f"No production build at {BUILD_DIR} — run `npm run build` first.")
    with Server(('0.0.0.0', PORT), Handler) as httpd:
        print(f"Serving {BUILD_DIR} on :{PORT}", flush=True)
        httpd.serve_forever()
