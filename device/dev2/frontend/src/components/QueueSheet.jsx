import React, { useRef, useEffect, useLayoutEffect, useState } from 'react'
import { eddiMark, iconPlay, iconSquarePlus, iconChevronsDown } from '../assets/index.js'
import { trackArt } from '../lib/track.js'

// Snap states for the bottom sheet.
export const PEEK = 'peek'
export const FULL = 'full'

// Geometry: the sheet is SHEET_H tall, anchored to the bottom. We translate it DOWN to
// hide all but the HANDLE_H grab bar (peek) or to 0 (full). Drag comes ONLY from the grab
// bar; the list is scrolled manually (this kiosk's panel comes in as mouse, not touch).
const SHEET_H = 689
const HANDLE_H = 64
const PEEK_TY = SHEET_H - HANDLE_H   // 625
const FULL_TY = 0
const EASE = 'transform .42s cubic-bezier(.32,.72,0,1)'

// Sums "12 Plays ∿ 30 Tracks ∿ 1 hr 40 min" from whatever eddi data is present.
function statLine(card) {
  const parts = []
  if (card.tap_count != null) parts.push(`${card.tap_count} Plays`)
  if (card.track_count != null) parts.push(`${card.track_count} Tracks`)
  if (card.total_duration_ms) {
    const min = Math.round(card.total_duration_ms / 60000)
    const h = Math.floor(min / 60)
    parts.push(h ? `${h} hr ${min % 60} min` : `${min} min`)
  }
  return parts
}

function Equalizer() {
  return <span className="eq" aria-hidden><i /><i /><i /><i /></span>
}

// One row, three flavours by trailing affordance (one icon each — no overload):
//  • now-playing → animated EQ
//  • Fresh Finds (`fresh`) → tap the ROW to play now; tap the `+` to add to the queue
//  • Up Next / history (default) → play icon; tap the row to jump to it
function TrackRow({ track, nowPlaying, fresh, added, onPlay, onAdd, onLongPress, rowRef, guardRef }) {
  const timer = useRef(null)
  const fired = useRef(false)
  useEffect(() => () => clearTimeout(timer.current), [])  // clear a pending long-press if the row unmounts
  const start = () => {
    if (!onLongPress) return
    fired.current = false
    timer.current = setTimeout(() => { if (guardRef?.current) return; fired.current = true; onLongPress(track) }, 500)
  }
  const cancel = () => clearTimeout(timer.current)
  const tap = () => { if (!fired.current && !guardRef?.current) onPlay?.() }
  const art = trackArt(track)
  return (
    <div
      ref={rowRef}
      className={`q-row ripple${nowPlaying ? ' now-playing' : ''}${fresh ? ' fresh' : ''}`}
      onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel} onClick={tap}
    >
      <div className="q-art">{art ? <img src={art} alt="" /> : <div className="q-art-empty" />}</div>
      <div className="q-meta">
        <div className="q-title">{track?.name}</div>
        <div className="q-artist">{track?.artists?.map((a) => a.name).join(', ')}</div>
      </div>
      {nowPlaying ? (
        <div className="q-icon"><Equalizer /></div>
      ) : fresh ? (
        <button
          className={`q-add ripple${added ? ' added' : ''}`} aria-label="Add to queue"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onAdd?.(track) }}
        >
          {added ? <span className="q-check">✓</span> : <img src={iconSquarePlus} alt="" />}
        </button>
      ) : (
        <div className="q-icon"><img src={iconPlay} alt="" /></div>
      )}
    </div>
  )
}

function SkeletonRow() {
  return (
    <div className="q-row skeleton">
      <div className="q-art skel" />
      <div className="q-meta"><div className="skel-line" /><div className="skel-line short" /></div>
    </div>
  )
}

