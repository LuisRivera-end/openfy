import { describe, expect, it } from 'vitest'
import { SHORTCUT_GUIDE, SHORTCUT_SEEK_SECONDS, SHORTCUT_VOLUME_STEP, shortcutCommand, shortcutKey, shortcutMouseKey } from '../../shared/utils/shortcuts'
import fixture from '../fixtures/shortcuts-contract.json'

describe('shortcuts contract', () => {
  it('maps every input to its command', () => {
    for (const example of fixture.cases) expect(shortcutCommand(example.input), example.name).toBe(example.command)
  })
  it('normalizes DOM keys', () => {
    for (const example of fixture.keys) expect(shortcutKey(example.event), JSON.stringify(example.event)).toBe(example.key)
  })
  it('maps the mouse side buttons', () => {
    expect(shortcutMouseKey(3)).toBe('MouseBack')
    expect(shortcutMouseKey(4)).toBe('MouseForward')
    expect(shortcutMouseKey(0)).toBeNull()
  })
  it('shares the steps and the guide', () => {
    expect(SHORTCUT_SEEK_SECONDS).toBe(fixture.seekSeconds)
    expect(SHORTCUT_VOLUME_STEP).toBe(fixture.volumeStep)
    expect(SHORTCUT_GUIDE).toEqual(fixture.guide)
  })
})
