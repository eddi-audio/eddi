import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useCard } from '../hooks/useCard'
import { useServicePref } from '../hooks/useServicePref'
import { logEvent } from '../api/cards'
import CardHero from '../components/CardHero'
import ServiceButtons from '../components/ServiceButton'
import AttributionBlock from '../components/AttributionBlock'
import ActionBar from '../components/ActionBar'
import BrandBlock from '../components/BrandBlock'
import ErrorState from '../components/ErrorState'

function CardSkeleton() {
  return (
    <div className="min-h-dvh animate-pulse flex flex-col">
      <div className="flex flex-col items-center px-6 pt-10 pb-6">
        <div className="w-56 h-56 rounded-2xl bg-white/10 mb-6" />
        <div className="h-3 w-20 bg-white/10 rounded mb-3" />
        <div className="h-6 w-48 bg-white/15 rounded mb-2" />
        <div className="h-4 w-32 bg-white/10 rounded" />
      </div>
      <div className="flex flex-col gap-3 px-6 pb-6">
        {[1, 2].map(i => (
          <div key={i} className="h-14 rounded-2xl bg-white/10" />
        ))}
      </div>
    </div>
  )
}

export default function CardPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { card, isLoading, error } = useCard(id)
  const { pref, setPreference } = useServicePref()

  useEffect(() => {
    if (card) {
      // Apply artwork palette to CSS variables
      document.documentElement.style.setProperty('--card-bg', card.artwork_palette.background)
      document.documentElement.style.setProperty('--card-primary', card.artwork_palette.primary)
      document.documentElement.style.setProperty('--card-secondary', card.artwork_palette.secondary)

      // Log tap event (fire-and-forget)
      logEvent({ card_id: card.id, event_type: 'tap' }).catch(() => {})
    }
    return () => {
      // Reset to defaults when leaving
      document.documentElement.style.removeProperty('--card-bg')
      document.documentElement.style.removeProperty('--card-primary')
      document.documentElement.style.removeProperty('--card-secondary')
    }
  }, [card])

  if (isLoading) return <CardSkeleton />

  if (error) {
    return <ErrorState error={error} onRetry={() => window.location.reload()} />
  }

  if (!card) return null

  const hasUris = Object.keys(card.service_uris).length > 0
  if (!hasUris) {
    return <ErrorState error="NO_URIS" />
  }

  return (
    <div
      className="min-h-dvh flex flex-col transition-colors duration-700"
      style={{ background: `linear-gradient(180deg, var(--card-bg) 0%, #0a0a0a 60%)` }}
    >
      <CardHero
        title={card.title}
        artworkUrl={card.artwork_url}
        contentType={card.content_type}
        trackCount={card.track_count}
      />

      <AttributionBlock source={card.source} createdByDisplay={card.created_by_display} />

      <ServiceButtons
        serviceUris={card.service_uris}
        preferred={pref}
        onSelect={setPreference}
      />

      <ActionBar cardId={card.id} tapCount={card.tap_count} />

      <BrandBlock />

      <div className="flex justify-center gap-5 px-6 py-4 border-t border-white/5">
        <a href="https://instagram.com/eddiaudio" className="text-white/25 hover:text-white/60 transition-colors text-xs">Instagram</a>
        <a href="https://tiktok.com/@eddiaudio" className="text-white/25 hover:text-white/60 transition-colors text-xs">TikTok</a>
        <a href="https://twitter.com/eddiaudio" className="text-white/25 hover:text-white/60 transition-colors text-xs">X</a>
      </div>
    </div>
  )
}
