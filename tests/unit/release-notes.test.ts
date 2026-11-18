import { describe, expect, it } from 'vitest'
import { RELEASE_NOTE_LABELS, compareReleaseVersions, parseReleaseVersion, releasesSince } from '../../shared/utils/release-notes'
import fixture from '../fixtures/release-notes-contract.json'
import notes from '../../shared/release-notes.json'
import metadata from '../../package.json'

describe('release notes contract', () => {
  it('selects the releases since the last seen version', () => {
    const releases = fixture.releases.map(version => ({ version }))
    for (const example of fixture.cases) expect(releasesSince(releases, example.lastSeen, example.current).map(release => release.version), example.name).toEqual(example.expected)
  })
})

describe('shared/release-notes.json', () => {
  it('has an entry for the package version', () => {
    expect(notes.releases.some(release => release.version === metadata.version)).toBe(true)
  })
  it('is valid, unique and sorted newest first', () => {
    const versions = notes.releases.map(release => parseReleaseVersion(release.version))
    expect(versions.every(Boolean)).toBe(true)
    for (let index = 1; index < versions.length; index++) expect(compareReleaseVersions(versions[index - 1]!, versions[index]!)).toBe(1)
    for (const release of notes.releases) {
      expect(release.date, release.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(release.items.length, release.version).toBeGreaterThan(0)
      for (const item of release.items) {
        expect(Object.keys(RELEASE_NOTE_LABELS), release.version).toContain(item.type)
        expect(item.text.trim().length, release.version).toBeGreaterThan(0)
      }
    }
  })
})
