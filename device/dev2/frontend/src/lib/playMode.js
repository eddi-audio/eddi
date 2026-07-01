// Play-mode cycle — one button stepping Normal → Shuffle → Repeat All → Repeat One,
// each mapped to Spotify's shuffle + repeat. Pure + testable; the hook just calls these.

export const MODE_ORDER = ['normal', 'shuffle', 'repeat', 'repeatOne']

export const MODE_CONFIG = {
  normal:    { shuffle: false, repeat: 'off' },
  shuffle:   { shuffle: true,  repeat: 'off' },
  repeat:    { shuffle: false, repeat: 'context' },
  repeatOne: { shuffle: false, repeat: 'track' },
}

export const REPEAT_NUM = { off: 0, context: 1, track: 2 }

// Derive the current mode from the SDK's shuffle bool + repeat_mode (0/1/2).
export function modeFromState(shuffle, repeatMode) {
  if (shuffle) return 'shuffle'
  if (repeatMode === 1) return 'repeat'
  if (repeatMode === 2) return 'repeatOne'
  return 'normal'
}

export function nextMode(mode) {
  return MODE_ORDER[(MODE_ORDER.indexOf(mode) + 1) % MODE_ORDER.length]
}
