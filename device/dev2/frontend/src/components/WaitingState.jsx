import React from 'react'
import { logo, waveOrange } from '../assets/index.js'

// Empty / waiting + loading. The loading splash is connection-aware so a stuck card on
// a flaky link shows "Reconnecting…" / "Trouble reaching Spotify…" instead of an
// infinite "Doing some Eddi Stuff…".
export default function WaitingState({ mode = 'waiting', cardName, connection, offline }) {
  if (mode === 'loading') {
    const msg = offline
      ? 'Reconnecting…'
      : connection === 'dead'
        ? 'Trouble reaching Spotify…'
        : 'Doing some Eddi Stuff…'
    return (
      <div className="screen splash">
        <img className="splash-logo" src={logo} alt="Eddi" />
        <div className="splash-status">
          <img className="splash-wave" src={waveOrange} alt="" /> {msg}
        </div>
      </div>
    )
  }

  if (mode === 'unrecognized') {
    return (
      <div className="screen waiting">
        <img className="logo" src={logo} alt="Eddi" />
        <div className="empty-art">
          <div className="empty-art-inner">
            <img className="wave-mark" src={waveOrange} alt="" />
            <div className="empty-label">Card not recognized</div>
            <div className="empty-sublabel">Lift it and tap again</div>
          </div>
        </div>
        <div className="build-label">eddi · dev2</div>
        <div className="drawer-handle static"><span className="grip" /></div>
      </div>
    )
  }

  return (
    <div className="screen waiting">
      <img className="logo" src={logo} alt="Eddi" />
      <div className="empty-art">
        <div className="empty-art-inner">
          <img className="wave-mark" src={waveOrange} alt="" />
          <div className="empty-label">Eddi is ready</div>
        </div>
      </div>
      <div className="build-label">eddi · dev2</div>
      <div className="drawer-handle static"><span className="grip" /></div>
    </div>
  )
}
