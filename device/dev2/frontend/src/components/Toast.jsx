import React from 'react'

// Minimal functional toast (Daniel restyles the visual). Bottom-center banner with an
// optional action button. Used for the "Device offline · Refresh" recovery affordance.
export default function Toast({ message, actionLabel, onAction, busy }) {
  return (
    <div className="toast" role="status">
      <span className="toast-msg">{message}</span>
      {actionLabel && (
        <button className="toast-action ripple" onClick={onAction} disabled={busy}>
          {busy ? '…' : actionLabel}
        </button>
      )}
    </div>
  )
}
