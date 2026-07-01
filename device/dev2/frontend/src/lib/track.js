// Track art — Spotify puts it under album.images for songs, images for audiobook
// chapters / podcast episodes, and show.images for podcasts. Fall through all three,
// taking the last (smallest) image for the thumbnail.
export function trackArt(track) {
  const imgs = track?.album?.images || track?.images || track?.show?.images
  return imgs?.slice(-1)[0]?.url
}

// "+" add-to-playlist eligibility: only when the card IS a playlist, the track has a
// uri, membership has actually loaded (a real Set), and the track isn't already on it.
// null/undefined membership (loading or failed) → false, so we never spam "+".
export function canAddToPlaylist(track, playlistId, playlistUris) {
  return !!playlistId && !!track?.uri && playlistUris instanceof Set && !playlistUris.has(track.uri)
}
