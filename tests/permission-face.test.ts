/**
 * Seam: the permission face's host data plane. The face rides two host
 * service surfaces — the `remote.permissionPresets` catalog RPC + forwarded
 * invalidation event, and the live session's command face for the
 * `/permission` write — each consumed through narrow structural types and
 * capability-detected at the surface level: a miss degrades to `undefined`,
 * never a throw (the face then hides, the card keeps working).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  installPermissionSource, permissionFace, permissionFaceSupported,
  resetPermissionFace, setPermissionSource, type PermissionCatalog,
} from '../src/client/permission-face.ts'

const CATALOG: PermissionCatalog = {
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    {
      value: 'danger-full-access', name: 'danger-full-access',
      description: 'Full file access without approval prompts.',
    },
  ],
}

interface FakeLiveSession {
  command: ReturnType<typeof vi.fn>
}

/**
 * Bind a recording surfaces resolver: the catalog read answers
 * `catalogResult` (default: the full three-preset catalog), the forwarded
 * event listener is captured for manual firing, and sessions answer from
 * `sessions` (an id without a live session binds undefined).
 */
function bindSurfaces(options: {
  catalogResult?: unknown
  reject?: unknown
  sessions?: Map<string, FakeLiveSession>
} = {}) {
  const changeListeners: (() => void)[] = []
  const sessions = options.sessions ?? new Map<string, FakeLiveSession>()
  const surfaces = {
    presets: {
      catalog: vi.fn(() => {
        if (options.reject !== undefined) return Promise.reject(options.reject)
        return Promise.resolve(options.catalogResult ?? { ok: true, value: CATALOG })
      }),
    },
    remoteEvents: {
      $on: vi.fn((_event: 'permission-presets/catalog-changed', listener: () => void) => {
        changeListeners.push(listener)
        return () => {
          const at = changeListeners.indexOf(listener)
          if (at >= 0) changeListeners.splice(at, 1)
        }
      }),
    },
    sessions: {
      binding: vi.fn((id: string) => {
        const session = sessions.get(id)
        return session === undefined ? undefined : { session }
      }),
    },
  }
  setPermissionSource(() => surfaces)
  return { surfaces, changeListeners, sessions }
}

function liveSession(command: ReturnType<typeof vi.fn>): FakeLiveSession {
  return { command }
}

afterEach(() => {
  resetPermissionFace()
})

describe('permissionFaceSupported', () => {
  it('is false while no source is installed', () => {
    expect(permissionFaceSupported()).toBe(false)
    expect(permissionFace()).toBeUndefined()
  })

  it('is false when the resolver answers undefined (surfaces absent)', () => {
    setPermissionSource(() => undefined)
    expect(permissionFaceSupported()).toBe(false)
  })

  it('is true when the resolver answers the surfaces', () => {
    bindSurfaces()
    expect(permissionFaceSupported()).toBe(true)
  })
})

describe('installPermissionSource', () => {
  it('resolves the three service surfaces through the client context', () => {
    const { surfaces } = bindSurfaces()
    const ctx = {
      get: (key: string) => (key === 'remote' ? surfaces.remoteEvents
        : key === 'remote.permissionPresets' ? surfaces.presets
        : key === 'sessions' ? surfaces.sessions
        : undefined),
    } as unknown as ClientContext
    setPermissionSource(() => undefined)
    installPermissionSource(ctx)
    expect(permissionFaceSupported()).toBe(true)
    const face = permissionFace()
    expect(face).toBeDefined()
    // The forwarded-event subscription rides the `remote` service face.
    expect(surfaces.remoteEvents.$on).toHaveBeenCalledWith(
      'permission-presets/catalog-changed', expect.any(Function))
  })

  it('is unsupported when the catalog or session surface is missing', () => {
    const missingPresets = { get: () => undefined } as unknown as ClientContext
    installPermissionSource(missingPresets)
    expect(permissionFaceSupported()).toBe(false)
    expect(permissionFace()).toBeUndefined()
  })

  it('is unsupported when a service read throws (exotic host builds)', () => {
    const throwing = {
      get: () => { throw new Error('sealed globals') },
    } as unknown as ClientContext
    installPermissionSource(throwing)
    expect(permissionFaceSupported()).toBe(false)
  })

  it('keeps working without the forwarded-event face (auto-refresh sheds)', () => {
    const sessions = { binding: vi.fn(() => undefined) }
    const presets = { catalog: vi.fn() }
    const ctx = {
      get: (key: string) => (key === 'remote.permissionPresets' ? presets
        : key === 'sessions' ? sessions : undefined),
    } as unknown as ClientContext
    installPermissionSource(ctx)
    expect(permissionFaceSupported()).toBe(true)
  })
})

