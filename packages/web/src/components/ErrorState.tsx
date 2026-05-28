import type { CardError } from '../types/card'
import BrandBlock from './BrandBlock'

const MESSAGES: Record<CardError, { heading: string; body: string; cta?: { label: string; href: string } }> = {
  NOT_FOUND: {
    heading: "This card doesn't exist",
    body: "It might have been removed, or the link could be wrong.",
    cta: { label: 'Get your own Eddi card', href: 'https://eddi.audio' },
  },
  DEACTIVATED: {
    heading: 'This card has been taken down',
    body: 'The content on this card is no longer available.',
    cta: { label: 'Explore Eddi', href: 'https://eddi.audio' },
  },
  NO_URIS: {
    heading: "This card hasn't been set up yet",
    body: 'Tap it with the Eddi app to add music.',
    cta: { label: 'Get the Eddi app', href: 'https://eddi.audio/player' },
  },
  SERVER_ERROR: {
    heading: 'Something went wrong',
    body: 'Try tapping the card again.',
  },
}

interface Props {
  error: CardError
  onRetry?: () => void
}

export default function ErrorState({ error, onRetry }: Props) {
  const msg = MESSAGES[error]

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--card-bg)' }}>
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-2">
          <svg className="w-8 h-8 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-white">{msg.heading}</h1>
        <p className="text-sm text-white/50 max-w-xs">{msg.body}</p>
        {error === 'SERVER_ERROR' && onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 px-6 py-3 rounded-full bg-white/10 text-white text-sm font-medium active:bg-white/20"
          >
            Try again
          </button>
        )}
        {msg.cta && (
          <a
            href={msg.cta.href}
            className="mt-2 px-6 py-3 rounded-full bg-white text-black text-sm font-semibold"
          >
            {msg.cta.label}
          </a>
        )}
      </div>
      <BrandBlock />
    </div>
  )
}
