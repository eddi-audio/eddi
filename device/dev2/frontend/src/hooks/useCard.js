import { useQuery } from '@tanstack/react-query'
import { fetchJson } from '../lib/api.js'

// Current NFC card, polled every 2s. `card` is null when no card is present;
// `isError` distinguishes "backend unreachable" from "no card" (the old code
// swallowed that difference). playlistId is derived here so it's in one place.
export function useCard() {
  const q = useQuery({
    queryKey: ['card'],
    queryFn: () => fetchJson('/nfc/current'),
    refetchInterval: 2000,
    refetchIntervalInBackground: true,
  })
  const card = q.data?.card_present ? q.data : null
  // A card can be present but unresolvable: the reader read its id, but the Eddi
  // API had no Spotify URI for it (404 / unlinked card). The backend sets the
  // card's meta atomically, so a missing spotify_uri here means "couldn't
  // resolve" — never a transient mid-resolve flicker. Surface it so the UI shows
  // a clear "card not recognized" state instead of hanging in loading forever.
  const unresolved = !!card && !card.spotify_uri
  const playlistId = card?.spotify_uri?.startsWith('spotify:playlist:')
    ? card.spotify_uri.split(':')[2]
    : null
  return { card, unresolved, playlistId, isError: q.isError, isLoading: q.isLoading }
}
