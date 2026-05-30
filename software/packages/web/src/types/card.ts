export type ContentType = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode'
export type CardSource = 'user' | 'currents' | 'promo'
export type ServiceKey = 'spotify' | 'apple_music' | 'youtube_music' | 'amazon_music' | 'tidal'

export interface ArtworkPalette {
  background: string  // hex, e.g. "#1a0a2e"
  primary: string     // dominant foreground color
  secondary: string   // accent color
}

export interface Card {
  id: string
  title: string
  description?: string
  artwork_url: string
  artwork_palette: ArtworkPalette
  content_type: ContentType
  track_count?: number
  service_uris: Partial<Record<ServiceKey, string>>
  source: CardSource
  created_by_display?: string
  tap_count: number
  is_active: boolean
  created_at: string
}

export type CardError = 'NOT_FOUND' | 'DEACTIVATED' | 'NO_URIS' | 'SERVER_ERROR'

export interface CardEvent {
  card_id: string
  event_type: 'tap' | 'play' | 'share' | 'duplicate' | 'write'
  service_selected?: ServiceKey
  referrer?: string
}

export interface ResolveResult {
  title: string
  artwork_url: string
  content_type: ContentType
  track_count?: number
  service_uris: Partial<Record<ServiceKey, string>>
}
