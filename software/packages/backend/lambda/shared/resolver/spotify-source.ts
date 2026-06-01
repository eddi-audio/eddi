import type { TrackIdentity, PlaylistTrack } from './types'

/**
 * Spotify as the SOURCE service: extract the universal cross-service keys
 * (ISRC for tracks, UPC for albums, per-track ISRCs for playlists) from a
 * Spotify URL. These keys feed every target-service resolver.
 *
 * Uses the same client-credentials token the card-write lambda already holds —
 * no new accounts. `GET /v1/tracks/{id}` exposes `external_ids.isrc`
 * (architecture §2.6: available today, Spotify reverted its Feb-2026 removal).
 */

const API = 'https://api.spotify.com/v1'

export type SpotifySourceType = 'track' | 'album' | 'playlist'

export interface SpotifySource {
  type: SpotifySourceType
  /** Single track/album identity (undefined for playlist). */
  identity?: TrackIdentity
  /** Per-track identities for a playlist, in order. */
  tracks?: PlaylistTrack[]
  /** Spotify playlist owner — preserved for attribution (architecture: original
   * creator stays on the source service). */
  ownerName?: string
}

interface SpotifyExternalIds { isrc?: string; upc?: string }

async function api<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Spotify ${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

/** Extract ISRC for a single track. */
export async function getTrackIdentity(token: string, id: string): Promise<TrackIdentity> {
  const t = await api<{
    name: string
    duration_ms: number
    artists: Array<{ name: string }>
    external_ids: SpotifyExternalIds
  }>(token, `/tracks/${id}`)
  return {
    isrc: t.external_ids?.isrc,
    title: t.name,
    artist: t.artists?.[0]?.name,
    durationMs: t.duration_ms,
  }
}

/** Extract UPC for an album (UPC is the album-level universal key). */
export async function getAlbumIdentity(token: string, id: string): Promise<TrackIdentity> {
  const a = await api<{
    name: string
    artists: Array<{ name: string }>
    external_ids: SpotifyExternalIds
  }>(token, `/albums/${id}`)
  return {
    upc: a.external_ids?.upc,
    title: a.name,
    artist: a.artists?.[0]?.name,
  }
}

/**
 * Extract per-track ISRCs for a playlist, in order, plus the owner for
 * attribution. Paginates (Spotify caps page size at 100).
 */
export async function getPlaylistTracks(
  token: string,
  id: string,
): Promise<{ tracks: PlaylistTrack[]; ownerName?: string }> {
  const head = await api<{ owner?: { display_name?: string } }>(token, `/playlists/${id}?fields=owner(display_name)`)

  interface PlaylistTracksPage {
    items: Array<{
      track: {
        name: string
        duration_ms: number
        artists: Array<{ name: string }>
        external_ids: SpotifyExternalIds
      } | null
    }>
    next: string | null
  }

  const tracks: PlaylistTrack[] = []
  let url: string | null = `/playlists/${id}/tracks?fields=items(track(name,duration_ms,artists(name),external_ids)),next&limit=100`
  let position = 0

  while (url) {
    const page: PlaylistTracksPage = await api<PlaylistTracksPage>(token, url)

    for (const item of page.items) {
      const t = item.track
      if (!t) continue // local/unavailable tracks come back null
      tracks.push({
        position: position++,
        isrc: t.external_ids?.isrc,
        title: t.name,
        artist: t.artists?.[0]?.name,
        durationMs: t.duration_ms,
      })
    }
    // `next` is a full URL; strip the API base to reuse the auth helper.
    url = page.next ? page.next.replace(API, '') : null
  }

  return { tracks, ownerName: head.owner?.display_name }
}
