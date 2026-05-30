# Eddi Pi — Setup & Auth

Solves two problems:
1. Pi becomes unreachable when DHCP assigns a new IP
2. Spotify auth requires a keyboard/SSH to complete or recover

---

## Part 1 — mDNS (`eddi.local`)

Install avahi so the Pi is always reachable by hostname regardless of IP.

```bash
sudo apt install -y avahi-daemon
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon
```

Set a fixed hostname:
```bash
sudo hostnamectl set-hostname eddi
# Makes it reachable at eddi.local on the local network
```

Verify from your Mac:
```bash
ping eddi.local
ssh pi@eddi.local
```

**This alone fixes the "lost the Pi" problem.** IP changes don't matter anymore.

---

## Part 2 — Setup Server (runs on the Pi)

A small Node.js HTTP server that runs permanently on the Pi and handles:
- Spotify OAuth (first-time setup and re-auth)
- Status dashboard at `http://eddi.local`
- Graceful librespot restart after auth

### File layout

```
pi/
├── server.js          ← HTTP server (setup + auth)
├── start.sh           ← systemd entry point
└── .env               ← SPOTIFY_CLIENT_ID, stored token
```

### `pi/server.js`

```js
const http = require('http')
const https = require('https')
const fs = require('fs')
const { execSync, spawn } = require('child_process')
const { URLSearchParams } = require('url')

const PORT = 80
const ENV_FILE = '/home/pi/eddi/.env'
const TOKEN_FILE = '/home/pi/eddi/.spotify_token'

// Read env
function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .filter(l => l.includes('='))
        .map(l => l.split('=').map(s => s.trim()))
    )
  } catch { return {} }
}

// Read stored token
function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) }
  catch { return null }
}

// Write token
function writeToken(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
}

// Restart librespot with stored credentials
function restartLibrespot() {
  try { execSync('sudo systemctl restart librespot') }
  catch (e) { console.error('restart failed', e.message) }
}

// Exchange auth code for tokens
async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }).toString()

    const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const req = https.request({
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => resolve(JSON.parse(data)))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

const server = http.createServer(async (req, res) => {
  const env = readEnv()
  const token = readToken()
  const url = new URL(req.url, `http://${req.headers.host}`)
  const redirectUri = `http://eddi.local/callback`

  // Root — status page
  if (url.pathname === '/') {
    const authed = !!token
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eddi Setup</title>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: white; max-width: 400px;
           margin: 60px auto; padding: 0 24px; text-align: center; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    p { color: rgba(255,255,255,0.5); font-size: 14px; line-height: 1.6; }
    .status { display: inline-block; padding: 6px 14px; border-radius: 99px; font-size: 13px;
              margin: 16px 0; ${authed ? 'background:#16a34a20;color:#4ade80' : 'background:#dc262620;color:#f87171'}; }
    a.btn { display: block; margin-top: 24px; padding: 14px; border-radius: 16px;
            background: #1db954; color: black; font-weight: 600; text-decoration: none; font-size: 15px; }
    a.btn.secondary { background: rgba(255,255,255,0.1); color: white; margin-top: 12px; }
    .ip { font-size: 12px; color: rgba(255,255,255,0.2); margin-top: 32px; }
  </style>
</head>
<body>
  <h1>eddi</h1>
  <div class="status">${authed ? '✓ Spotify connected' : '○ Spotify not connected'}</div>
  <p>${authed
    ? 'Your Eddi player is ready. Tap a card to play.'
    : 'Connect your Spotify account to start playing.'
  }</p>
  ${authed
    ? `<a href="/auth" class="btn secondary">Reconnect Spotify</a>`
    : `<a href="/auth" class="btn">Connect Spotify</a>`
  }
  <p class="ip">eddi.local · ${getLocalIp()}</p>
</body>
</html>`
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
    return
  }

  // Start OAuth flow
  if (url.pathname === '/auth') {
    const scopes = 'streaming user-read-playback-state user-modify-playback-state'
    const authUrl = `https://accounts.spotify.com/authorize?` + new URLSearchParams({
      response_type: 'code',
      client_id: env.SPOTIFY_CLIENT_ID,
      scope: scopes,
      redirect_uri: redirectUri,
    })
    res.writeHead(302, { Location: authUrl })
    res.end()
    return
  }

  // OAuth callback
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')

    if (error || !code) {
      res.writeHead(302, { Location: '/?error=1' })
      res.end()
      return
    }

    try {
      const tokens = await exchangeCode(code, env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET, redirectUri)
      writeToken({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        stored_at: new Date().toISOString(),
      })
      restartLibrespot()
      res.writeHead(302, { Location: '/?connected=1' })
    } catch (e) {
      res.writeHead(302, { Location: '/?error=1' })
    }
    res.end()
    return
  }

  res.writeHead(404)
  res.end()
})

