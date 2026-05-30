export type ServiceKey = 'spotify' | 'apple_music' | 'tidal' | 'youtube_music' | 'amazon_music'
export type ContentType = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode'
export type CardSource = 'user' | 'currents' | 'promo'

export interface ArtworkPalette {
  background: string
  primary: string
  secondary: string
}

export interface Card {
  id: string
  title: string
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

export interface ResolveResult {
  title: string
  artwork_url: string
  content_type: ContentType
  track_count?: number
  service_uris: Partial<Record<ServiceKey, string>>
}
