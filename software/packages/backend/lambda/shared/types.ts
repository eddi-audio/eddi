export type ContentType = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode'
export type CardSource = 'user' | 'currents' | 'promo'
export type ServiceKey = 'spotify' | 'apple_music' | 'youtube_music' | 'amazon_music' | 'tidal'

export interface ArtworkPalette {
  background: string
  primary: string
  secondary: string
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
  // Original creator on the source service (e.g. Spotify playlist owner),
  // preserved for attribution — the source playlist stays creator-owned.
  source_attribution?: string
  // Per-service best-effort match counts for playlists, e.g.
  // { apple_music: { matched: 45, total: 47 } } — shown honestly on the card page.
  match_counts?: Partial<Record<ServiceKey, { matched: number; total: number }>>
  source: CardSource
  created_by?: string
  created_by_display?: string
  tap_count: number
  is_active: boolean
  created_at: string
  updated_at: string
}
