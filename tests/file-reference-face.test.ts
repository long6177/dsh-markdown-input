/**
 * Seam: the `@` popup's file-reference data plane (T10). Pins the lazy
 * capability probe (a host build without `remote.fileReferences` degrades
 * the face to undefined), the search mapping (ok → candidates, refusal or
 * transport failure → empty list, never a throw), and the per-call signal
 * pass-through the view's refinement aborts ride.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fileReferenceFace, fileReferenceFaceSupported, installFileReferenceSource,
  resetFileReferenceFace, setFileReferenceSource,
} from '../src/client/file-reference-face.ts'

afterEach(() => {
  resetFileReferenceFace()
})

describe('fileReferenceFaceSupported', () => {
  it('fails while no source is bound', () => {
    expect(fileReferenceFaceSupported()).toBe(false)
    expect(fileReferenceFace()).toBeUndefined()
  })

  it('fails when the remote lacks the fileReferences namespace', () => {
    installFileReferenceSource({ get: () => undefined } as never)
    expect(fileReferenceFaceSupported()).toBe(false)
  })

  it('fails when list is not a function', () => {
    installFileReferenceSource({ get: (key: string) => (key === 'remote.fileReferences' ? {} : undefined) } as never)
    expect(fileReferenceFaceSupported()).toBe(false)
  })

  it('passes when the namespace exposes list', () => {
    installFileReferenceSource({
      get: (key: string) => (key === 'remote.fileReferences' ? { list: vi.fn() } : undefined),
    } as never)
    expect(fileReferenceFaceSupported()).toBe(true)
    expect(fileReferenceFace()).not.toBeUndefined()
  })
})

describe('fileReferenceFace.search', () => {
  it('maps an ok result to the candidate list', async () => {
    const candidates = [{ path: 'src/index.ts', kind: 'file' }, { path: 'src', kind: 'directory' }]
    const list = vi.fn(() => Promise.resolve({ ok: true, value: candidates }))
    setFileReferenceSource(() => ({ fileReferences: { list } }))
    const face = fileReferenceFace()
    await expect(face?.search('s1', 'src')).resolves.toEqual(candidates)
    expect(list).toHaveBeenCalledWith('s1', 'src', undefined)
  })

  it('passes the abort signal through', async () => {
    const list = vi.fn(() => Promise.resolve({ ok: true, value: [] }))
    setFileReferenceSource(() => ({ fileReferences: { list } }))
    const signal = new AbortController().signal
    await fileReferenceFace()?.search('s1', 'a', signal)
    expect(list).toHaveBeenCalledWith('s1', 'a', signal)
  })

  it('resolves an empty list on a host refusal', async () => {
    const list = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'x', message: 'no' } }))
    setFileReferenceSource(() => ({ fileReferences: { list } }))
    await expect(fileReferenceFace()?.search('s1', 'a')).resolves.toEqual([])
  })

  it('resolves an empty list on a transport failure (never throws)', async () => {
    const list = vi.fn(() => Promise.reject(new Error('down')))
    setFileReferenceSource(() => ({ fileReferences: { list } }))
    await expect(fileReferenceFace()?.search('s1', 'a')).resolves.toEqual([])
  })
})
