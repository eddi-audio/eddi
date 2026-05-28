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

async function extractPalette(imageBuffer: Buffer): Promise<{ background: string; primary: string; secondary: string }> {
  // Sample 3 regions: dominant (full image → 1px), edge (corners), midpoint
  const [dominant, topLeft, bottomRight] = await Promise.all([
    sharp(imageBuffer).resize(1, 1, { fit: 'cover' }).raw().toBuffer(),
    sharp(imageBuffer).extract({ left: 0, top: 0, width: 50, height: 50 }).resize(1, 1).raw().toBuffer(),
    sharp(imageBuffer).extract({ left: -50, top: -50, width: 50, height: 50 }).resize(1, 1).raw().toBuffer().catch(() => Buffer.from([20, 20, 20])),
  ])

  function toHex(buf: Buffer): string {
    const r = buf[0] ?? 20
    const g = buf[1] ?? 20
    const b = buf[2] ?? 20
    // Darken by 40% for background use
    return `#${Math.floor(r * 0.4).toString(16).padStart(2, '0')}${Math.floor(g * 0.4).toString(16).padStart(2, '0')}${Math.floor(b * 0.4).toString(16).padStart(2, '0')}`
  }

  function toHexBright(buf: Buffer): string {
    return `#${(buf[0] ?? 200).toString(16).padStart(2, '0')}${(buf[1] ?? 200).toString(16).padStart(2, '0')}${(buf[2] ?? 200).toString(16).padStart(2, '0')}`
  }

  return {
    background: toHex(dominant),
    primary: toHexBright(topLeft),
    secondary: toHexBright(bottomRight),
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
  } catch {
    // Fall through: use original URL and default palette
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

  const path = event.requestContext?.http?.path ?? ''

  if (path.includes('/resolve')) {
    return handleResolve(body as { url?: string })
  }

  return handleCreateCard(body as Parameters<typeof handleCreateCard>[0])
}
