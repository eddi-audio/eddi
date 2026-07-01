import { useEffect, useRef, useState, useCallback } from 'react'
import { putJson, postJson } from '../lib/api.js'
import { useInvalidateQueue } from './useQueue.js'

// Playback state (from the SDK's push events) + the transport controls that drive it.
// Controls are LOCAL SDK methods (instant) with optimistic UI; play-mode (shuffle/
// repeat) goes through the backend Connect API and is held by `modeLock` until Spotify
// confirms, so the icon doesn't flip-flop. The up-next queue is refetched when Spotify's
// *confirmed* shuffle/repeat actually changes — no setTimeout guesses.
export function usePlayback(player) {
  const [track, setTrack] = useState(null)
  const [paused, setPaused] = useState(true)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [shuffle, setShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState(0)
  const [previouslyPlayed, setPreviouslyPlayed] = useState([])
  const [nextTrack, setNextTrack] = useState(null)   // carousel peek (right)
  const [prevTrack, setPrevTrack] = useState(null)   // carousel peek (left)

  const baseRef = useRef({ pos: 0, t: 0, paused: true, dur: 0 }) // position-extrapolation base
  const gotTrackRef = useRef(false)
  const lastIdRef = useRef(null)
  const prevTrackRef = useRef(null)
  const stateRef = useRef(null)
  const modeLock = useRef(null)
  const skipLock = useRef(null)   // a track-skip in flight: ignore stale/regressing SDK pushes
  const lastSdkMode = useRef({ sh: null, rp: null })
  const invalidateQueue = useInvalidateQueue()

  useEffect(() => {
    if (!player) return undefined
    let alive = true
    const onState = (state) => {
      if (!alive || !state) return
      const cur = state.track_window.current_track
      // While a skip is in flight, ignore a stale/regressing push (one that puts us back on the
      // track we just skipped FROM) — otherwise the keyed carousel jumps backward for a beat.
      const lk = skipLock.current
      if (lk) {
        if (Date.now() >= lk.until) skipLock.current = null
        else if (cur && cur.id === lk.from) return
        else skipLock.current = null
      }
      stateRef.current = state
      gotTrackRef.current = !!cur
      setTrack(cur)
      setNextTrack(state.track_window.next_tracks?.[0] || null)
      setPrevTrack(state.track_window.previous_tracks?.slice(-1)[0] || null)
      setPaused(state.paused)
      setPosition(state.position)
      setDuration(state.duration)
      // Authoritative position at event time → the base the ticker extrapolates from.
      baseRef.current = { pos: state.position, t: performance.now(), paused: state.paused, dur: state.duration }

      // Hold the optimistic play-mode until Spotify applies it (Connect lag ~1-2s),
      // otherwise stale events flip the icon back and forth before it settles.
      const lock = modeLock.current
      if (lock && Date.now() < lock.until && (state.shuffle !== lock.sh || state.repeat_mode !== lock.rp)) {
        // change not applied yet — keep optimistic shuffle/repeat
      } else {
        if (lock) modeLock.current = null
        setShuffle(state.shuffle)
        setRepeatMode(state.repeat_mode)
      }

      // When Spotify's real shuffle/repeat changes, the up-next reorders — refetch it.
      if (state.shuffle !== lastSdkMode.current.sh || state.repeat_mode !== lastSdkMode.current.rp) {
        lastSdkMode.current = { sh: state.shuffle, rp: state.repeat_mode }
        invalidateQueue()
      }

      // Session history: on a real track change, push the prior track (newest first).
      if (cur && cur.id !== lastIdRef.current) {
        const prev = prevTrackRef.current
        if (prev?.id && prev.id !== cur.id) {
          setPreviouslyPlayed((h) => [prev, ...h.filter((t) => t.id !== prev.id)].slice(0, 50))
        }
        prevTrackRef.current = cur
        lastIdRef.current = cur.id
        invalidateQueue() // up-next changed too
      }

    }
    player.addListener('player_state_changed', onState)
    // The SDK only PUSHES state on changes — if playback started before this listener attached
    // (or before the SDK device went active), that first event is missed and the UI hangs on
    // "loading" until the next change. Pull the current state now + poll until we have a track.
    const pull = () => player.getCurrentState?.().then((s) => { if (alive && s) onState(s) }).catch(() => {})
    pull()
    const pollId = setInterval(() => { if (gotTrackRef.current) clearInterval(pollId); else pull() }, 1000)
    return () => { alive = false; player.removeListener('player_state_changed', onState); clearInterval(pollId) }
  }, [player, invalidateQueue])

  // One stable ticker that extrapolates position from the last event's base + elapsed time.
  // (Recreating an interval per event was the bug: a transient paused event cleared it and it
  // never restarted → the bar froze; steady playback fires no events so it never advanced.)
  useEffect(() => {
    const id = setInterval(() => {
      const b = baseRef.current
      if (b.paused || !b.dur) return   // don't extrapolate without a known duration (no unbounded drift)
      setPosition(Math.min(b.dur, b.pos + (performance.now() - b.t)))
    }, 250)
    return () => clearInterval(id)
  }, [])

  const togglePlay = useCallback(() => {
    const b = baseRef.current
    const pos = b.paused ? b.pos : Math.min(b.dur || Infinity, b.pos + (performance.now() - b.t))
    baseRef.current = { pos, t: performance.now(), paused: !b.paused, dur: b.dur } // freeze/resume the base
    setPosition(pos); setPaused(!b.paused)
    player?.togglePlay()
  }, [player])
  // Optimistic: shift the whole carousel (current + both peeks) in one render so it doesn't
  // "redraw" twice (once optimistic, once on the SDK push). The peek art is already loaded.
  // Also reset the playhead to 0 with the new track's duration so the bar doesn't lag.
  const skipNext = useCallback(() => {
    const tw = stateRef.current?.track_window
    const cur = tw?.current_track
    const nt = tw?.next_tracks?.[0]
    if (nt) {
      const rest = tw.next_tracks.slice(1)
      skipLock.current = { from: cur?.id, target: nt.id, until: Date.now() + 4000 }
      // Advance the optimistic window AND stateRef so a rapid second skip chains off it (not a
      // stale SDK push); the keyed carousel slides the next tile to center off these.
      stateRef.current = { ...stateRef.current, track_window: { current_track: nt, previous_tracks: cur ? [cur] : [], next_tracks: rest } }
      setTrack(nt); setPrevTrack(cur || null); setNextTrack(rest[0] || null)
      baseRef.current = { pos: 0, t: performance.now(), paused: false, dur: nt.duration_ms || 0 }
      setPosition(0); if (nt.duration_ms) setDuration(nt.duration_ms)
    }
    player?.nextTrack()
  }, [player])
  const skipPrevious = useCallback(() => {
    const tw = stateRef.current?.track_window
    const cur = tw?.current_track
    const pt = tw?.previous_tracks?.slice(-1)[0]
    if (pt) {
      const rest = tw.previous_tracks.slice(0, -1)
      skipLock.current = { from: cur?.id, target: pt.id, until: Date.now() + 4000 }
      stateRef.current = { ...stateRef.current, track_window: { current_track: pt, previous_tracks: rest, next_tracks: cur ? [cur] : [] } }
      setTrack(pt); setNextTrack(cur || null); setPrevTrack(rest.slice(-1)[0] || null)
      baseRef.current = { pos: 0, t: performance.now(), paused: false, dur: pt.duration_ms || 0 }
      setPosition(0); if (pt.duration_ms) setDuration(pt.duration_ms)
    }
    player?.previousTrack()
  }, [player])
  const seek = useCallback((ms) => {
    baseRef.current = { ...baseRef.current, pos: ms, t: performance.now() }
    setPosition(ms); player?.seek(ms)
  }, [player])

  // Play a chosen queue/history track (backend Connect API — jumps within the context).
  const playTrack = useCallback((uri, contextUri) => {
    postJson('/spotify/play', contextUri ? { context_uri: contextUri, offset: { uri } } : { uris: [uri] }).catch(() => {})
  }, [])

  // Add a track to the playback queue (Fresh Finds "+"). Returns the promise so the
  // caller can confirm/revert its optimistic check.
  const addToQueue = useCallback((uri) => postJson('/spotify/queue/add', { uri }), [])

  // Separate shuffle toggle + repeat tri-state (off → one → all → off), each optimistic
  // and held by modeLock until Spotify's push confirms (Connect lag ~1-2s).
  const toggleShuffle = useCallback(() => {
    const next = !shuffle
    modeLock.current = { sh: next, rp: repeatMode, until: Date.now() + 5000 }
    setShuffle(next)
    putJson(`/spotify/shuffle?state=${next}`).catch(() => {})
  }, [shuffle, repeatMode])

  const cycleRepeat = useCallback(() => {
    // SDK repeat_mode: 0=off, 1=context(all), 2=track(one). Cycle off→one→all→off.
    const order = [0, 2, 1]
    const apiState = { 0: 'off', 2: 'track', 1: 'context' }
    const next = order[(order.indexOf(repeatMode) + 1) % order.length]
    modeLock.current = { sh: shuffle, rp: next, until: Date.now() + 5000 }
    setRepeatMode(next)
    putJson(`/spotify/repeat?state=${apiState[next]}`).catch(() => {})
  }, [shuffle, repeatMode])

  return {
    track, nextTrack, prevTrack, paused, position, duration, shuffle, repeatMode, previouslyPlayed,
    togglePlay, skipNext, skipPrevious, seek, toggleShuffle, cycleRepeat, playTrack, addToQueue,
  }
}
