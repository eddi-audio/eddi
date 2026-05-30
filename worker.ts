interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> }
  API_URL?: string
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

function isBot(ua: string): boolean {
  const lower = ua.toLowerCase()
  return BOT_PATTERNS.some(p => lower.includes(p))
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface CardData {
  id: string
  title: string
  artwork_url: string
  content_type: string
  track_count?: number
  source: string
  created_by_display?: string
}

function buildOgHtml(card: CardData, cardId: string, apiUrl: string): string {
  const typeLabel = contentTypeLabel(card.content_type, card.track_count)
  const attribution =
    card.source === 'user' && card.created_by_display
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
  <title>${escapeHtml(card.title)} — Eddi</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <meta property="og:title" content="${escapeHtml(card.title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:type" content="music.playlist" />
  <meta property="og:site_name" content="Eddi" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(card.title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />

  <meta http-equiv="refresh" content="0; url=${escapeHtml(url)}" />
</head>
<body>
  <p>Redirecting to <a href="${escapeHtml(url)}">${escapeHtml(card.title)}</a>…</p>
</body>
</html>`
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const cardMatch = url.pathname.match(/^\/c\/([A-Za-z0-9]+)$/)

    if (cardMatch && isBot(request.headers.get('user-agent') ?? '')) {
      const cardId = cardMatch[1]
      const apiUrl = env.API_URL ?? 'https://4p46ddsze9.execute-api.us-east-1.amazonaws.com/prod'

      try {
        const res = await fetch(`${apiUrl}/cards/${cardId}`, {
          headers: { 'User-Agent': 'EddiBot/1.0 (og-renderer)' },
        })
        if (res.ok) {
          const card = await res.json() as CardData
          return new Response(buildOgHtml(card, cardId, apiUrl), {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300, s-maxage=60',
            },
          })
        }
      } catch {
        // fall through to SPA
      }
    }

    return env.ASSETS.fetch(request)
  },
}
