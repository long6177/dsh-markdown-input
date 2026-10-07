/**
 * The semver subset inside scripts/drift-watch.mjs (#59): exactly the shapes
 * package.json's peer ranges use — `*`, exact, caret — with full prerelease
 * precedence and the same-tuple exclusion rule. The headline case is the #59
 * acceptance criterion: `^0.2.0-rc.2` must NOT accept `0.2.1-alpha.1`.
 */
import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  cordisTagFor,
  parseVersion,
  rangeAccepts,
} from '../scripts/drift-watch.mjs'

describe('parseVersion', () => {
  it('parses release and prerelease versions', () => {
    expect(parseVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: null, raw: '0.2.0' })
    expect(parseVersion('0.2.1-alpha.1')).toEqual({
      major: 0, minor: 2, patch: 1, prerelease: ['alpha', '1'], raw: '0.2.1-alpha.1',
    })
    expect(parseVersion('v0.2.0-rc.2')?.raw).toBe('0.2.0-rc.2')
  })

  it('rejects non-versions', () => {
    expect(parseVersion('dsh-v0.2.0')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion(42 as unknown as string)).toBeNull()
  })
})

describe('compareVersions (semver precedence)', () => {
  it('orders by major.minor.patch', () => {
    expect(compareVersions('0.2.1', '0.2.0')).toBeGreaterThan(0)
    expect(compareVersions('0.3.0', '0.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.2')).toBe(0)
  })

  it('orders prerelease identifiers: numeric < alphanumeric, longer list wins ties', () => {
    expect(compareVersions('0.2.0-rc.2', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-alpha.1', '0.2.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0-alpha.2', '0.2.0-alpha.10')).toBeLessThan(0) // numeric, not lexicographic
    expect(compareVersions('0.2.0-alpha', '0.2.0-alpha.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0-1', '0.2.0-alpha')).toBeLessThan(0) // numeric < alphanumeric
    expect(compareVersions('0.2.0', '0.2.0-rc.2')).toBeGreaterThan(0) // release > prerelease
  })
})

describe('rangeAccepts', () => {
  it('THE #59 CASE: ^0.2.0-rc.2 rejects 0.2.1-alpha.1 (prerelease same-tuple rule)', () => {
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.1-alpha.1')).toBe(false)
  })

  it('caret bounds: >=lower inclusive, <next-minor exclusive for 0.x', () => {
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.0-rc.2')).toBe(true)
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.0-rc.1')).toBe(false)
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.0')).toBe(true) // release on the lower tuple
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.1')).toBe(true) // release: no exclusion applies
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.9')).toBe(true)
    expect(rangeAccepts('^0.2.0-rc.2', '0.3.0')).toBe(false)
    expect(rangeAccepts('^0.2.0-rc.2', '0.1.9')).toBe(false)
  })

  it('caret upper bound follows the first nonzero component', () => {
    expect(rangeAccepts('^1.2.3', '1.9.9')).toBe(true)
    expect(rangeAccepts('^1.2.3', '2.0.0')).toBe(false)
    expect(rangeAccepts('^0.0.3', '0.0.3')).toBe(true)
    expect(rangeAccepts('^0.0.3', '0.0.4')).toBe(false)
  })

  it('prereleases satisfy a caret only on the lower-bound tuple', () => {
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.0-rc.3')).toBe(true)
    expect(rangeAccepts('^0.2.0-rc.2', '0.2.2-alpha.1')).toBe(false)
    expect(rangeAccepts('^1.2.3', '1.2.4-beta.1')).toBe(false) // lower has no prerelease at all
  })

  it('exact ranges and the star', () => {
    expect(rangeAccepts('0.2.0-rc.2', '0.2.0-rc.2')).toBe(true)
    expect(rangeAccepts('0.2.0-rc.2', '0.2.0-rc.3')).toBe(false)
    expect(rangeAccepts('*', '4.0.4')).toBe(true)
    expect(rangeAccepts('*', '4.0.5-alpha.1')).toBe(false) // npm semantics: * does not match prereleases
  })

  it('throws on unsupported ranges (fail loudly, never silently accept)', () => {
    expect(() => rangeAccepts('>=0.2.0 <0.3.0', '0.2.1')).toThrow(/unsupported peer range/)
    expect(() => rangeAccepts('^0.2.0-rc.2', 'not-a-version')).toThrow(/invalid version/)
  })
})

describe('cordisTagFor', () => {
  it('maps a dsh version onto cordis\'s dash-joined versioned dist-tag', () => {
    expect(cordisTagFor('0.2.1-alpha.1')).toBe('dsh-0-2-1-alpha-1')
    expect(cordisTagFor('0.2.0-rc.2')).toBe('dsh-0-2-0-rc-2')
  })
})
