import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchJson, postJson } from '../lib/api.js'

// Playlist membership (the Set of track URIs already on the card's playlist) + the
// add/remove mutations that drive the "+" affordance. Membership is `null` until it
// actually loads, so `canAddToPlaylist` never spam-shows "+". Mutations are optimistic
// with rollback on error. We deliberately do NOT invalidate after a write — the
// backend's track-uris response is cached ~10s and would briefly revert the optimistic
// change; the optimistic Set is the source of truth until the next natural refetch.
export function usePlaylist(playlistId) {
  const qc = useQueryClient()
  const key = ['playlistUris', playlistId]

  const q = useQuery({
    queryKey: key,
    queryFn: () => fetchJson(`/spotify/playlist/${playlistId}/track-uris`).then((d) => new Set(d.uris || [])),
    enabled: !!playlistId,
    staleTime: 60000,
  })

  // Shared optimistic-update + rollback options for both mutations (plain function,
  // no hooks inside — the useMutation calls below stay at the top level).
  const optimistic = (apply) => ({
    onMutate: async (uri) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData(key)
      qc.setQueryData(key, (old) => {
        const s = new Set(old || [])
        apply(s, uri)
        return s
      })
      return { prev }
    },
    onError: (_e, _uri, ctx) => qc.setQueryData(key, ctx?.prev),
  })

  const add = useMutation({
    mutationFn: (uri) => postJson(`/spotify/playlist/${playlistId}/tracks`, { uris: [uri] }),
    ...optimistic((s, uri) => s.add(uri)),
  })
  const remove = useMutation({
    mutationFn: (uri) =>
      fetchJson(`/spotify/playlist/${playlistId}/tracks`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: [{ uri }] }),
      }),
    ...optimistic((s, uri) => s.delete(uri)),
  })

  return {
    playlistUris: q.data instanceof Set ? q.data : null, // null = loading / no playlist / failed
    isLoading: q.isLoading,
    addToPlaylist: add.mutate,
    removeFromPlaylist: remove.mutate,
  }
}
