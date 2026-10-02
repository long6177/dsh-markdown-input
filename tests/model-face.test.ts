/**
 * Seam: the model face's host data plane. The face rides ONE host service —
 * the `modelDirectories` resolver (ui-model-selection registers it on the
 * client root context) — consumed through a narrow structural type and
 * capability-detected: a missing service or a session whose binding has not
 * materialized degrades to `undefined` (the face then hides, the card keeps
 * working), never a throw. Availability mirrors the host seat: an addressed
 * subagent session exposes no model face.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  installModelSource, MODEL_FACE_ID, modelFaceSupported, modelSeatFace,
  resetModelFace, setModelSource, type ModelDirectoryState,
} from '../src/client/model-face.ts'
import { resetFaces } from '../src/client/face.ts'

const READY_STATE: ModelDirectoryState = {
  current: { provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'high' },
  routable: true,
  groups: [{
    id: 'deepseek-account',
    name: 'DeepSeek 账号',
    models: [{
      id: 'deepseek-chat',
      name: 'DeepSeek-V41-Flash',
      reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
    }],
  }],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
}

interface FakeDirectory {
  readonly store: {
    subscribe(listener: () => void): () => void
    getSnapshot(): ModelDirectoryState
  }
  load: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
}

/**
 * Bind a resolver-serving model source. `directories` maps session id →
 * directory; a session missing from the map makes `directoryFor` throw (the
 * host resolver fails loud for an unmaterialized session binding).
 */
function bindSource(options: {
  directories?: Map<string, FakeDirectory>
  state?: ModelDirectoryState
  loadReject?: unknown
} = {}) {
  const directories = options.directories ?? new Map()
  const source = {
    directoryFor: vi.fn((sessionId: string) => {
      const directory = directories.get(sessionId)
      if (directory === undefined) throw new Error(`session "${String(sessionId)}" resolved no binding`)
      return directory
    }),
  }
  setModelSource(() => source)
  return { source, directories }
}

function fakeDirectory(state: ModelDirectoryState = READY_STATE, options: { loadReject?: unknown } = {}): FakeDirectory {
  const listeners = new Set<() => void>()
  let snapshot = state
  return {
    store: {
      subscribe(listener: () => void): () => void {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      getSnapshot: () => snapshot,
    },
    load: vi.fn(() => {
      if (options.loadReject !== undefined) return Promise.reject(options.loadReject)
      return Promise.resolve(snapshot)
    }),
    select: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  }
}

afterEach(() => {
  resetModelFace()
  resetFaces()
})

describe('modelFaceSupported', () => {
  it('is false while no source is installed', () => {
    expect(modelFaceSupported()).toBe(false)
  })

  it('is false when the resolver answers undefined (service absent)', () => {
    setModelSource(() => undefined)
    expect(modelFaceSupported()).toBe(false)
  })

  it('is true when the resolver answers the service face', () => {
    bindSource()
    expect(modelFaceSupported()).toBe(true)
  })

  it('registers the tool.model face id', () => {
    expect(MODEL_FACE_ID).toBe('tool.model')
  })
})

describe('installModelSource', () => {
  it('resolves the modelDirectories service through the client context', () => {
    const { source } = bindSource()
    setModelSource(() => undefined)
    const ctx = {
      get: (key: string) => (key === 'modelDirectories' ? source : undefined),
    } as unknown as ClientContext
    installModelSource(ctx)
    expect(modelFaceSupported()).toBe(true)
  })

  it('is unsupported when the service is absent or structurally wrong', () => {
    const ctx = { get: () => undefined } as unknown as ClientContext
    installModelSource(ctx)
    expect(modelFaceSupported()).toBe(false)

    const broken = { get: () => ({}) } as unknown as ClientContext
    installModelSource(broken)
    expect(modelFaceSupported()).toBe(false)
  })

  it('survives a throwing context read', () => {
    const ctx = {
      get: () => { throw new Error('sealed globals') },
    } as unknown as ClientContext
    installModelSource(ctx)
    expect(modelFaceSupported()).toBe(false)
  })
})

describe('modelSeatFace', () => {
  it('is undefined while the service is absent', () => {
    expect(modelSeatFace('s1', null)).toBeUndefined()
  })

  it('is undefined when the session binding has not materialized', () => {
    bindSource({ directories: new Map() })
    expect(modelSeatFace('s1', null)).toBeUndefined()
  })

  it('injects the shared directory store with the load and select verbs', () => {
    const directory = fakeDirectory()
    bindSource({ directories: new Map([['s1', directory]]) })
    const seat = modelSeatFace('s1', null)
    expect(seat).toBeDefined()
    expect(seat?.available).toBe(true)
    expect(seat?.directory.getSnapshot()).toBe(READY_STATE)

    seat?.load()
    expect(directory.load).toHaveBeenCalledOnce()

    void seat?.select({ provider: 'deepseek-account', model: 'deepseek-reasoner' })
    expect(directory.select).toHaveBeenCalledWith({ provider: 'deepseek-account', model: 'deepseek-reasoner' })
  })

  it('hides the whole face for an addressed subagent session', async () => {
    const directory = fakeDirectory()
    bindSource({ directories: new Map([['s1', directory]]) })
    const address = { address: { mode: 'addressed' } }
    const seat = modelSeatFace('s1', address)
    expect(seat?.available).toBe(false)
    // The host seat contract: unavailable sessions resolve the directory but
    // the verbs refuse — the component then renders nothing.
    seat?.load()
    expect(directory.load).not.toHaveBeenCalled()
    await expect(seat?.select({ provider: 'a', model: 'b' })).resolves.toBeUndefined()
  })

  it('keeps a load rejection on the store surface (never escapes)', () => {
    const directory = fakeDirectory(READY_STATE, { loadReject: new Error('rpc down') })
    bindSource({ directories: new Map([['s1', directory]]) })
    const seat = modelSeatFace('s1', null)
    expect(() => seat?.load()).not.toThrow()
  })
})
