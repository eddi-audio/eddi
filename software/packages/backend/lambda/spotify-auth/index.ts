import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm'
import { createHash, randomBytes } from 'crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

/**
 * Spotify user OAuth (Authorization Code + PKCE).
 *
 * Purpose: let a card creator authorize reading a playlist THEY own, so we can
 * extract its ISRC tracklist and enrich the card with cross-service buttons.
 * (A non-owned playlist still works as a plain Spotify card — this only adds the
 * other-service buttons. See Notion "Spotify Web API Access Model".)
 *
 * Brand constraint: NO Eddi-native account. The resulting Spotify token is
 * returned to the client and held in the client session; the backend persists
 * only a 10-minute PKCE verifier (auto-expired via TTL), never a user record.
 * (Refresh-token persistence for Save-to-Library is a SEPARATE future decision.)
 *
 * Routes (both on this lambda):
 *   GET /auth/spotify/login      -> 302 to Spotify authorize
 *   GET /auth/spotify/callback   -> exchanges code, returns tokens to the client
 */

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ssm = new SSMClient({})

const AUTH_STATE_TABLE = process.env.AUTH_STATE_TABLE!
const CLIENT_ID_PARAM = process.env.SPOTIFY_CLIENT_ID_PARAM!
const CLIENT_SECRET_PARAM = process.env.SPOTIFY_CLIENT_SECRET_PARAM!
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'https://eddi.audio'

const SCOPES = ['playlist-read-private', 'playlist-read-collaborative'].join(' ')

let clientId: string | null = null
let clientSecret: string | null = null

async function creds(): Promise<{ id: string; secret: string }> {
  if (!clientId || !clientSecret) {
    const [i, s] = await Promise.all([
      ssm.send(new GetParameterCommand({ Name: CLIENT_ID_PARAM, WithDecryption: true })),
      ssm.send(new GetParameterCommand({ Name: CLIENT_SECRET_PARAM, WithDecryption: true })),
    ])
    clientId = i.Parameter?.Value ?? ''
    clientSecret = s.Parameter?.Value ?? ''
  }
  return { id: clientId, secret: clientSecret }
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function handleLogin(): Promise<APIGatewayProxyResultV2> {
  const { id } = await creds()
  const verifier = b64url(randomBytes(64))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  await ddb.send(new PutCommand({
    TableName: AUTH_STATE_TABLE,
    Item: { state, verifier, ttl: Math.floor(Date.now() / 1000) + 600 }, // 10 min
  }))

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  })
  return { statusCode: 302, headers: { Location: `https://accounts.spotify.com/authorize?${params}` }, body: '' }
}

async function handleCallback(query: Record<string, string | undefined>): Promise<APIGatewayProxyResultV2> {
  const { code, state, error } = query
  const fail = (msg: string) => ({
    statusCode: 302,
    headers: { Location: `${WEB_ORIGIN}/auth/spotify/done#error=${encodeURIComponent(msg)}` },
    body: '',
  })

  if (error) return fail(error)
  if (!code || !state) return fail('missing_code_or_state')

  // Look up + consume the PKCE verifier (one-time use).
  const rec = await ddb.send(new GetCommand({ TableName: AUTH_STATE_TABLE, Key: { state } }))
  const verifier = (rec.Item as { verifier?: string } | undefined)?.verifier
  if (!verifier) return fail('invalid_or_expired_state')
  await ddb.send(new DeleteCommand({ TableName: AUTH_STATE_TABLE, Key: { state } }))

  const { id, secret } = await creds()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: id,
    code_verifier: verifier,
  })
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      // Confidential client: PKCE + Basic auth (we have a secret, belt-and-suspenders).
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  if (!res.ok) return fail(`token_exchange_${res.status}`)
  const tok = await res.json() as { access_token: string; expires_in: number; refresh_token?: string }

  // Hand the token to the client via fragment (never logged in query/referrer).
  // Backend stores nothing about the user — on-brand no-account model.
  const frag = new URLSearchParams({
    access_token: tok.access_token,
    expires_in: String(tok.expires_in),
  })
  return {
    statusCode: 302,
    headers: { Location: `${WEB_ORIGIN}/auth/spotify/done#${frag}` },
    body: '',
  }
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.requestContext?.http?.path ?? (event as unknown as { path?: string }).path ?? ''
  const query = (event.queryStringParameters ?? {}) as Record<string, string | undefined>

  if (path.endsWith('/login')) return handleLogin()
  if (path.endsWith('/callback')) return handleCallback(query)
  return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'NOT_FOUND' }) }
}
