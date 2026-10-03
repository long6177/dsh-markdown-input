/**
 * Seam 2 (degradation): the card faces' capability probe. Asserted from
 * both sides — supported on a complete surface, disabled (with a reason) on
 * a missing one — because the degradation contract, not the feature, is
 * what this seam ships.
 */
import { describe, expect, it } from 'vitest'
import { probe } from '../src/client/capability.ts'

describe('probe', () => {
  it('reports supported with no reason when the body answers true', () => {
    expect(probe(() => true, 'missing')).toEqual({ supported: true })
  })

  it('reports unsupported with the given reason when the body answers false', () => {
    expect(probe(() => false, 'surface gone')).toEqual({
      supported: false,
      reason: 'surface gone',
    })
  })

  it('converts a throwing body into a failed verdict, not a crash', () => {
    const verdict = probe(() => {
      throw new Error('sealed global')
    }, 'probe exploded')
    expect(verdict.supported).toBe(false)
    expect(verdict.reason).toBe('probe exploded (sealed global)')
  })
})
