import { useEffect, useRef, useState } from 'react'
import { fetchJson, postJson } from '../lib/api.js'

// Spotify Web Playback SDK lifecycle. Loads the SDK, creates the player, registers the
// device id with the backend, and recovers from drops. `connection` is an explicit
// state the UI can react to: 'connecting' | 'ready' | 'reconnecting' | 'dead'. The
// player instance is exposed as state so consumers attach listeners once it exists.
export function useSpotifySDK() {
  const [deviceId, setDeviceId] = useState(null)
  const [connection, setConnection] = useState('connecting')
  const [player, setPlayer] = useState(null)
  const playerRef = useRef(null)
  const deviceIdRef = useRef(null)
  const attemptsRef = useRef(0)

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://sdk.scdn.co/spotify-player.js'
    script.async = true
    document.body.appendChild(script)

    const register = (id) => postJson('/spotify/device', { device_id: id }).catch(() => {})

    window.onSpotifyWebPlaybackSDKReady = () => {
      const p = new window.Spotify.Player({
        name: 'Eddi',
        getOAuthToken: async (cb) => {
          try { const d = await fetchJson('/spotify/token'); cb(d.access_token) }
          catch (e) { console.error('token fetch failed', e) }
        },
        volume: 0.6,
      })

      p.addListener('ready', ({ device_id }) => {
        attemptsRef.current = 0
        deviceIdRef.current = device_id
        setDeviceId(device_id)
        setConnection('ready')
        register(device_id)
        try { p.activateElement() } catch {}
      })
      p.addListener('not_ready', () => {
        deviceIdRef.current = null
        setDeviceId(null)
        setConnection('reconnecting')
        register(null)
      })
      ;['initialization_error', 'authentication_error', 'account_error', 'playback_error']
        .forEach((ev) => p.addListener(ev, ({ message }) => console.error(ev, message)))

      p.connect()
      playerRef.current = p
      setPlayer(p)
      window.addEventListener('beforeunload', () => { register(null); try { p.disconnect() } catch {} })
    }

    return () => { try { playerRef.current?.disconnect() } catch {} }
  }, [])

  // Reconnect watchdog: while the device is gone, retry connect() every 5s and escalate
  // the connection state; only full-reload as a true last resort after sustained failure.
  useEffect(() => {
    const id = setInterval(() => {
      if (deviceIdRef.current) { attemptsRef.current = 0; return }
      attemptsRef.current += 1
      const n = attemptsRef.current
      setConnection(n > 3 ? 'dead' : 'reconnecting')
      if (playerRef.current) playerRef.current.connect()
      if (n >= 6) window.location.reload() // ~30s of sustained failure → hard reset (connect() rarely revives a dropped device; a reload does)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  return { deviceId, connection, player }
}
