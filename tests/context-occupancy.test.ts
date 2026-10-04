/**
 * The meter's pure core (issue #43): the vendored `contextOccupancy`
 * computation and the compact-number formatter the panel's figures ride. The
 * two projection views are read structurally, so these cases pin the exact
 * acceptance rules of #43 — null until BOTH the numerator and the route
 * capacity are known, clamped percent, projected-over-pressure preference —
 * plus the host's own K/M formatting boundaries.
 */
import { describe, expect, it } from 'vitest'
import { contextOccupancy, formatTokens } from '../src/client/context-occupancy.ts'
import type { ContextTranslate } from '../src/client/context-occupancy.ts'

/** A `conversation`-shaped seat: the host's own templates, expanded. */
const t: ContextTranslate = (key, params) => {
  switch (key) {
    case 'number.thousand': return `${String(params?.value)}K`
    case 'number.million': return `${String(params?.value)}M`
    default: return key
  }
}

describe('contextOccupancy', () => {
  it('returns null with no pressure projection at all', () => {
    expect(contextOccupancy(undefined)).toBeNull()
  })

  it('returns null while the route capacity is unknown (pressure without capacity)', () => {
    expect(contextOccupancy({ pressureTokens: 1200 })).toBeNull()
    expect(contextOccupancy({ projectedTokens: 1200 })).toBeNull()
  })

  it('returns null while the used count is unknown (capacity without a numerator)', () => {
    expect(contextOccupancy({ contextWindow: 128000 })).toBeNull()
  })

  it('prefers the projected count over the provider-anchored pressure count', () => {
    expect(contextOccupancy({ pressureTokens: 1000, projectedTokens: 2500, contextWindow: 10000 }))
      .toEqual({ percent: 25, usedTokens: 2500, contextWindow: 10000 })
  })

  it('falls back to the pressure count when no projection is present', () => {
    expect(contextOccupancy({ pressureTokens: 500, contextWindow: 1000 }))
      .toEqual({ percent: 50, usedTokens: 500, contextWindow: 1000 })
  })

  it('rounds the percent and clamps it at 100', () => {
    expect(contextOccupancy({ pressureTokens: 196, contextWindow: 1000 })?.percent).toBe(20)
    expect(contextOccupancy({ pressureTokens: 195, contextWindow: 1000 })?.percent).toBe(20)
    expect(contextOccupancy({ pressureTokens: 3000, contextWindow: 1000 })?.percent).toBe(100)
  })
})

describe('formatTokens', () => {
  it('renders raw counts below one thousand', () => {
    expect(formatTokens(0, t)).toBe('0')
    expect(formatTokens(999, t)).toBe('999')
  })

  it('renders whole thousands above 100K and one decimal below it', () => {
    expect(formatTokens(1000, t)).toBe('1K')
    expect(formatTokens(99_949, t)).toBe('99.9K')
    expect(formatTokens(100_000, t)).toBe('100K')
    expect(formatTokens(128_400, t)).toBe('128K')
  })

  it('renders millions through the million template', () => {
    expect(formatTokens(1_000_000, t)).toBe('1M')
    expect(formatTokens(1_250_000, t)).toBe('1.3M')
  })
})
