import type { ServiceKey } from '../types'
import type { ServiceResolver, ResolutionResult, ResolveContentType } from './types'
import { getCached, putCached } from './cache'
import {
  getTrackIdentity, getAlbumIdentity, getPlaylistTracks,
  type SpotifySourceType,
} from './spotify-source'

/**
 * Cross-service resolver orchestrator (architecture §2.6).
 *
 * Pipeline:
 *   1. Extract universal keys from the Spotify source (ISRC / UPC / per-track ISRCs).
 *   2. For tracks: check the ISRC cache first; on hit, return immediately.
 *   3. Fan out to every registered target ServiceResolver.
 *   4. Merge into service_uris (+ honest match_counts for playlists), cache.
 *
 * Target resolvers register here as their accounts/keys land (Apple Music,
 * Tidal, YouTube Music via ytmusicapi, Musicfetch). With none registered, the
 * pipeline still extracts + caches keys and returns Spotify-only — a safe no-op
 * superset of today's behavior.
 */

const targetResolvers: ServiceResolver[] = [
  // Register here, e.g.: new AppleMusicResolver(), new TidalResolver()
]

export function registerResolver(r: ServiceResolver): void {
  targetResolvers.push(r)
}

interface ResolveInput {
  token: string
  type: SpotifySourceType
  id: string
  spotifyUrl: string
}

export interface ResolveOutput extends ResolutionResult {
  /** Spotify playlist owner, preserved for attribution. */
  attribution?: string
}

export async function resolveAllServices(input: ResolveInput): Promise<ResolveOutput> {
  const { token, type, id, spotifyUrl } = input
  const service_uris: Partial<Record<ServiceKey, string>> = { spotify: spotifyUrl }
  const match_counts: ResolutionResult['match_counts'] = {}
  let attribution: string | undefined

  const contentType: ResolveContentType =
    type === 'album' ? 'album' : type === 'playlist' ? 'playlist' : 'track'

  if (contentType === 'playlist') {
    const { tracks, ownerName } = await getPlaylistTracks(token, id)
    attribution = ownerName
    // Best-effort per-service playlist resolution: each resolver matches the
    // tracks it can and reports the count. No foreign playlist object is created
    // — the Eddi card page is the canonical cross-service list (architecture §2.6).
    await Promise.all(targetResolvers.map(async (r) => {
      if (!r.resolvePlaylist) return
      try {
        const m = await r.resolvePlaylist(tracks)
        if (m.url) service_uris[r.service] = m.url
        if (m.matchedCount !== undefined && m.totalCount !== undefined) {
          match_counts[r.service] = { matched: m.matchedCount, total: m.totalCount }
        }
      } catch (e) {
        console.error(`resolver ${r.service} playlist failed`, e)
      }
    }))
    return { service_uris, match_counts, attribution }
  }

  // Track / album: single universal key.
  const identity = contentType === 'album'
    ? await getAlbumIdentity(token, id)
    : await getTrackIdentity(token, id)

  // Cache is keyed by ISRC (tracks only — albums use UPC, not cached yet).
  if (identity.isrc) {
    const cached = await getCached(identity.isrc)
    if (cached) {
      return { service_uris: { ...cached.service_uris, spotify: spotifyUrl }, attribution }
    }
  }

  await Promise.all(targetResolvers.map(async (r) => {
    try {
      const m = await r.resolveOne(identity, contentType)
      if (m.matched && m.url) service_uris[r.service] = m.url
    } catch (e) {
      console.error(`resolver ${r.service} resolveOne failed`, e)
    }
  }))

  // Cache the cross-service set for this ISRC (sans spotify, which is the source).
  if (identity.isrc) {
    const { spotify: _spotify, ...targets } = service_uris
    if (Object.keys(targets).length > 0) await putCached(identity.isrc, targets)
  }

  return { service_uris, match_counts, attribution }
}
