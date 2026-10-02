/**
 * The per-face capability framework (ADR-0005 hardening #2): registration,
 * latched probing, and the unified degradation path the takeover card's
 * faces (editor, tool-row, popup) share. Both sides of every verdict are
 * asserted — supported on a complete dependency surface, degraded (with a
 * reason) on a missing one — because the degradation contract is what T2
 * ships, not any individual face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerFace, resetFaces } from '../src/client/face.ts'

afterEach(() => {
  resetFaces()
  vi.restoreAllMocks()
})

describe('registerFace', () => {
  it('answers supported on a complete dependency surface', () => {
    const face = registerFace({ id: 'tool.test', probe: () => true })
    expect(face.verdict()).toEqual({ supported: true })
  })

  it('answers degraded with a reason when the probe misses', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({ id: 'tool.test', probe: () => false })
    expect(face.verdict()).toEqual({ supported: false, reason: 'face "tool.test" host dependencies missing' })
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('degrading the face'))).toBe(true)
  })

  it('converts a throwing probe into a failed verdict, not a crash', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({
      id: 'tool.test',
      probe: () => {
        throw new Error('sealed global')
      },
    })
    const verdict = face.verdict()
    expect(verdict.supported).toBe(false)
    expect(verdict.reason).toContain('sealed global')
  })

  it('probes lazily, once: the verdict latches for the page life', () => {
    const probeBody = vi.fn(() => true)
    const face = registerFace({ id: 'tool.test', probe: probeBody })
    face.verdict()
    face.verdict()
    face.verdict()
    expect(probeBody).toHaveBeenCalledTimes(1)
  })

  it('re-registration returns the same handle (idempotent per id)', () => {
    const first = registerFace({ id: 'tool.test', probe: () => true })
    const second = registerFace({ id: 'tool.test', probe: () => false })
    expect(second).toBe(first)
  })

  it('distinct ids get distinct handles', () => {
    const a = registerFace({ id: 'tool.a', probe: () => true })
    const b = registerFace({ id: 'tool.b', probe: () => true })
    expect(b).not.toBe(a)
  })
})

describe('face mid-life degrade', () => {
  it('latches off with the first reason and fires listeners once', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({ id: 'tool.test', probe: () => true })
    expect(face.verdict().supported).toBe(true)
    const seen: string[] = []
    const unsubscribe = face.onDegrade((verdict) => {
      seen.push(verdict.reason ?? '')
    })
    face.degrade('rpc stopped resolving')
    face.degrade('second failure')
    unsubscribe()
    face.degrade('after unsubscribe')
    expect(face.verdict()).toEqual({ supported: false, reason: 'rpc stopped resolving' })
    expect(seen).toEqual(['rpc stopped resolving'])
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('degraded mid-life'))).toBe(true)
  })

  it('degrades a never-probed face and the verdict reflects it', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({ id: 'tool.test', probe: () => true })
    face.degrade('caught exception in the face')
    expect(face.verdict()).toEqual({ supported: false, reason: 'caught exception in the face' })
  })

  it('a probe-missed face ignores further degrades (first reason wins)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({ id: 'tool.test', probe: () => false })
    face.verdict()
    const seen: unknown[] = []
    face.onDegrade((verdict) => {
      seen.push(verdict)
    })
    face.degrade('mid-life failure')
    expect(face.verdict().reason).toBe('face "tool.test" host dependencies missing')
    expect(seen).toEqual([])
  })

  it('a throwing listener does not block the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const face = registerFace({ id: 'tool.test', probe: () => true })
    const seen: string[] = []
    face.onDegrade(() => {
      throw new Error('bad listener')
    })
    face.onDegrade((verdict) => {
      seen.push(verdict.reason ?? '')
    })
    expect(() => face.degrade('boom')).not.toThrow()
    expect(seen).toEqual(['boom'])
  })
})
