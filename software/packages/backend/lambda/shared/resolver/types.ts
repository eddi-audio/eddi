import type { ServiceKey } from '../types'

/**
 * Cross-service resolver contract. Every per-service resolver (Apple, Tidal,
 * YouTube Music via ytmusicapi, Musicfetch, etc.) implements ServiceResolver so
 * the pipeline can swap official ↔ unofficial ↔ paid third-party methods per
 * service without touching card-write. See docs/architecture-system.md §2.6.
 */

/** Normalized identity of a single recording, extracted from the source URL. */
export interface TrackIdentity {
  isrc?: string          // 12-char ISRC — the universal cross-service track key
  upc?: string           // album UPC — universal cross-service album key
  title: string
  artist?: string
  durationMs?: number    // used for title+artist matching where no ISRC exists (YTM)
}

export type ResolveContentType = 'track' | 'album' | 'playlist'

/** One playlist track to be resolved per-service (best-effort, by ISRC). */
export interface PlaylistTrack extends TrackIdentity {
  position: number
}

/**
 * What a per-service resolver returns for one request. `url` is the direct
 * HTTPS link on that service; absent = not matched (catalog gap / region).
 */
export interface ServiceMatch {
  service: ServiceKey
  url?: string
  matched: boolean
  // For playlists: how many of the requested tracks this service could match.
  matchedCount?: number
  totalCount?: number
}

export interface ServiceResolver {
  readonly service: ServiceKey
  /** Resolve a single track/album by identity. */
  resolveOne(id: TrackIdentity, contentType: ResolveContentType): Promise<ServiceMatch>
  /**
   * Resolve a playlist as best-effort per-track matches. Default services can
   * implement this as "match each track, report the count" — there is no
   * cross-service playlist object (see architecture §2.6 playlist handling).
   */
  resolvePlaylist?(tracks: PlaylistTrack[]): Promise<ServiceMatch>
}

/** Final shape merged into card.service_uris + the honest per-service counts. */
export interface ResolutionResult {
  service_uris: Partial<Record<ServiceKey, string>>
  // Per-service match transparency for playlists ("45 of 47 on Apple Music").
  match_counts?: Partial<Record<ServiceKey, { matched: number; total: number }>>
}
