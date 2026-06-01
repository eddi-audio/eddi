import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import type { ServiceKey } from '../types'

/**
 * ISRC cache (DynamoDB `eddi-isrc-cache`, PK `isrc`, 90-day TTL). A track
 * resolved once is pre-resolved for every future card containing it — popular
 * music is a small catalog tapped repeatedly (architecture §2.6 caching).
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const TABLE = process.env.ISRC_CACHE_TABLE
const TTL_DAYS = 90

export interface CachedResolution {
  isrc: string
  service_uris: Partial<Record<ServiceKey, string>>
  resolved_at: string
  ttl: number
}

/** Returns cached per-service URLs for an ISRC, or null on miss / no table. */
export async function getCached(isrc: string): Promise<CachedResolution | null> {
  if (!TABLE || !isrc) return null
  try {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { isrc } }))
    return (res.Item as CachedResolution) ?? null
  } catch (e) {
    console.error('isrc-cache get failed', e)
    return null // cache is an optimization; never block resolution on it
  }
}

/** Writes resolved per-service URLs for an ISRC with a rolling 90-day TTL. */
export async function putCached(
  isrc: string,
  service_uris: Partial<Record<ServiceKey, string>>,
): Promise<void> {
  if (!TABLE || !isrc) return
  try {
    await ddb.send(new PutCommand({
      TableName: TABLE,
      Item: {
        isrc,
        service_uris,
        resolved_at: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + TTL_DAYS * 86400,
      } satisfies CachedResolution,
    }))
  } catch (e) {
    console.error('isrc-cache put failed', e)
  }
}
