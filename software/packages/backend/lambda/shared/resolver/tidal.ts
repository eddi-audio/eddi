import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import type {
  ServiceResolver, ServiceMatch, TrackIdentity, PlaylistTrack, ResolveContentType,
} from './types'

/**
 * Tidal target resolver. Maps a recording/release to its Tidal URL by ISRC
 * (track) / UPC (album) via Tidal's catalogue v2 API. Catalog reads use the
 * client-credentials grant — no user involvement (verified working 2026-06-01).
 *
 * Auth: client_id/client_secret from SSM (/eddi/prod/tidal/*), cached token.
 * Endpoints:
 *   POST https://auth.tidal.com/v1/oauth2/token            (client_credentials)
 *   GET  https://openapi.tidal.com/v2/tracks?filter[isrc]= (ISRC lookup)
 *   GET  https://openapi.tidal.com/v2/albums?filter[barcodeId]= (UPC lookup)
 * Track URL form: https://tidal.com/browse/track/{id}; album: .../album/{id}.
 */

const TOKEN_URL = 'https://auth.tidal.com/v1/oauth2/token'
const API = 'https://openapi.tidal.com/v2'
const ACCEPT = 'application/vnd.api+json'
const DEFAULT_COUNTRY = 'US'

const ssm = new SSMClient({})

interface TidalTrack {
  id: string
  type: string
  attributes?: { isrc?: string; popularity?: number }
}

export class TidalResolver implements ServiceResolver {
  readonly service = 'tidal' as const

  private token: { value: string; expiresAt: number } | null = null
  private clientId: string | null = null
  private clientSecret: string | null = null
  private readonly idParam: string
  private readonly secretParam: string
  private readonly country: string

  constructor(opts?: { idParam?: string; secretParam?: string; country?: string }) {
    this.idParam = opts?.idParam ?? process.env.TIDAL_CLIENT_ID_PARAM ?? '/eddi/prod/tidal/client_id'
    this.secretParam = opts?.secretParam ?? process.env.TIDAL_CLIENT_SECRET_PARAM ?? '/eddi/prod/tidal/client_secret'
    this.country = opts?.country ?? DEFAULT_COUNTRY
  }

  /** Allow injecting creds directly (local testing) instead of SSM. */
  setCredentials(clientId: string, clientSecret: string): void {
    this.clientId = clientId
    this.clientSecret = clientSecret
  }

  private async loadCreds(): Promise<void> {
    if (this.clientId && this.clientSecret) return
    const [idRes, secRes] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: this.idParam, WithDecryption: true })),
      ssm.send(new GetParameterCommand({ Name: this.secretParam, WithDecryption: true })),
    ])
    this.clientId = idRes.Parameter?.Value ?? ''
    this.clientSecret = secRes.Parameter?.Value ?? ''
  }

  private async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value
    await this.loadCreds()
    const creds = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) throw new Error(`Tidal token ${res.status}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
    return this.token.value
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken()
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, accept: ACCEPT },
    })
    if (!res.ok) throw new Error(`Tidal GET ${path} -> ${res.status}`)
    return res.json() as Promise<T>
  }

  /** Resolve a single track (ISRC) or album (UPC) to its Tidal URL. */
  async resolveOne(id: TrackIdentity, contentType: ResolveContentType): Promise<ServiceMatch> {
    const miss: ServiceMatch = { service: this.service, matched: false }

    if (contentType === 'album') {
      if (!id.upc) return miss
      const r = await this.get<{ data: Array<{ id: string }> }>(
        `/albums?filter%5BbarcodeId%5D=${encodeURIComponent(id.upc)}&countryCode=${this.country}`,
      )
      const albumId = r.data?.[0]?.id
      return albumId
        ? { service: this.service, matched: true, url: `https://tidal.com/browse/album/${albumId}` }
        : miss
    }

    // track
    if (!id.isrc) return miss
    const r = await this.get<{ data: TidalTrack[] }>(
      `/tracks?filter%5Bisrc%5D=${encodeURIComponent(id.isrc)}&countryCode=${this.country}`,
    )
    const trackId = pickBestTrack(r.data)
    return trackId
      ? { service: this.service, matched: true, url: `https://tidal.com/browse/track/${trackId}` }
      : miss
  }

  /** Best-effort playlist resolution: match each track by ISRC, report the count.
   * No Tidal playlist object is created here (that's Save-to-Library, user-OAuth).
   * The first matched track's URL stands in as the service link so the button
   * still opens Tidal. */
  async resolvePlaylist(tracks: PlaylistTrack[]): Promise<ServiceMatch> {
    let matched = 0
    let firstUrl: string | undefined
    // Cap concurrency so we don't hammer Tidal on a big playlist.
    for (const batch of chunk(tracks, 5)) {
      const results = await Promise.all(batch.map(async (t) => {
        if (!t.isrc) return undefined
        try {
          const r = await this.get<{ data: TidalTrack[] }>(
            `/tracks?filter%5Bisrc%5D=${encodeURIComponent(t.isrc)}&countryCode=${this.country}`,
          )
          return pickBestTrack(r.data)
        } catch { return undefined }
      }))
      for (const trackId of results) {
        if (trackId) {
          matched++
          if (!firstUrl) firstUrl = `https://tidal.com/browse/track/${trackId}`
        }
      }
    }
    return {
      service: this.service,
      matched: matched > 0,
      url: firstUrl,
      matchedCount: matched,
      totalCount: tracks.length,
    }
  }
}

/** Multiple Tidal entries share one ISRC (re-ingests/regions); pick the most popular. */
function pickBestTrack(data: TidalTrack[] | undefined): string | undefined {
  if (!data || data.length === 0) return undefined
  let best = data[0]
  for (const t of data) {
    if ((t.attributes?.popularity ?? 0) > (best.attributes?.popularity ?? 0)) best = t
  }
  return best.id
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}
