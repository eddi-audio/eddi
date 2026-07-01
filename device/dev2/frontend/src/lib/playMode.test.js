import { describe, it, expect } from 'vitest'
import { modeFromState, nextMode, MODE_CONFIG, REPEAT_NUM } from './playMode.js'

describe('modeFromState', () => {
  it('maps shuffle/repeat to a mode', () => {
    expect(modeFromState(false, 0)).toBe('normal')
    expect(modeFromState(true, 0)).toBe('shuffle')
    expect(modeFromState(false, 1)).toBe('repeat')
    expect(modeFromState(false, 2)).toBe('repeatOne')
  })
  it('shuffle takes precedence over repeat', () => {
    expect(modeFromState(true, 2)).toBe('shuffle')
  })
})

describe('nextMode', () => {
  it('cycles normal → shuffle → repeat → repeatOne → normal', () => {
    expect(nextMode('normal')).toBe('shuffle')
    expect(nextMode('shuffle')).toBe('repeat')
    expect(nextMode('repeat')).toBe('repeatOne')
    expect(nextMode('repeatOne')).toBe('normal')
  })
})

describe('MODE_CONFIG', () => {
  it('maps each mode to spotify shuffle+repeat', () => {
    expect(MODE_CONFIG.normal).toEqual({ shuffle: false, repeat: 'off' })
    expect(MODE_CONFIG.shuffle).toEqual({ shuffle: true, repeat: 'off' })
    expect(MODE_CONFIG.repeat).toEqual({ shuffle: false, repeat: 'context' })
    expect(MODE_CONFIG.repeatOne).toEqual({ shuffle: false, repeat: 'track' })
  })
  it('repeat string → SDK number', () => {
    expect(REPEAT_NUM.off).toBe(0)
    expect(REPEAT_NUM.context).toBe(1)
    expect(REPEAT_NUM.track).toBe(2)
  })
})
