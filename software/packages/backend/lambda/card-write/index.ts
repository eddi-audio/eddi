import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { customAlphabet } from 'nanoid'
import sharp from 'sharp'
import type { ContentType, ServiceKey, CardSource } from '../shared/types'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const s3 = new S3Client({})
const ssm = new SSMClient({})

const CARDS_TABLE = process.env.CARDS_TABLE!
const ARTWORK_BUCKET = process.env.ARTWORK_BUCKET!
const SPOTIFY_CLIENT_ID_PARAM = process.env.SPOTIFY_CLIENT_ID_PARAM!
const SPOTIFY_CLIENT_SECRET_PARAM = process.env.SPOTIFY_CLIENT_SECRET_PARAM!

const nanoid = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 8)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

// ── SSM / token cache (survives warm invocations) ────────────────────────────

let spotifyToken: { value: string; expiresAt: number } | null = null
let spotifyClientId: string | null = null
let spotifyClientSecret: string | null = null

async function getSpotifyToken(): Promise<string> {
  if (spotifyToken && Date.now() < spotifyToken.expiresAt) return spotifyToken.value

  if (!spotifyClientId || !spotifyClientSecret) {
    const [idRes, secretRes] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: SPOTIFY_CLIENT_ID_PARAM, WithDecryption: true })),
      ssm.send(new GetParameterCommand({ Name: SPOTIFY_CLIENT_SECRET_PARAM, WithDecryption: true })),
    ])
    spotifyClientId = idRes.Parameter?.Value ?? ''
    spotifyClientSecret = secretRes.Parameter?.Value ?? ''
  }

  const creds = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString('base64')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  const data = await res.json() as { access_token: string; expires_in: number }
  spotifyToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
  return spotifyToken.value
}

// ── Spotify URL parsing ───────────────────────────────────────────────────────

type SpotifyItemType = 'track' | 'album' | 'playlist' | 'artist' | 'show' | 'episode'

function parseSpotifyUrl(url: string): { type: SpotifyItemType; id: string } | null {
  const match = url.match(/open\.spotify\.com\/(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)/)
  if (!match) return null
  return { type: match[1] as SpotifyItemType, id: match[2] }
}

interface SpotifyMeta {
  title: string
  artworkUrl: string
  contentType: ContentType
  trackCount?: number
  spotifyUrl: string
}

