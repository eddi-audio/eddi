import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const EVENTS_TABLE = process.env.CARD_EVENTS_TABLE!

const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const cardId = event.pathParameters?.id
  if (!cardId) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'MISSING_ID' }) }

  let body: { event_type?: string; service_selected?: string; referrer?: string } = {}
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
      referrer: body.referrer ?? event.requestContext?.http?.userAgent,
      user_agent: event.requestContext?.http?.userAgent,
      ttl,
    },
  }))

  return { statusCode: 204, headers: CORS, body: '' }
}
