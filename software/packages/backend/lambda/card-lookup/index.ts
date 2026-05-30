import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import type { Card } from '../shared/types'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const CARDS_TABLE = process.env.CARDS_TABLE!
const EVENTS_TABLE = process.env.CARD_EVENTS_TABLE!

function ok(body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  }
}

function err(status: number, code: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ error: code }),
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  // Keep-alive ping from EventBridge
  if ((event as unknown as { source?: string }).source === 'keep-alive') {
    return { statusCode: 200, body: 'ok' }
  }

  const id = event.pathParameters?.id
  if (!id) return err(400, 'MISSING_ID')

  const { Item } = await ddb.send(new GetCommand({
    TableName: CARDS_TABLE,
    Key: { id },
  }))

  if (!Item) return err(404, 'NOT_FOUND')

  const card = Item as Card

  if (!card.is_active) return err(404, 'DEACTIVATED')

  // Atomically increment tap_count and log event — fire-and-forget, don't block response
  const ts = Date.now()
  Promise.all([
    ddb.send(new UpdateCommand({
      TableName: CARDS_TABLE,
      Key: { id },
      UpdateExpression: 'ADD tap_count :one SET updated_at = :now',
      ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
    })),
    ddb.send(new UpdateCommand({
      TableName: EVENTS_TABLE,
      Key: { card_id: id, ts_event_id: `${ts}#tap` },
      UpdateExpression: 'SET event_type = :t, #ua = :ua, #ttl = :ttl',
      ExpressionAttributeNames: { '#ua': 'user_agent', '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':t': 'tap',
        ':ua': event.requestContext?.http?.userAgent ?? '',
        ':ttl': Math.floor(ts / 1000) + 30 * 86400,
      },
    })),
  ]).catch(() => {})

  // Return card without internal fields
  const { created_by: _createdBy, ...publicCard } = card
  return ok({ ...publicCard, tap_count: (card.tap_count ?? 0) + 1 })
}
