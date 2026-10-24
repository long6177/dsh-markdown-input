/**
 * Seam: the `@` popup's session-mention data plane (#75). Pins the lazy
 * capability probe (a host build without `remote.sessionReferenceResolver`
 * degrades the face to undefined — the session group then never appears),
 * the candidates mapping (ok → list, refusal or transport failure → empty
 * list, never a throw), and the per-call signal pass-through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  sessionReferenceFace, sessionReferenceFaceSupported, installSessionReferenceSource,
  resetSessionReferenceFace, setSessionReferenceSource,
} from '../src/client/session-reference-face.ts'

afterEach(() => {
  resetSessionReferenceFace()
})

describe('sessionReferenceFaceSupported', () => {
  it('fails while no source is bound', () => {
    expect(sessionReferenceFaceSupported()).toBe(false)
    expect(sessionReferenceFace()).toBeUndefined()
  })

  it('fails when the remote lacks the sessionReferenceResolver namespace', () => {
    installSessionReferenceSource({ get: () => undefined } as never)
    expect(sessionReferenceFaceSupported()).toBe(false)
  })

  it('fails when candidates is not a function', () => {
    installSessionReferenceSource({
      get: (key: string) => (key === 'remote.sessionReferenceResolver' ? {} : undefined),
    } as never)
    expect(sessionReferenceFaceSupported()).toBe(false)
  })

  it('passes when the namespace exposes candidates', () => {
    installSessionReferenceSource({
      get: (key: string) => (key === 'remote.sessionReferenceResolver' ? { candidates: vi.fn() } : undefined),
    } as never)
    expect(sessionReferenceFaceSupported()).toBe(true)
    expect(sessionReferenceFace()).not.toBeUndefined()
  })
})

describe('sessionReferenceFace.candidates', () => {
  it('maps an ok result to the candidate list', async () => {
    const candidates = [{
      sessionId: 's2', label: 's2', sameWorkspace: true, createdAt: 1,
      mention: '@[s2](dsh-session:cw==)',
    }]
    const resolver = vi.fn(() => Promise.resolve({ ok: true, value: candidates }))
    setSessionReferenceSource(() => ({ sessionReferenceResolver: { candidates: resolver } }))
    await expect(sessionReferenceFace()?.candidates('s1', 's2')).resolves.toEqual(candidates)
    expect(resolver).toHaveBeenCalledWith('s1', 's2', undefined)
  })

  it('passes the abort signal through', async () => {
    const resolver = vi.fn(() => Promise.resolve({ ok: true, value: [] }))
    setSessionReferenceSource(() => ({ sessionReferenceResolver: { candidates: resolver } }))
    const signal = new AbortController().signal
    await sessionReferenceFace()?.candidates('s1', 'a', signal)
    expect(resolver).toHaveBeenCalledWith('s1', 'a', signal)
  })

  it('resolves an empty list on a host refusal', async () => {
    const resolver = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'x', message: 'no' } }))
    setSessionReferenceSource(() => ({ sessionReferenceResolver: { candidates: resolver } }))
    await expect(sessionReferenceFace()?.candidates('s1', 'a')).resolves.toEqual([])
  })

  it('resolves an empty list on a transport failure (never throws)', async () => {
    const resolver = vi.fn(() => Promise.reject(new Error('down')))
    setSessionReferenceSource(() => ({ sessionReferenceResolver: { candidates: resolver } }))
    await expect(sessionReferenceFace()?.candidates('s1', 'a')).resolves.toEqual([])
  })
})
