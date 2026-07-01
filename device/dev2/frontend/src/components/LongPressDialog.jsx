import React from 'react'

// Long-press dialog — Figma node 78:333. Per-track actions over a blurred sheet.
export default function LongPressDialog({ track, playlistId, onAdd, onRemove, onClose }) {
  const name = track?.name || 'This track'
  const act = (fn) => () => { fn?.(track.uri); onClose() }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">{name}</div>
        <div className="dialog-sub">Track options</div>

        <div className="dialog-actions">
          {playlistId && (
            <button className="dialog-action ripple" onClick={act(onAdd)}>
              <span className="bullet">＋</span> Add to this playlist
            </button>
          )}
          {playlistId && (
            <button className="dialog-action ripple" onClick={act(onRemove)}>
              <span className="bullet">－</span> Remove from this playlist
            </button>
          )}
        </div>

        <button className="dialog-back" onClick={onClose}>Back</button>
      </div>
    </div>
  )
}
