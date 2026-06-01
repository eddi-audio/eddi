export type ServiceKey = 'spotify' | 'apple_music' | 'tidal' | 'youtube_music' | 'amazon_music'
export type ContentType = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode'
export type CardSource = 'user' | 'currents' | 'promo'

export interface ArtworkPalette {
  background: string
  primary: string
  secondary: string
}

export interface MatchCount {
  matched: number
  total: number
}

export interface Card {
  id: string
  title: string
  artwork_url: string
  artwork_palette: ArtworkPalette
  content_type: ContentType
  track_count?: number
  service_uris: Partial<Record<ServiceKey, string>>
  /** Universal cross-service keys (track ISRC / album UPC). */
  isrc?: string
  upc?: string
  /** Original creator on the source service (e.g. Spotify playlist owner). */
  source_attribution?: string
  /** Per-service best-effort match counts for playlists. */
  match_counts?: Partial<Record<ServiceKey, MatchCount>>
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
  /** Universal cross-service keys, carried through to the created card. */
  isrc?: string
  upc?: string
  /** Spotify playlist owner, carried through to the created card. */
  attribution?: string
  /** Per-service playlist match counts, carried through to the created card. */
  match_counts?: Partial<Record<ServiceKey, MatchCount>>
}
