import { describe, it, expect } from 'vitest'
import { trackArt, canAddToPlaylist } from './track.js'

describe('trackArt', () => {
  it('uses album.images, smallest (last)', () => {
    expect(trackArt({ album: { images: [{ url: 'big' }, { url: 'small' }] } })).toBe('small')
  })
  it('falls back to images (audiobook/episode) then show.images (podcast)', () => {
    expect(trackArt({ images: [{ url: 'ep' }] })).toBe('ep')
    expect(trackArt({ show: { images: [{ url: 'show' }] } })).toBe('show')
  })
  it('undefined when there is no art', () => {
    expect(trackArt({})).toBeUndefined()
    expect(trackArt(null)).toBeUndefined()
  })
})

describe('canAddToPlaylist', () => {
  const pid = 'abc'
  it('true for a loaded Set that is missing the uri', () => {
    expect(canAddToPlaylist({ uri: 'x' }, pid, new Set(['y']))).toBe(true)
  })
  it('false when the uri is already on the playlist', () => {
    expect(canAddToPlaylist({ uri: 'x' }, pid, new Set(['x']))).toBe(false)
  })
  it('false when membership has not loaded (null) — never spam "+"', () => {
    expect(canAddToPlaylist({ uri: 'x' }, pid, null)).toBe(false)
  })
  it('false when the card is not a playlist', () => {
    expect(canAddToPlaylist({ uri: 'x' }, null, new Set())).toBe(false)
  })
})
