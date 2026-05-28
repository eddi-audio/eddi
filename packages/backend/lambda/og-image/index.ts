import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, HeadObjectCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import sharp from 'sharp'
import type { Card } from '../shared/types'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const s3 = new S3Client({})

const CARDS_TABLE = process.env.CARDS_TABLE!
const ARTWORK_BUCKET = process.env.ARTWORK_BUCKET!
const OG_IMAGE_BUCKET = process.env.OG_IMAGE_BUCKET!

const CORS = { 'Access-Control-Allow-Origin': '*' }

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

async function generateOgImage(card: Card): Promise<Buffer> {
  const W = 1200
  const H = 630
  const artSize = 420

  // Fetch artwork from S3 (already cached there at write time)
  let artworkBuffer: Buffer | null = null
  try {
    const artKey = `artwork/${card.id}.jpg`
    const artObj = await s3.send(new GetObjectCommand({ Bucket: ARTWORK_BUCKET, Key: artKey }))
    artworkBuffer = Buffer.from(await artObj.Body!.transformToByteArray())
  } catch {
    // Fallback: fetch from artwork_url directly
    try {
      const res = await fetch(card.artwork_url)
      if (res.ok) artworkBuffer = Buffer.from(await res.arrayBuffer())
    } catch { /* use gradient only */ }
  }

  // Build base: dark gradient background
  const bg = await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } },
  }).png().toBuffer()

  const layers: sharp.OverlayOptions[] = []

  // Artwork (centered, left-biased: x=120, vertically centered)
  if (artworkBuffer) {
    const art = await sharp(artworkBuffer)
      .resize(artSize, artSize, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer()
    layers.push({ input: art, left: 120, top: Math.floor((H - artSize) / 2) })
  }

  // Gradient overlay on right side for text legibility
  const overlayWidth = W - artSize - 120 - 40  // right section width
  const overlayLeft = 120 + artSize + 40
  const gradient = await sharp({
    create: { width: overlayWidth, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer()
  layers.push({ input: gradient, left: overlayLeft, top: 0 })

  // Text overlay via SVG
  const title = truncate(card.title, 40)
  const subtitle = card.content_type.charAt(0).toUpperCase() + card.content_type.slice(1)
    + (card.track_count ? ` · ${card.track_count} tracks` : '')
  const attribution = card.source === 'user' && card.created_by_display
    ? `by ${card.created_by_display}`
    : card.source === 'currents' ? 'Eddi Currents' : ''

  const textX = overlayLeft + 20
  const svgText = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="${overlayLeft}" y="0" width="${overlayWidth}" height="${H}" fill="rgba(10,10,10,0.5)"/>
    <text x="${textX}" y="230" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="white" xml:space="preserve">${escapeXml(title)}</text>
    <text x="${textX}" y="295" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="rgba(255,255,255,0.6)">${escapeXml(subtitle)}</text>
    ${attribution ? `<text x="${textX}" y="335" font-family="system-ui, -apple-system, sans-serif" font-size="22" fill="rgba(255,255,255,0.4)">${escapeXml(attribution)}</text>` : ''}
    <text x="${W - 40}" y="${H - 30}" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="600" fill="rgba(255,255,255,0.3)">eddi</text>
  </svg>`

  layers.push({ input: Buffer.from(svgText), left: 0, top: 0 })

  return sharp(bg).composite(layers).jpeg({ quality: 90 }).toBuffer()
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const id = event.pathParameters?.id
  if (!id) return { statusCode: 400, headers: CORS, body: 'Missing id' }

  const ogKey = `og/${id}.jpg`

  // Cache hit → redirect to S3
  try {
    await s3.send(new HeadObjectCommand({ Bucket: OG_IMAGE_BUCKET, Key: ogKey }))
    return {
      statusCode: 302,
      headers: {
        ...CORS,
        Location: `https://${OG_IMAGE_BUCKET}.s3.amazonaws.com/${ogKey}`,
        'Cache-Control': 'public, max-age=300',
      },
      body: '',
    }
  } catch { /* not cached yet */ }

  // Fetch card
  const { Item } = await ddb.send(new GetCommand({ TableName: CARDS_TABLE, Key: { id } }))
  if (!Item) return { statusCode: 404, headers: CORS, body: 'Not found' }

  const card = Item as Card

  const imageBuffer = await generateOgImage(card)

  await s3.send(new PutObjectCommand({
    Bucket: OG_IMAGE_BUCKET,
    Key: ogKey,
    Body: imageBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=86400',
  }))

  return {
    statusCode: 302,
    headers: {
      ...CORS,
      Location: `https://${OG_IMAGE_BUCKET}.s3.amazonaws.com/${ogKey}`,
      'Cache-Control': 'public, max-age=300',
    },
    body: '',
  }
}
