import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchJson, postJson } from '../lib/api.js'

// Backend network/Spotify reachability — drives the offline toast. Tolerant of the
// endpoint not existing yet (treats any error/no-data as "online" so we never flash a
// false offline state). `refresh()` re-kicks WiFi on the device and replays the card.
export function useNetStatus() {
  const q = useQuery({
    queryKey: ['net'],
    queryFn: () => fetchJson('/net/status'),
    refetchInterval: 8000,
    retry: false,
  })
  const refresh = useMutation({
    mutationFn: () => postJson('/net/refresh'),
    onSettled: () => q.refetch(),
  })
  return {
    online: q.data ? q.data.online !== false : true,
    net: q.data || null,
    refresh: refresh.mutate,
    refreshing: refresh.isPending,
  }
}