async function fetchSpotifyMeta(token: string, type: SpotifyItemType, id: string): Promise<SpotifyMeta> {
  const endpoints: Record<SpotifyItemType, string> = {
    track: `https://api.spotify.com/v1/tracks/${id}`,
    album: `https://api.spotify.com/v1/albums/${id}`,
    playlist: `https://api.spotify.com/v1/playlists/${id}?fields=name,images,tracks.total,external_urls`,
    artist: `https://api.spotify.com/v1/artists/${id}`,
    show: `https://api.spotify.com/v1/shows/${id}`,
    episode: `https://api.spotify.com/v1/episodes/${id}`,
  }

  const res = await fetch(endpoints[type], {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`)
  const data = await res.json() as Record<string, unknown>

  const images = (data.images as Array<{ url: string }>) ?? []
  const artworkUrl = images[0]?.url ?? ''

  const albumImages = (data.album as { images?: Array<{ url: string }> })?.images
  const trackArtwork = albumImages?.[0]?.url ?? artworkUrl

  let title = ''
  let trackCount: number | undefined

  if (type === 'track') {
    title = data.name as string
    return {
      title,
      artworkUrl: trackArtwork || artworkUrl,
      contentType: 'track',
      spotifyUrl: (data.external_urls as { spotify: string }).spotify,
    }
  } else if (type === 'album') {
    title = data.name as string
    trackCount = (data.tracks as { total: number })?.total
  } else if (type === 'playlist') {
    title = data.name as string
    trackCount = (data.tracks as { total: number })?.total
  } else if (type === 'artist') {
    title = data.name as string
  } else if (type === 'show') {
    title = data.name as string
  } else if (type === 'episode') {
    title = data.name as string
  }

  return {
    title,
    artworkUrl,
    contentType: type as ContentType,
    trackCount,
    spotifyUrl: (data.external_urls as { spotify: string }).spotify,
  }
}

// ── Artwork palette extraction ────────────────────────────────────────────────

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue = (t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 0.5) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const r = Math.round(hue(h + 1 / 3) * 255)
  const g = Math.round(hue(h) * 255)
  const b = Math.round(hue(h - 1 / 3) * 255)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

async function extractPalette(imageBuffer: Buffer): Promise<{ background: string; primary: string; secondary: string }> {
  const pixel = await sharp(imageBuffer)
    .resize(1, 1, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer()

  const r = pixel[0] ?? 0
  const g = pixel[1] ?? 0
  const b = pixel[2] ?? 0
  console.log(`Palette source RGB: ${r},${g},${b}`)

  const [h, s] = rgbToHsl(r, g, b)
  // Force minimum saturation so even grey/dark covers get a visible tint
  const sBoosted = Math.max(0.25, Math.min(1, s * 2.5))

  return {
    background: hslToHex(h, sBoosted, 0.22),
    primary:    hslToHex(h, Math.min(1, s * 1.2), 0.80),
    secondary:  hslToHex(h, Math.min(1, s * 0.9), 0.50),
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleResolve(body: { url?: string }): Promise<APIGatewayProxyResultV2> {
  if (!body.url) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'MISSING_URL' }) }

  const parsed = parseSpotifyUrl(body.url)
  if (!parsed) {
    return { statusCode: 422, headers: CORS, body: JSON.stringify({ error: 'UNSUPPORTED_URL', message: 'Only Spotify URLs are supported right now.' }) }
  }

  const token = await getSpotifyToken()
  const meta = await fetchSpotifyMeta(token, parsed.type, parsed.id)

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({
      title: meta.title,
      artwork_url: meta.artworkUrl,
      content_type: meta.contentType,
      track_count: meta.trackCount,
      service_uris: { spotify: meta.spotifyUrl },
    }),
  }
}

async function handleCreateCard(body: {
  title?: string
  artwork_url?: string
  content_type?: string
  track_count?: number
  service_uris?: Partial<Record<ServiceKey, string>>
  display_name?: string
}): Promise<APIGatewayProxyResultV2> {
  if (!body.title || !body.artwork_url || !body.content_type || !body.service_uris) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'MISSING_FIELDS' }) }
  }

  // Generate unique card ID with collision retry
  let cardId = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = nanoid()
    const existing = await ddb.send(new GetCommand({ TableName: CARDS_TABLE, Key: { id: candidate } }))
    if (!existing.Item) { cardId = candidate; break }
  }
  if (!cardId) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ID_COLLISION' }) }

  // Download and cache artwork in S3
  let artworkS3Url = body.artwork_url
  let palette = { background: '#0a0a0a', primary: '#ffffff', secondary: '#888888' }

  try {
    const artRes = await fetch(body.artwork_url)
    if (artRes.ok) {
      const artBuffer = Buffer.from(await artRes.arrayBuffer())
      const artKey = `artwork/${cardId}.jpg`
      await s3.send(new PutObjectCommand({
        Bucket: ARTWORK_BUCKET,
        Key: artKey,
        Body: artBuffer,
        ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000',
      }))
      artworkS3Url = `https://${ARTWORK_BUCKET}.s3.amazonaws.com/${artKey}`
      palette = await extractPalette(artBuffer)
    }
  } catch (e) {
    console.error('Artwork/palette error:', e)
    // TODO: once branding is finalized, design a proper default background/palette
    // to use here instead of the plain dark fallback
  }

  const now = new Date().toISOString()
  const card = {
    id: cardId,
    title: body.title,
    artwork_url: artworkS3Url,
    artwork_palette: palette,
    content_type: body.content_type as ContentType,
    track_count: body.track_count,
    service_uris: body.service_uris,
    source: 'user' as CardSource,
    created_by_display: body.display_name,
    tap_count: 0,
    is_active: true,
    created_at: now,
    updated_at: now,
  }

  await ddb.send(new PutCommand({ TableName: CARDS_TABLE, Item: card }))

  return { statusCode: 201, headers: CORS, body: JSON.stringify({ id: cardId }) }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  let body: Record<string, unknown> = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'INVALID_BODY' }) }
  }

  const path = (event as unknown as { path?: string }).path ?? event.requestContext?.http?.path ?? ''

  if (path.includes('/resolve')) {
    return handleResolve(body as { url?: string })
  }

  return handleCreateCard(body as Parameters<typeof handleCreateCard>[0])
}
