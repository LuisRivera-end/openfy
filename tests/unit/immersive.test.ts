import { describe, expect, it } from 'vitest'
import { BIG_PICTURE, IMMERSIVE, bigPictureLyrics, immersiveLayout, nextAutomaticIndex, nextCardBounds, upcomingSeconds } from '../../shared/utils/immersive'
import fixture from '../fixtures/immersive-layout-contract.json'

describe('shared expanded-player layout contract', () => {
  it('uses the pinned breakpoints', () => { expect({ ...IMMERSIVE }).toEqual(fixture.parameters) })
  it('shares the native presentation dimensions and timing', () => {
    for (const [key, value] of Object.entries(fixture.presentation)) expect(BIG_PICTURE[key as keyof typeof BIG_PICTURE]).toBe(value)
  })
  it('places the next card above the dock or, in compact mode, in the bottom-right corner', () => {
    for (const example of fixture.cards) {
      const [vw, vh] = example.viewport as [number, number]
      const bounds = nextCardBounds(vw, vh, example.contentRight, example.contentWidth, example.dockTop, example.idle)
      const actual = [bounds.x, bounds.y, bounds.width, bounds.height, bounds.scale]
      example.bounds.forEach((value, i) => expect(actual[i], JSON.stringify(example)).toBeCloseTo(value, 6))
    }
  })
  it('shows the Big Picture lyrics column only for synced lyrics, keeping the choice while loading', () => {
    for (const example of fixture.lyricsCases) expect(bigPictureLyrics(example.status, example.pending, example.previous), JSON.stringify(example)).toBe(example.lyrics)
  })
  it('chooses cover, split or stacked', () => {
    for (const example of fixture.cases) expect(immersiveLayout(example.width, example.height, example.lyrics), JSON.stringify(example)).toBe(example.layout)
  })
})

describe('Big Picture anticipation', () => {
  it('follows effective queue order and automatic repeat without changing it', () => {
    expect(nextAutomaticIndex(3, 0, 'off')).toBe(1)
    expect(nextAutomaticIndex(3, 2, 'off')).toBeNull()
    expect(nextAutomaticIndex(3, 2, 'all')).toBe(0)
    expect(nextAutomaticIndex(3, 1, 'one')).toBe(1)
    expect(nextAutomaticIndex(1, 0, 'all')).toBe(0)
    expect(nextAutomaticIndex(0, 0, 'all')).toBeNull()
    expect(nextAutomaticIndex(2, -1, 'off')).toBeNull()
  })
  it('uses the last ten seconds of the media timeline rather than wall time', () => {
    expect(upcomingSeconds(19.99, 30)).toBeNull()
    expect(upcomingSeconds(20, 30)).toBe(10)
    expect(upcomingSeconds(29.1, 30)).toBe(1)
    expect(upcomingSeconds(30, 30)).toBe(0)
    expect(upcomingSeconds(31, 30)).toBeNull()
    expect(upcomingSeconds(0, 0)).toBeNull()
    expect(upcomingSeconds(1, Infinity)).toBeNull()
    expect(upcomingSeconds(NaN, 30)).toBeNull()
  })
})
