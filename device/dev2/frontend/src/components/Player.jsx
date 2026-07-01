import React, { useRef, useState, useEffect } from 'react'
import { logo } from '../assets/index.js'
import { PlayIcon, PlayingWave, ShuffleIcon, RepeatIcon, RepeatOneIcon, HeartIcon } from './icons.jsx'
import ArtCarousel from './ArtCarousel.jsx'

const ACCENT = '#f0581f'
const LIGHT = '#c8c7d6'
const MUTED = '#838295'

const fmt = (ms) => {
  const s = Math.floor((ms || 0) / 1000)
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

// Cross-fades when `src` changes — used for the blurred backdrop (the album art transitions via
// the carousel slide). Stacks the new image over the old, fades it in, drops the old. First
// image appears with no fade.
function CrossfadeImg({ src, className, imgClass }) {
  const [layers, setLayers] = useState(() => (src ? [{ src, k: 0 }] : []))
  const kRef = useRef(0)
  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1]
      if (!src || (top && top.src === src)) return prev
      kRef.current += 1
      return [...prev.slice(-1), { src, k: kRef.current }]
    })
  }, [src])
  return (
    <div className={className}>
      {layers.map((l, i) => {
        const isTop = i === layers.length - 1
        return (
          <img
            key={l.k} src={l.src} alt="" className={imgClass}
            style={isTop && layers.length > 1 ? { animation: 'xf-in .34s ease forwards' } : undefined}
            onAnimationEnd={isTop ? () => setLayers((p) => (p.length > 1 ? [p[p.length - 1]] : p)) : undefined}
          />
        )
      })}
    </div>
  )
}

// Player UI (Figma 116:560). Blurred backdrop, a swipe-to-skip album-art carousel (ArtCarousel),
// and a glassy transport row: wide play/pause (▷ paused, ∿ playing), the eddi-heart favorite, and
// separate shuffle (toggle) + repeat (off→one→all). No skip buttons — swipe the art.
export default function Player({ card, playback, awaiting, liked, onToggleLike }) {
  const { track, nextTrack, prevTrack, paused, position, duration, shuffle, repeatMode,
          skipNext, skipPrevious, togglePlay, toggleShuffle, cycleRepeat, seek } = playback

  // Until the fresh track for this card arrives, show the card's own art/name (never a stale
  // previous-card track). On boot this lets the player appear immediately with card art.
  const live = awaiting ? null : track
  const art = live?.album?.images?.[0]?.url || card?.artwork_url
  const title = live?.name || card?.name || ''
  const artist = live?.artists?.map((a) => a.name).join(', ') || ''
  const pos = awaiting ? 0 : position
  const dur = awaiting ? 0 : duration
  const pct = dur ? Math.min(100, (pos / dur) * 100) : 0
  const repeatActive = repeatMode !== 0

  const onSeek = (e) => {
    if (!dur) return
    const r = e.currentTarget.getBoundingClientRect()
    seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur)
  }

  return (
    <div className="screen player">
      <CrossfadeImg src={art} className="player-bg" imgClass="bg-blur" />

      <img className="logo" src={logo} alt="Eddi" />

      <ArtCarousel
        track={track} nextTrack={nextTrack} prevTrack={prevTrack}
        awaiting={awaiting} card={card} skipNext={skipNext} skipPrevious={skipPrevious}
      />

      <div className="track-info">
        <div className="title">{title}</div>
        <div className="artist">{artist}</div>
      </div>

      <div className="progress" onClick={onSeek}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
        <div className="progress-times">
          <span className="t-elapsed">{fmt(pos)}</span>
          <span className="t-total">{fmt(dur)}</span>
        </div>
      </div>

      <button className="glass-btn play-pause ripple" onClick={togglePlay} aria-label={paused ? 'Play' : 'Pause'}>
        {paused ? <PlayIcon color={LIGHT} size={32} /> : <PlayingWave color={ACCENT} size={34} />}
      </button>
      <button className={`glass-btn fav ripple${liked ? ' liked' : ''}`} onClick={onToggleLike} aria-label="Favorite" aria-pressed={!!liked}>
        <HeartIcon color={liked ? ACCENT : MUTED} size={40} />
      </button>
      <button className={`glass-btn sh ripple${shuffle ? ' active' : ''}`} onClick={toggleShuffle} aria-label="Shuffle" aria-pressed={!!shuffle}>
        <ShuffleIcon color={shuffle ? ACCENT : MUTED} size={28} />
      </button>
      <button className={`glass-btn rp ripple${repeatActive ? ' active' : ''}`} onClick={cycleRepeat} aria-label="Repeat">
        {repeatMode === 2 ? <RepeatOneIcon color={ACCENT} size={28} /> : <RepeatIcon color={repeatActive ? ACCENT : MUTED} size={28} />}
      </button>
    </div>
  )
}
