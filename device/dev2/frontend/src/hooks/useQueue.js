import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '../lib/api.js'

export const QUEUE_KEY = ['queue']

// Spotify up-next. Enabled once a device is ready. Exposes loading/error so the
// sheet can show a skeleton + a refresh affordance instead of silent stale data.
export function useQueue(enabled) {
  const q = useQuery({
    queryKey: QUEUE_KEY,
    queryFn: () => fetchJson('/spotify/queue'),
    enabled: !!enabled,
    staleTime: 2000,
  })
  return {
    queue: q.data?.queue || [],
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  }
}

// Imperative invalidation — call when the sheet opens or shuffle changes so the up-next
// reorders to match. MUST be memoized: it's a dependency of usePlayback's SDK-listener effect,
// and a fresh function each render made that effect re-run every render → a getCurrentState →
// setState → re-render loop that pinned the renderer at ~90% CPU.
export function useInvalidateQueue() {
  const qc = useQueryClient()
  return useCallback(() => qc.invalidateQueries({ queryKey: QUEUE_KEY }), [qc])
}