describe('permissionFace catalog', () => {
  it('starts with a null catalog and loads one on refresh', async () => {
    const { surfaces } = bindSurfaces()
    const face = permissionFace()
    expect(face?.catalog.getSnapshot()).toEqual({ value: null })
    face?.refresh()
    await vi.waitFor(() => {
      expect(face?.catalog.getSnapshot()).toEqual({ value: CATALOG })
    })
    expect(surfaces.presets.catalog).toHaveBeenCalledTimes(1)
  })

  it('a failed read keeps the catalog null and does not throw', async () => {
    bindSurfaces({ catalogResult: { ok: false, error: { code: 'x/y', message: 'no' } } })
    const face = permissionFace()
    expect(() => face?.refresh()).not.toThrow()
    await vi.waitFor(() => {
      expect(face?.catalog.getSnapshot()).toEqual({ value: null })
    })
  })

  it('a rejecting read keeps the catalog null and does not throw', async () => {
    bindSurfaces({ reject: new Error('transport down') })
    const face = permissionFace()
    expect(() => face?.refresh()).not.toThrow()
    await vi.waitFor(() => {
      expect(face?.catalog.getSnapshot()).toEqual({ value: null })
    })
  })

  it('the catalog-changed event triggers a re-read', async () => {
    const { surfaces, changeListeners } = bindSurfaces()
    const face = permissionFace()
    face?.refresh()
    await vi.waitFor(() => expect(face?.catalog.getSnapshot()).toEqual({ value: CATALOG }))
    const updated: PermissionCatalog = { options: [{ value: 'auto', name: 'auto' }] }
    surfaces.presets.catalog.mockReturnValue(Promise.resolve({ ok: true, value: updated }))
    expect(changeListeners).toHaveLength(1)
    changeListeners[0]?.()
    await vi.waitFor(() => expect(face?.catalog.getSnapshot()).toEqual({ value: updated }))
  })

  it('a stale read never overwrites a newer one (latest result wins)', async () => {
    const slow = { ok: true, value: { options: [{ value: 'slow', name: 'slow' }] } }
    const fast = { ok: true, value: { options: [{ value: 'fast', name: 'fast' }] } }
    const { surfaces } = bindSurfaces()
    surfaces.presets.catalog
      .mockReturnValueOnce(new Promise((resolve) => { setTimeout(() => resolve(slow), 20) }))
      .mockReturnValueOnce(Promise.resolve(fast))
    const face = permissionFace()
    face?.refresh()
    face?.refresh()
    await vi.waitFor(() => {
      expect(face?.catalog.getSnapshot()).toEqual({ value: fast.value })
    })
    // Let the late slow settlement land; the epoch fence keeps it out.
    await new Promise((resolve) => { setTimeout(resolve, 40) })
    expect(face?.catalog.getSnapshot()).toEqual({ value: fast.value })
  })

  it('is one process-wide instance (the composer and popups share it)', () => {
    bindSurfaces()
    expect(permissionFace()).toBe(permissionFace())
  })
})

describe('permissionFace submit', () => {
  it('writes /permission <preset> through the live session and admits', async () => {
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } }))
    bindSurfaces({ sessions: new Map([['s1', liveSession(command)]]) })
    const face = permissionFace()
    await expect(face?.submit('s1', 'read-only')).resolves.toEqual({ kind: 'admitted' })
    expect(command).toHaveBeenCalledWith('/permission read-only')
  })

  it('reports an unmatched write (host offers no /permission command)', async () => {
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: false } }))
    bindSurfaces({ sessions: new Map([['s1', liveSession(command)]]) })
    const face = permissionFace()
    await expect(face?.submit('s1', 'read-only')).resolves.toEqual({ kind: 'unmatched' })
  })

  it('maps a host refusal to a failed result carrying code and message', async () => {
    const command = vi.fn(() => Promise.resolve({
      ok: false, error: { code: 'permission/unknown', message: 'unknown preset "x"' },
    }))
    bindSurfaces({ sessions: new Map([['s1', liveSession(command)]]) })
    const face = permissionFace()
    await expect(face?.submit('s1', 'x')).resolves.toEqual({
      kind: 'failed', message: 'permission/unknown: unknown preset "x"',
    })
  })

  it('a session without a live binding fails without throwing', async () => {
    bindSurfaces({ sessions: new Map() })
    const face = permissionFace()
    await expect(face?.submit('missing', 'read-only')).resolves.toMatchObject({ kind: 'failed' })
  })

  it('a rejecting command fails without throwing', async () => {
    const command = vi.fn(() => Promise.reject(new Error('transport down')))
    bindSurfaces({ sessions: new Map([['s1', liveSession(command)]]) })
    const face = permissionFace()
    await expect(face?.submit('s1', 'read-only')).resolves.toMatchObject({ kind: 'failed' })
  })
})
