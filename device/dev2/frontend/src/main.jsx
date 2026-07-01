import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles.css'

// Lightweight Material-ish tap ripple on any element carrying the `ripple` class.
// One document-level listener — no per-component wiring, no library. The element
// needs `overflow: hidden` + a positioned context (both set in styles.css).
function initRipple() {
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.ripple')
    if (!el) return
    const r = el.getBoundingClientRect()
    const d = Math.max(r.width, r.height) * 2
    const ink = document.createElement('span')
    ink.className = 'ripple-ink'
    ink.style.width = ink.style.height = `${d}px`
    ink.style.left = `${e.clientX - r.left}px`
    ink.style.top = `${e.clientY - r.top}px`
    ink.addEventListener('animationend', () => ink.remove())
    el.appendChild(ink)
  }, { passive: true })
}
initRipple()

// One QueryClient for the whole app — server-state (card, queue, membership, net
// status) lives here with built-in loading/error/retry/refetch. The kiosk is always
// focused, so disable refetch-on-focus; retry transient failures with backoff.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
      refetchOnWindowFocus: false,
      staleTime: 1000,
    },
  },
})

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </ErrorBoundary>,
)
