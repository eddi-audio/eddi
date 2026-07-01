import React, { useState, useEffect, useRef } from 'react'
import { useSpotifySDK } from './hooks/useSpotifySDK.js'
import { usePlayback } from './hooks/usePlayback.js'
import { useCard } from './hooks/useCard.js'
import { useQueue, useInvalidateQueue } from './hooks/useQueue.js'
import { usePlaylist } from './hooks/usePlaylist.js'
import { useSuggestions } from './hooks/useSuggestions.js'
import { useLiked } from './hooks/useLiked.js'
import { useNetStatus } from './hooks/useNetStatus.js'
import Player from './components/Player.jsx'
import QueueSheet, { PEEK, FULL } from './components/QueueSheet.jsx'
import LongPressDialog from './components/LongPressDialog.jsx'
import WaitingState from './components/WaitingState.jsx'
import Toast from './components/Toast.jsx'

export default function App() {
  const sdk = useSpotifySDK()
  const playback = usePlayback(sdk.player)
  const { card, unresolved, playlistId } = useCard()
  const queue = useQueue(!!sdk.deviceId)
  const playlist = usePlaylist(playlistId)
  const { suggestions } = useSuggestions(playback.track)
  const likes = useLiked()
  const net = useNetStatus()

  const [snap, setSnap] = useState(PEEK)
  const [dialogTrack, setDialogTrack] = useState(null)
  const [awaitingTrack, setAwaitingTrack] = useState(false)
  const [likeMsg, setLikeMsg] = useState(null)
  const lastTrackId = useRef(null)
  const awaitTimer = useRef(null)
  const likeTimer = useRef(null)
  const invalidateQueue = useInvalidateQueue()
  const expanded = snap === FULL

  // Clear the dialog when the card is removed; collapse the sheet to peek on any card change.
  useEffect(() => { if (!card) setDialogTrack(null) }, [card])
  useEffect(() => { setSnap(PEEK) }, [card?.card_uid])
  // Always show a fresh up-next when the sheet expands.
  useEffect(() => { if (expanded) invalidateQueue() }, [expanded, invalidateQueue])

  // On a NEW card, show the loading state until its track actually arrives — never the
  // previous card's stale art (which happened when the SDK was mid-reconnect). 8s fallback
  // so we never wedge if the SDK happens to push the same track id.
  useEffect(() => {
    if (!card?.card_uid) { setAwaitingTrack(false); return undefined }
    setAwaitingTrack(true)
    clearTimeout(awaitTimer.current)
    awaitTimer.current = setTimeout(() => setAwaitingTrack(false), 8000)
    return () => clearTimeout(awaitTimer.current)
  }, [card?.card_uid])
  useEffect(() => {
    const id = playback.track?.id
    if (id && id !== lastTrackId.current) {
      lastTrackId.current = id
      setAwaitingTrack(false)
      clearTimeout(awaitTimer.current)
    }
  }, [playback.track])

  // Favorite (∿-heart): toggle the playing track in "∿ liked on eddi ∿" + a brief toast.
  // Guarded on awaitingTrack: while a new card is loading we show ITS art (not the live track),
  // so a tap must not like the previous card's still-`current` track.
  const onToggleLike = () => {
    if (awaitingTrack) return
    const uri = playback.track?.uri
    if (!uri) return
    const nowLiked = likes.toggleLike(uri)
    setLikeMsg(nowLiked ? 'Saved to ∿ liked on eddi ∿' : 'Removed from ∿ liked on eddi ∿')
    clearTimeout(likeTimer.current)
    likeTimer.current = setTimeout(() => setLikeMsg(null), 2600)
  }

  // Dev escape hatch: 10 taps in the top-right corner drops the kiosk to the desktop.
  useEffect(() => {
    let count = 0, timer = null
    const onTap = (e) => {
      if (e.clientX > window.innerWidth - 60 && e.clientY < 60) {
        count += 1
        clearTimeout(timer)
        timer = setTimeout(() => { count = 0 }, 3000)
        if (count >= 10) {
          count = 0
          fetch('http://localhost:5000/dev/exit-kiosk', { method: 'POST' }).catch(() => {})
        }
      }
    }
    window.addEventListener('pointerdown', onTap)
    return () => { window.removeEventListener('pointerdown', onTap); clearTimeout(timer) }
  }, [])

  const offlineToast = !net.online
    ? <Toast message="Device offline" actionLabel="Refresh" onAction={net.refresh} busy={net.refreshing} />
    : null

  if (!card) return <><WaitingState mode="waiting" />{offlineToast}</>
  // Card present but the backend couldn't resolve it to anything playable (404 /
  // unlinked card). Show a clear state instead of hanging forever in "loading".
  if (unresolved) return <><WaitingState mode="unrecognized" />{offlineToast}</>

  // Render the player as soon as the card resolves — show its art/name right away instead of
  // hanging on "loading" while the SDK connects (~20s). `awaiting` hides a stale previous-card
  // track until the fresh one arrives; the live track + transport fill in when the SDK is ready.
  return (
    <div className="app">
      <Player card={card} playback={playback} awaiting={awaitingTrack} liked={!awaitingTrack && likes.isLiked(playback.track?.uri)} onToggleLike={onToggleLike} />
      <div className="sheet-scrim" style={{ opacity: expanded ? 1 : 0 }} />
      <QueueSheet
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        card={card}
        playlistId={playlistId}
        playback={playback}
        queue={queue}
        suggestions={suggestions}
        playlistUris={playlist.playlistUris}
        onLongPress={setDialogTrack}
      />
      {dialogTrack && (
        <LongPressDialog
          track={dialogTrack}
          playlistId={playlistId}
          onAdd={(uri) => playlistId && playlist.addToPlaylist(uri)}
          onRemove={(uri) => playlistId && playlist.removeFromPlaylist(uri)}
          onClose={() => setDialogTrack(null)}
        />
      )}
      {likeMsg && <Toast message={likeMsg} />}
      {offlineToast}
    </div>
  )
}
