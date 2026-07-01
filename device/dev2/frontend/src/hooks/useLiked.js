import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson, postJson } from '../lib/api.js'

// "∿ liked on eddi ∿" membership + toggle. The set of liked track uris drives the heart
// state; toggling optimistically updates the set, then POSTs /spotify/like (reverts on
// failure). Tolerant of the endpoint 404ing pre-deploy / 403ing pre-token-remint — it
// just renders as "nothing liked yet". Mirrors usePlaylist.js.
export function useLiked() {
  const qc = useQueryClient()
  const key = ['liked']
  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchJson('/spotify/liked-uris').then((d) => new Set(d.uris || [])),
    staleTime: 30_000,
    retry: false,
  })
  const set = q.data instanceof Set ? q.data : null

  const isLiked = (uri) => !!(set && uri && set.has(uri))

  // Returns the new liked state (so the caller can toast on a "like").
  const toggleLike = (uri) => {
    if (!uri) return false
    const nowLiked = !isLiked(uri)
    const prevSet = set ? new Set(set) : new Set()   // snapshot for an exact revert
    qc.setQueryData(key, (prev) => {
      const n = new Set(prev instanceof Set ? prev : [])
      if (nowLiked) n.add(uri); else n.delete(uri)
      return n
    })
    // postJson throws on non-2xx (lib/api.js) — with the backend now returning Spotify's real
    // status, a failed like REJECTS here and we restore the prior Set exactly. (NOT
    // invalidate→refetch, which 503s pre-token-remint and would keep the wrong optimistic heart.)
    postJson('/spotify/like', { uri, liked: nowLiked }).catch(() => qc.setQueryData(key, prevSet))
    return nowLiked
  }

  return { isLiked, toggleLike }
}
