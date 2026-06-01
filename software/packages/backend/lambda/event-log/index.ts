import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const EVENTS_TABLE = process.env.CARD_EVENTS_TABLE!

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const cardId = event.pathParameters?.id
  if (!cardId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'MISSING_ID' }) }

  // event_type taxonomy (reserved; not all emitted yet):
  //   card_open      — card page loaded
  //   service_open   — user tapped a service CTA to play (service_selected set)
  //   library_save   — user saved the playlist into their own account
  //                    (service_selected = target service) [save-to-library feature]
  //   device_play    — the Eddi device resolved/played the card
  // `content_key` (the card's ISRC/UPC) is stamped on each event so engagement
  // rolls up BOTH ways: by card_id (this object) and by recording (cross-service
  // graph — "this song is big on Apple AND Spotify"). See docs.
  let body: {
    event_type?: string
    service_selected?: string
    referrer?: string
    content_key?: string
  } = {}
  try {
    body = event.body ? JSON.parse(event.body) : {}
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'INVALID_BODY' }) }
  }

  const ts = Date.now()
  const ttl = Math.floor(ts / 1000) + 30 * 86400

  await ddb.send(new PutCommand({
    TableName: EVENTS_TABLE,
    Item: {
      card_id: cardId,
      ts_event_id: `${ts}#${body.event_type ?? 'unknown'}`,
      event_type: body.event_type ?? 'unknown',
      service_selected: body.service_selected,
      // Universal cross-service key for this card (ISRC/UPC) — enables
      // by-recording aggregation, not just by-card. Optional; absent for cards
      // written before the resolver populated it.
      ...(body.content_key ? { content_key: body.content_key } : {}),
      referrer: body.referrer ?? event.requestContext?.http?.userAgent,
      user_agent: event.requestContext?.http?.userAgent,
      ttl,
    },
  }))

  return { statusCode: 204, headers: CORS, body: '' }
}