export default function QueueSheet({ activeSnapPoint, setActiveSnapPoint, card, playlistId, playback, queue, suggestions, playlistUris, onLongPress }) {
  const { track, previouslyPlayed, playTrack, addToQueue } = playback
  const stats = statLine(card)
  const nowRef = useRef(null)
  const sheetRef = useRef(null)
  const bodyRef = useRef(null)   // surface (bg + content) — fades to 0 at peek, 1 at full
  const dragRef = useRef(null)
  const firstRun = useRef(true)
  const expanded = activeSnapPoint === FULL
  const targetTy = expanded ? FULL_TY : PEEK_TY

  const [queued, setQueued] = useState(() => new Set())  // uris added to the queue (shows ✓)
  const longPress = playlistId ? onLongPress : undefined
  // Jump within the card's context, then collapse the sheet back to peek.
  const play = (t) => { playTrack(t.uri, card.spotify_uri); setActiveSnapPoint(PEEK) }
  const playFresh = (uri) => { playTrack(uri); setActiveSnapPoint(PEEK) }   // Fresh Finds row tap

  // Fresh Finds = suggestions minus the current track, anything already up next, and
  // anything already ON the card's playlist (so "fresh" really means new to this card).
  const upNextUris = new Set((queue.queue || []).map((t) => t.uri))
  const fresh = (suggestions || [])
    .filter((t) => t.uri && t.uri !== track?.uri && !upNextUris.has(t.uri)
      && !(playlistUris && playlistUris.has(t.uri)))
    .slice(0, 8)

  const onAddToQueue = (t) => {
    if (queued.has(t.uri)) return
    setQueued((s) => new Set(s).add(t.uri))
    Promise.resolve(addToQueue(t.uri)).catch(() => {
      setQueued((s) => { const n = new Set(s); n.delete(t.uri); return n })  // revert on failure
    })
  }

  // Rest the sheet at its snapped position (skipped while dragging). No React inline
  // transform, so unrelated re-renders can't yank it mid-drag. First paint is set without
  // a transition so the sheet doesn't slide in.
  useLayoutEffect(() => {
    const el = sheetRef.current; const body = bodyRef.current
    if (!el || dragRef.current) return
    const op = expanded ? '1' : '0'
    if (firstRun.current) {
      firstRun.current = false
      el.style.transition = 'none'; el.style.transform = `translateY(${targetTy}px)`
      if (body) { body.style.transition = 'none'; body.style.opacity = op }
      requestAnimationFrame(() => {
        if (sheetRef.current) sheetRef.current.style.transition = EASE
        if (bodyRef.current) bodyRef.current.style.transition = 'opacity .3s ease'
      })
      return
    }
    el.style.transition = EASE; el.style.transform = `translateY(${targetTy}px)`
    if (body) { body.style.transition = 'opacity .3s ease'; body.style.opacity = op }
  }, [targetTy])

  useEffect(() => {
    if (expanded && nowRef.current) requestAnimationFrame(() => nowRef.current?.scrollIntoView({ block: 'start' }))
  }, [expanded])

  // ── Sheet drag — grab bar only ──
  const onSheetDown = (e) => {
    const el = sheetRef.current
    if (!el) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    el.style.transition = 'none'
    dragRef.current = { startY: e.clientY, startTy: targetTy, moved: false, vy: 0, lastY: e.clientY, lastT: e.timeStamp }
  }
  const onSheetMove = (e) => {
    const d = dragRef.current; const el = sheetRef.current
    if (!d || !el) return
    const dy = e.clientY - d.startY
    if (Math.abs(dy) > 4) d.moved = true
    const ty = Math.max(FULL_TY, Math.min(PEEK_TY, d.startTy + dy))
    el.style.transform = `translateY(${ty}px)`
    if (bodyRef.current) { bodyRef.current.style.transition = 'none'; bodyRef.current.style.opacity = String(1 - ty / PEEK_TY) }
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.vy = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY; d.lastT = e.timeStamp
  }
  const onSheetUp = (e) => {
    const d = dragRef.current; const el = sheetRef.current
    if (!d || !el) return
    dragRef.current = null
    const ty = Math.max(FULL_TY, Math.min(PEEK_TY, d.startTy + (e.clientY - d.startY)))
    let next
    if (!d.moved) next = expanded ? PEEK : FULL
    else if (Math.abs(d.vy) > 0.4) next = d.vy < 0 ? FULL : PEEK
    else next = ty < PEEK_TY / 2 ? FULL : PEEK
    el.style.transition = EASE
    el.style.transform = `translateY(${next === FULL ? FULL_TY : PEEK_TY}px)`
    if (bodyRef.current) { bodyRef.current.style.transition = 'opacity .3s ease'; bodyRef.current.style.opacity = next === FULL ? '1' : '0' }
    setActiveSnapPoint(next)
  }

  // ── List scroll — driven from pointer events (panel comes in as mouse) ──
  const listRef = useRef(null)
  const scrollRef = useRef(null)
  const guardRef = useRef(false)
  const momentumRef = useRef(0)
  const guardTimerRef = useRef(null)
  const stopMomentum = () => { if (momentumRef.current) { cancelAnimationFrame(momentumRef.current); momentumRef.current = 0 } }
  useEffect(() => () => { stopMomentum(); clearTimeout(guardTimerRef.current) }, [])  // cancel fling rAF + guard timer on unmount

  const onListDown = (e) => {
    const flinging = momentumRef.current !== 0
    stopMomentum()
    const el = listRef.current
    if (!el) return
    if (flinging) guardRef.current = true   // a tap that STOPS a glide must not also select/play a row
    scrollRef.current = { id: e.pointerId, y: e.clientY, top: el.scrollTop, lastY: e.clientY, lastT: e.timeStamp, vy: 0, moved: false }
  }
  const onListMove = (e) => {
    const s = scrollRef.current; const el = listRef.current
    if (!s || s.id !== e.pointerId || !el) return
    const dy = e.clientY - s.y
    if (!s.moved && Math.abs(dy) > 6) {
      s.moved = true
      guardRef.current = true
      try { el.setPointerCapture(e.pointerId) } catch {}
    }
    if (s.moved) {
      el.scrollTop = s.top - dy
      const dt = Math.max(1, e.timeStamp - s.lastT)
      s.vy = (e.clientY - s.lastY) / dt
      s.lastY = e.clientY; s.lastT = e.timeStamp
    }
  }
  // On release, project where a free flick would land, snap that to the nearest track row,
  // and glide there in ONE eased motion — so it scrolls, moves, and settles as a single
  // gesture instead of decelerating to a near-stop and then jumping to align.
  const flingToRow = (v) => {
    const el = listRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    const projected = Math.max(0, Math.min(max, el.scrollTop - v * 10)) // 0.9-decay series ≈ v*10
    const listTop = el.getBoundingClientRect().top
    let bestOffset = null, bestD = Infinity
    el.querySelectorAll('.q-row').forEach((r) => {
      const offset = (r.getBoundingClientRect().top - listTop) + el.scrollTop
      const d = Math.abs(offset - projected)
      if (d < bestD) { bestD = d; bestOffset = offset }
    })
    if (bestOffset === null) return
    const start = el.scrollTop
    const dist = Math.max(0, Math.min(max, bestOffset)) - start
    if (Math.abs(dist) < 1) return
    const dur = Math.min(560, Math.max(220, Math.abs(dist) * 1.1)) // longer flings glide longer
    const t0 = performance.now()
    const ease = (x) => 1 - Math.pow(1 - x, 3) // easeOutCubic: carries the flick, gentle settle
    const anim = () => {
      const p = Math.min(1, (performance.now() - t0) / dur)
      el.scrollTop = start + dist * ease(p)
      momentumRef.current = p < 1 ? requestAnimationFrame(anim) : 0
    }
    stopMomentum()
    momentumRef.current = requestAnimationFrame(anim)
  }

  const onListUp = (e) => {
    const s = scrollRef.current
    if (!s) return
    scrollRef.current = null
    if (s.moved) flingToRow(s.vy * 16)
    clearTimeout(guardTimerRef.current)
    guardTimerRef.current = setTimeout(() => { guardRef.current = false }, 80)
  }

  return (
    <div className="queue-sheet" ref={sheetRef}>
      <div className="sheet-body" ref={bodyRef}>
      <div className="sheet-header"><span className="wave">∿</span> Current Card</div>

      <div className="card-panel">
        <div className="card-art">{card.artwork_url ? <img src={card.artwork_url} alt="" /> : <div className="q-art-empty" />}</div>
        <div className="card-info">
          <div className="card-title">{card.name}</div>
          <div className="card-attr">
            <img className="eddi-mark" src={eddiMark} alt="" />
            <span>{card.attribution || 'Eddi Audio'}</span>
          </div>
          {stats.length > 0 && (
            <div className="card-stats">
              {stats.map((s, i) => (
                <React.Fragment key={i}>{i > 0 && <span className="sep">∿</span>}<span>{s}</span></React.Fragment>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        className="q-list" ref={listRef}
        onPointerDown={onListDown} onPointerMove={onListMove} onPointerUp={onListUp} onPointerCancel={onListUp}
      >
        {/* History (scroll up) → Last Played → now-playing → up-next: all tap-to-jump (play icon). */}
        {previouslyPlayed.map((t, i) => (
          <TrackRow key={`h${t.id || i}`} track={t} onPlay={() => play(t)} onLongPress={longPress} guardRef={guardRef} />
        ))}
        {previouslyPlayed.length > 0 && (
          <div className="sheet-divider"><span>⌃</span>Last Played<span>⌃</span></div>
        )}
        {track && <TrackRow track={track} nowPlaying rowRef={nowRef} onPlay={() => {}} />}
        {queue.isLoading && queue.queue.length === 0 && [0, 1, 2, 3].map((i) => <SkeletonRow key={`s${i}`} />)}
        {queue.queue.map((t, i) => (
          <TrackRow key={t.id || i} track={t} onPlay={() => play(t)} onLongPress={longPress} guardRef={guardRef} />
        ))}
        {queue.isError && (
          <button className="q-refresh ripple" onClick={() => queue.refetch()}>Couldn’t load up-next · Retry</button>
        )}

        {/* Fresh Finds — recommendations: tap the row to play now, tap + to queue it up. */}
        {fresh.length > 0 && (
          <>
            <div className="fresh-divider">
              <img className="chev" src={iconChevronsDown} alt="" />
              <span>Fresh Finds</span>
              <img className="chev" src={iconChevronsDown} alt="" />
            </div>
            {fresh.map((t, i) => (
              <TrackRow
                key={`f${t.id || i}`} track={t} fresh added={queued.has(t.uri)}
                onPlay={() => playFresh(t.uri)} onAdd={onAddToQueue} guardRef={guardRef}
              />
            ))}
          </>
        )}

        {!queue.isLoading && !queue.isError && queue.queue.length === 0 && previouslyPlayed.length === 0 && fresh.length === 0 && (
          <div className="q-empty">No upcoming tracks</div>
        )}
      </div>
      </div>
      <div
        className="sheet-grab"
        onPointerDown={onSheetDown} onPointerMove={onSheetMove} onPointerUp={onSheetUp} onPointerCancel={onSheetUp}
      >
        <span className="sheet-grip" />
      </div>
    </div>
  )
}