function getLocalIp() {
  try {
    const { networkInterfaces } = require('os')
    const nets = networkInterfaces()
    for (const iface of Object.values(nets)) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address
      }
    }
  } catch { return 'unknown' }
}

server.listen(PORT, () => console.log(`Eddi setup server running at http://eddi.local`))
```

---

## Part 3 — systemd Services

### Setup server (`/etc/systemd/system/eddi-setup.service`)

```ini
[Unit]
Description=Eddi Setup Server
After=network.target

[Service]
ExecStart=/usr/bin/node /home/pi/eddi/pi/server.js
WorkingDirectory=/home/pi/eddi
Restart=always
RestartSec=5
User=root
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### librespot (`/etc/systemd/system/librespot.service`)

```ini
[Unit]
Description=Librespot Spotify Player
After=network.target sound.target

[Service]
ExecStart=/usr/bin/librespot \
  --name "Eddi" \
  --device-type speaker \
  --bitrate 320 \
  --cache /home/pi/.librespot \
  --username "" \
  --password ""
Restart=on-failure
RestartSec=10
User=pi
EnvironmentFile=/home/pi/eddi/.env

[Install]
WantedBy=multi-user.target
```

> **Note:** librespot 0.5+ supports `--oauth` flag which handles the token exchange itself. If on 0.5+, replace `--username/--password` with `--oauth` and point the callback at `http://eddi.local/callback`. The setup server's `/auth` route works the same way.

### Enable everything

```bash
sudo systemctl daemon-reload
sudo systemctl enable eddi-setup librespot
sudo systemctl start eddi-setup librespot
```

---

## Part 4 — `.env` file on the Pi

```
SPOTIFY_CLIENT_ID=A80bc0df0de54619bad880b38fd7cc89
SPOTIFY_CLIENT_SECRET=07def1385d2245e8a7969510f196efd7
```

---

## First-Time Setup Flow (beta user experience)

1. Pi boots, connects to WiFi
2. User opens `http://eddi.local` on any device on the same network
3. Sees "Connect Spotify" button → taps it
4. Spotify OAuth page opens in browser → user approves
5. Redirected back to `eddi.local/callback` → token stored → librespot restarts
6. Page shows "✓ Spotify connected" → done

**If Spotify auth ever breaks:** same flow. User goes to `eddi.local`, taps "Reconnect Spotify". No SSH, no keyboard, no copy-pasting.

---

## Re-auth Recovery

If librespot loses its token (Spotify revokes it, token corrupt, etc.), it will fail silently. To detect and surface this:

- Add a cron job or systemd timer that checks `systemctl is-active librespot` every 60s
- If librespot is failed, flash an LED on the Pi (if available) AND the setup server adds a banner to the status page: "Spotify disconnected — tap here to reconnect"
- The app (future) can poll `GET http://eddi.local/state` and surface the same prompt

This prevents the "stuck in a loop" scenario — the user always has a clear path to recovery without physical access to the device.

---

## Checklist

- [ ] `sudo apt install -y avahi-daemon && sudo systemctl enable avahi-daemon`
- [ ] `sudo hostnamectl set-hostname eddi`
- [ ] Verify: `ping eddi.local` from Mac works
- [ ] Copy `pi/server.js` to Pi
- [ ] Create `.env` with Spotify keys
- [ ] Install and enable `eddi-setup.service` and `librespot.service`
- [ ] Open `http://eddi.local` in browser → complete Spotify auth
- [ ] Confirm `systemctl status librespot` shows active
