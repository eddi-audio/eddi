const http = require('http')
const https = require('https')
const fs = require('fs')
const { execSync } = require('child_process')
const { URLSearchParams } = require('url')
const { networkInterfaces } = require('os')

const PORT = 80
const BASE_DIR = '/home/pi/eddi'
const ENV_FILE = `${BASE_DIR}/.env`
const TOKEN_FILE = `${BASE_DIR}/.spotify_token`
const REDIRECT_URI = 'http://eddi.local/callback'

function readEnv() {
  try {
    return Object.fromEntries(
      fs.readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .filter(l => l.includes('='))
        .map(l => {
          const i = l.indexOf('=')
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        })
    )
  } catch { return {} }
}

function readToken() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')) }
  catch { return null }
}

function writeToken(data) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2))
}

function getLocalIp() {
  const nets = networkInterfaces()
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return 'unknown'
}

function restartLibrespot() {
  try { execSync('sudo systemctl restart librespot') }
  catch (e) { console.error('librespot restart failed:', e.message) }
}

function exchangeCode(code, clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }).toString()

    const req = https.request({
      hostname: 'accounts.spotify.com',
      path: '/api/token',
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
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

function statusPage(connected, flash) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eddi Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui,-apple-system,sans-serif; background: #0a0a0a; color: white;
           min-height: 100dvh; display: flex; flex-direction: column; align-items: center;
           justify-content: center; padding: 32px 24px; text-align: center; gap: 16px; }
    h1 { font-size: 32px; font-weight: 700; letter-spacing: -1px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
             border-radius: 99px; font-size: 13px; font-weight: 500;
             ${connected ? 'background:rgba(22,163,74,0.15);color:#4ade80' : 'background:rgba(220,38,38,0.15);color:#f87171'}; }
    p { color: rgba(255,255,255,0.45); font-size: 14px; line-height: 1.6; max-width: 300px; }
    ${flash ? `.flash { background: rgba(22,163,74,0.1); border: 1px solid rgba(22,163,74,0.3);
               border-radius: 12px; padding: 12px 16px; font-size: 13px; color: #4ade80; }` : ''}
    a.btn { display: block; width: 100%; max-width: 280px; padding: 14px;
            border-radius: 16px; font-weight: 600; font-size: 15px; text-decoration: none;
            background: #1db954; color: black; }
    a.btn.ghost { background: rgba(255,255,255,0.08); color: white; }
    footer { color: rgba(255,255,255,0.15); font-size: 12px; }
  </style>
</head>
<body>
  <h1>eddi</h1>
  <div class="badge">${connected ? '✓ Spotify connected' : '○ Not connected'}</div>
  ${flash ? `<div class="flash">✓ Connected! Restarting player…</div>` : ''}
  <p>${connected
    ? 'Your Eddi player is ready. Tap an NFC card to play.'
    : 'Connect your Spotify account to start playing music.'
  }</p>
  <a href="/auth" class="btn ${connected ? 'ghost' : ''}">${connected ? 'Reconnect Spotify' : 'Connect Spotify'}</a>
  <footer>eddi.local &nbsp;·&nbsp; ${getLocalIp()}</footer>
</body>
</html>`
}

const server = http.createServer(async (req, res) => {
  const env = readEnv()
  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/') {
    const connected = !!readToken()
    const flash = url.searchParams.get('connected') === '1'
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(statusPage(connected, flash))
    return
  }

  if (url.pathname === '/auth') {
    const authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      response_type: 'code',
      client_id: env.SPOTIFY_CLIENT_ID,
      scope: 'streaming user-read-playback-state user-modify-playback-state',
      redirect_uri: REDIRECT_URI,
    })
    res.writeHead(302, { Location: authUrl })
    res.end()
    return
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code')
    if (!code) {
      res.writeHead(302, { Location: '/?error=auth_denied' })
      res.end()
      return
    }
    try {
      const tokens = await exchangeCode(code, env.SPOTIFY_CLIENT_ID, env.SPOTIFY_CLIENT_SECRET)
      writeToken({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + tokens.expires_in * 1000,
        stored_at: new Date().toISOString(),
      })
      restartLibrespot()
      res.writeHead(302, { Location: '/?connected=1' })
    } catch (e) {
      console.error('token exchange failed:', e)
      res.writeHead(302, { Location: '/?error=token_failed' })
    }
    res.end()
    return
  }

  if (url.pathname === '/state') {
    const token = readToken()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ spotify_connected: !!token, ip: getLocalIp() }))
    return
  }

  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  console.log(`Eddi setup server → http://eddi.local (${getLocalIp()})`)
})
