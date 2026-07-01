import React, { useRef, useState, useEffect } from 'react'

const STEP = 320        // px between adjacent art-tile centers (peeks land at the screen edges)
const PEEK_SCALE = 0.8  // peek tiles render at 80% (256px) — matches the Figma
const SKIP_PX = 120     // deliberate swipe distance to change tracks
const FLICK_V = 0.5     // px/ms flick velocity that also commits a skip

const tid = (t) => t?.id || t?.uri
const artOf = (t) => t?.album?.images?.[0]?.url

// A tile's transform/opacity/z come purely from its effective position `ep = base + drag/STEP`.
// transition is OFF while dragging (follow the finger 1:1) and ON otherwise (animate the slide).
function tileStyle(ep, dragging) {
  const a = Math.min(1, Math.abs(ep))
  return {
    transform: `translateX(${ep * STEP}px) scale(${1 - (1 - PEEK_SCALE) * a})`,
    opacity: 1 - 0.2 * a,
    zIndex: Math.round((1 - a) * 10),
    transition: dragging ? 'none' : 'transform .33s cubic-bezier(.32,.72,0,1), opacity .33s ease',
  }
}

// Seamless album-art carousel. The window (prev / current / next) renders as tiles KEYED BY track
// id, positioned declaratively from `base + drag/STEP`. On a committed swipe the SDK window shifts;
// React reconciliation MOVES the old-`next` node (with its already-loaded image) to center and the
// CSS transition slides it — the centered tile's `src` never changes, so there is no flash. Lives
// in its own (memoized) component so a 60fps drag re-renders only these 3 tiles, not the player.
function ArtCarousel({ prevTrack, track, nextTrack, awaiting, card, skipNext, skipPrevious }) {
  const [drag, setDrag] = useState(0)         // px, live during a gesture
  const [dragging, setDragging] = useState(false)
  const g = useRef(null)                       // active gesture scratch
  const rafRef = useRef(0)
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])  // cancel pending drag rAF on unmount

  const cardArt = card?.artwork_url
  const placeholder = awaiting || !track
  const hasPrev = !placeholder && !!prevTrack && tid(prevTrack) !== tid(track)
  const hasNext = !placeholder && !!nextTrack && tid(nextTrack) !== tid(track)

  // Build the window: center always; peeks only if a distinct track exists (de-duped by id, so a
  // repeat-one / tiny-context collision can't break React keys). Placeholder = lone card-art tile
  // with a STABLE synthetic key (so it isn't confused with a real track tile).
  let tiles
  if (placeholder) {
    tiles = [{ key: `card:${card?.card_uid || 'x'}`, src: cardArt, base: 0 }]
  } else {
    tiles = [{ key: tid(track), src: artOf(track) || cardArt, base: 0 }]
    if (hasPrev) tiles.push({ key: tid(prevTrack), src: artOf(prevTrack), base: -1 })
    if (hasNext) tiles.push({ key: tid(nextTrack), src: artOf(nextTrack), base: 1 })
  }

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    g.current = { x: e.clientX, y: e.clientY, dx: 0, horiz: null, vx: 0, lastX: e.clientX, lastT: e.timeStamp, eff: 0 }
  }
  const onMove = (e) => {
    const s = g.current
    if (!s) return
    const dx = e.clientX - s.x, dy = e.clientY - s.y
    if (s.horiz === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.horiz = Math.abs(dx) > Math.abs(dy) * 1.3   // commit only to a clearly-horizontal drag
      if (!s.horiz) { g.current = null; return }     // vertical → don't hijack the gesture
      setDragging(true)
    }
    s.dx = dx
    const dt = Math.max(1, e.timeStamp - s.lastT)
    s.vx = (e.clientX - s.lastX) / dt
    s.lastX = e.clientX; s.lastT = e.timeStamp
    // rubber-band when there's no peek that way
    s.eff = ((dx > 0 && !hasPrev) || (dx < 0 && !hasNext)) ? dx * 0.3 : dx
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; if (g.current) setDrag(g.current.eff) })
    }
  }
  const clearRaf = () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0 } }
  const onUp = () => {
    const s = g.current; g.current = null; clearRaf()
    if (!s || !s.horiz) return            // never engaged a horizontal drag → drag is still 0
    // one commit: reset drag + re-enable transition (+ shift the window via skip) → one clean slide
    setDragging(false); setDrag(0)
    const flick = Math.abs(s.vx) > FLICK_V && Math.abs(s.dx) > 24
    if ((s.dx <= -SKIP_PX || (flick && s.dx < 0)) && hasNext) skipNext()
    else if ((s.dx >= SKIP_PX || (flick && s.dx > 0)) && hasPrev) skipPrevious()
  }
  const onCancel = () => {
    const s = g.current; g.current = null; clearRaf()
    if (s?.horiz) { setDragging(false); setDrag(0) }  // glide back, never commit a skip
  }

  return (
    <div className="art-carousel" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}>
      {tiles.map((t) => (
        <div key={t.key} className="car-tile" style={tileStyle(t.base + drag / STEP, dragging)}>
          {t.src ? <img src={t.src} alt="" /> : <div className="art-empty" />}
        </div>
      ))}
    </div>
  )
}

// Memoized so the 250ms position ticker (which re-renders the player) doesn't re-render the
// carousel — its tracks/card props are referentially stable between track changes.
export default React.memo(ArtCarousel)
