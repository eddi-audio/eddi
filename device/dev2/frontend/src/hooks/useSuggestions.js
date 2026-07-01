import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '../lib/api.js'

// "Fresh Finds" — more tracks by the current artist. Spotify locked down top-tracks /
// related-artists / recommendations for this app, so the backend uses /search (which
// still works) keyed on the artist NAME. Keyed here on the name so it only refetches
// when the artist changes, not on every track within the same artist.
export function useSuggestions(track) {
  const name = track?.artists?.[0]?.name || null
  const q = useQuery({
    queryKey: ['suggestions', name],
    queryFn: () => fetchJson(`/spotify/suggestions?q=${encodeURIComponent(name)}`),
    enabled: !!name,
    staleTime: 5 * 60 * 1000,
  })
  return { suggestions: q.data?.tracks || [], isLoading: q.isLoading, isError: q.isError }
}
