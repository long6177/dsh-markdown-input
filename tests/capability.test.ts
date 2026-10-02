/**
 * Seam 2 (degradation): the enhancement layers' capability probes and the
 * auto-disable latch. Each probe is asserted from both sides — supported on
 * a complete surface, disabled (with a reason) on a missing one — because
 * the degradation contract, not the feature, is what this skeleton ships.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { killSwitch, probe } from '../src/client/capability.ts'
import { paintCapability } from '../src/client/paint-layer.ts'
import { insertionCapability } from '../src/client/paste-layer.ts'

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

describe('killSwitch', () => {
  it('starts enabled with no reason', () => {
    const latch = killSwitch()
    expect(latch.disabled).toBe(false)
    expect(latch.reason).toBeUndefined()
  })

  it('latches off with the first reason and stays off', () => {
    const latch = killSwitch()
    latch.disable('host structure changed')
    latch.disable('second failure')
    expect(latch.disabled).toBe(true)
    expect(latch.reason).toBe('host structure changed')
  })
})

describe('paintCapability', () => {
  // jsdom ships neither `Highlight` nor `CSS.highlights`; stub both on for
  // the supported branch and restore after, so the default branch below
  // stays honest about what an unsupported browser sees.
  const globalScope = globalThis as typeof globalThis & {
    Highlight?: unknown
    CSS: Record<string, unknown>
  }
  const savedHighlight = globalScope.Highlight
  const savedHighlights = globalScope.CSS.highlights

  afterEach(() => {
    if (savedHighlight === undefined) delete globalScope.Highlight
    else globalScope.Highlight = savedHighlight
    if (savedHighlights === undefined) delete globalScope.CSS.highlights
    else globalScope.CSS.highlights = savedHighlights
  })

  it('answers unsupported in a browser without the Custom Highlight API', () => {
    delete globalScope.Highlight
    delete globalScope.CSS.highlights
    const verdict = paintCapability()
    expect(verdict.supported).toBe(false)
    expect(verdict.reason).toContain('Custom Highlight')
  })

  it('answers supported when Highlight and CSS.highlights exist', () => {
    globalScope.Highlight = class HighlightStub {}
    globalScope.CSS.highlights = new Map()
    expect(paintCapability().supported).toBe(true)
  })
})

describe('insertionCapability', () => {
  const face = {
    captureInsertion: (): { readonly draftRev: number } => ({ draftRev: 1 }),
    insertText: (_text: string, _span: unknown): boolean => true,
  }

  it('answers supported on a face carrying both insertion verbs', () => {
    expect(insertionCapability(face).supported).toBe(true)
  })

  it('answers unsupported when either verb is missing', () => {
    expect(insertionCapability({ captureInsertion: face.captureInsertion }).supported).toBe(false)
    expect(insertionCapability({ ...face, insertText: 'nope' }).supported).toBe(false)
  })

  it('answers unsupported on null and on non-objects', () => {
    expect(insertionCapability(null).supported).toBe(false)
    expect(insertionCapability('captureInsertion').supported).toBe(false)
  })
})
