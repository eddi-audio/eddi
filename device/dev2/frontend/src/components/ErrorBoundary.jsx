import React from 'react'

// Catches any render/lifecycle crash so a JS error never leaves a white screen. Shows a
// minimal fallback and auto-reloads shortly after. Together with the kiosk health
// watchdog (labwc autostart), the app always recovers on its own — a crash that React
// CAN see is caught here; one it can't (white render / GPU stall) is caught by the
// watchdog when the frontend stops polling the backend.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { crashed: false }
    this.timer = null
  }

  static getDerivedStateFromError() {
    return { crashed: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Eddi app crashed — reloading shortly:', error, info)
    this.timer = setTimeout(() => window.location.reload(), 4000)
  }

  componentWillUnmount() {
    if (this.timer) clearTimeout(this.timer)
  }

  render() {
    if (this.state.crashed) {
      return (
        <div className="screen splash">
          <div className="splash-status">∿ Recovering…</div>
        </div>
      )
    }
    return this.props.children
  }
}
