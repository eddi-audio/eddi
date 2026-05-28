interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  API_URL: string
}

interface CardData {
  id: string
  title: string
  description?: string
  artwork_url: string
  content_type: string
  track_count?: number
  source: string
  created_by_display?: string
}

const BOT_PATTERNS = [
  'twitterbot',
  'facebookexternalhit',
  'facebookcatalog',
  'whatsapp',
  'discordbot',
  'slackbot',
  'linkedinbot',
  'googlebot',
  'applebot',
  'bingbot',
  'rogerbot',
  'embedlybot',
  'outbrain',
  'pinterest',
  'tumblr',
  'vkshare',
  'w3c_validator',
  'curl/',
]

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase()
  return BOT_PATTERNS.some(p => ua.includes(p))
}

function contentTypeLabel(type: string, trackCount?: number): string {
  const map: Record<string, string> = {
    track: 'Track',
    album: 'Album',
    playlist: 'Playlist',
    artist: 'Artist',
    show: 'Podcast',
    episode: 'Episode',
  }
  const label = map[type] ?? 'Music'
  return trackCount ? `${label} · ${trackCount} tracks` : label
}

function buildOgHtml(card: CardData, cardId: string, apiUrl: string): string {
  const title = card.title
  const typeLabel = contentTypeLabel(card.content_type, card.track_count)
  const attribution = card.source === 'user' && card.created_by_display
    ? `Made by ${card.created_by_display}`
    : card.source === 'currents'
      ? 'An Eddi Currents pick'
      : 'Listen on your favorite service'
  const description = `${typeLabel} · ${attribution}`
  const ogImage = `${apiUrl}/og/${cardId}`
  const url = `https://eddi.audio/c/${cardId}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} — Eddi</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:type" content="music.playlist" />
  <meta property="og:site_name" content="Eddi" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(url)}">${escapeHtml(title)}</a>...</p>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export async function onRequest(context: { request: Request; env: Env; params: { id: string } }) {
  const { request, env, params } = context
  const cardId = params.id
  const userAgent = request.headers.get('user-agent') ?? ''

  // Non-bots: serve the SPA as-is
  if (!isBot(userAgent)) {
    return env.ASSETS.fetch(request)
  }

  // Bots: fetch card data and return pre-rendered OG HTML
  const apiUrl = env.API_URL ?? 'https://api.eddi.audio'
  try {
    const res = await fetch(`${apiUrl}/cards/${cardId}`, {
      headers: { 'User-Agent': 'EddiBot/1.0 (og-renderer)' },
    })

    if (!res.ok) {
      // Card not found — serve SPA anyway (it will show its own error state)
      return env.ASSETS.fetch(request)
    }

    const card = await res.json() as CardData
    const html = buildOgHtml(card, cardId, apiUrl)

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=60',
      },
    })
  } catch {
    return env.ASSETS.fetch(request)
  }
}
