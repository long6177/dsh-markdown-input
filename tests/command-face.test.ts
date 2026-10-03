/**
 * Seam: the command face's host data plane. The face rides one host service
 * surface — the `remote.commands` namespace (per-session catalog `list` plus
 * detached `execute`) with its forwarded invalidation events — consumed
 * through narrow structural types and capability-detected at the surface
 * level: a miss degrades to `undefined`, never a throw (the face then hides,
 * the card keeps working).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  commandFace, commandFaceSupported, installCommandSource,
  resetCommandFace, setCommandSource, type CommandDescriptor,
} from '../src/client/command-face.ts'

const GOAL: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-command-goal', name: 'goal',
  description: 'Set or view the goal', input: { hint: '[<objective>|clear]' },
}
const COMPACT: CommandDescriptor = {
  definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact',
  description: 'Compact older conversation history',
}

/**
 * Bind a recording surfaces resolver: `list` answers `listResult` (or
 * rejects under `reject`), the forwarded-event listeners are captured for
 * manual firing keyed by event name.
 */
function bindSurfaces(options: {
  listResult?: unknown
  reject?: unknown
  executeResult?: unknown
  sessions?: Record<string, unknown>
} = {}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const surfaces = {
    remote: {
      commands: {
        list: vi.fn(() => {
          if (options.reject !== undefined) return Promise.reject(options.reject)
          return Promise.resolve(options.listResult ?? { ok: true, value: [GOAL, COMPACT] })
        }),
        execute: vi.fn(() => Promise.resolve(options.executeResult ?? { ok: true, value: undefined })),
      },
      $on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        const bucket = listeners.get(event) ?? []
        bucket.push(listener)
        listeners.set(event, bucket)
        return () => {
          const at = bucket.indexOf(listener)
          if (at >= 0) bucket.splice(at, 1)
        }
      }),
    },
  }
  setCommandSource(() => ({
    commands: surfaces.remote.commands,
    remoteEvents: surfaces.remote,
  }) as never)
  return { surfaces, listeners }
}

function fire(listeners: Map<string, Array<(...args: unknown[]) => void>>, event: string, ...args: unknown[]): void {
  for (const listener of listeners.get(event) ?? []) listener(...args)
}

afterEach(() => {
  resetCommandFace()
})

describe('commandFaceSupported', () => {
  it('is false while no source is installed', () => {
    expect(commandFaceSupported()).toBe(false)
    expect(commandFace()).toBeUndefined()
  })

  it('is false when the resolver answers undefined (surfaces absent)', () => {
    setCommandSource(() => undefined)
    expect(commandFaceSupported()).toBe(false)
  })

  it('is true when the resolver answers the surfaces', () => {
    bindSurfaces()
    expect(commandFaceSupported()).toBe(true)
  })
})

describe('installCommandSource', () => {
  it('resolves the remote.commands namespace through the client context', () => {
    const { surfaces } = bindSurfaces()
    const ctx = {
      get: (key: string) => (key === 'remote' ? surfaces.remote : undefined),
    } as unknown as ClientContext
    setCommandSource(() => undefined)
    installCommandSource(ctx)
    expect(commandFaceSupported()).toBe(true)
  })

  it('is unsupported when the commands namespace is missing or incomplete', () => {
    const noRemote = { get: () => undefined } as unknown as ClientContext
    installCommandSource(noRemote)
    expect(commandFaceSupported()).toBe(false)

    const partial = {
      get: (key: string) => (key === 'remote' ? { commands: { list: vi.fn() } } : undefined),
    } as unknown as ClientContext
    installCommandSource(partial)
    expect(commandFaceSupported()).toBe(false)
  })

  it('is unsupported when a service read throws (exotic host builds)', () => {
    const throwing = { get: () => { throw new Error('sealed globals') } } as unknown as ClientContext
    installCommandSource(throwing)
    expect(commandFaceSupported()).toBe(false)
  })

  it('keeps working without the forwarded-event face (auto-invalidation sheds)', () => {
    const remote = { commands: { list: vi.fn(), execute: vi.fn() } }
    const ctx = { get: (key: string) => (key === 'remote' ? remote : undefined) } as unknown as ClientContext
    installCommandSource(ctx)
    expect(commandFaceSupported()).toBe(true)
  })
})

describe('commandFace catalog cache', () => {
  it('starts empty and caches one session catalog on ensure', async () => {
    const { surfaces } = bindSurfaces()
    const face = commandFace()
    expect(face?.catalogs.getSnapshot().value.get('s1')).toBeUndefined()
    face?.ensure('s1')
    await vi.waitFor(() => {
      expect(face?.catalogs.getSnapshot().value.get('s1')).toEqual([GOAL, COMPACT])
    })
    expect(surfaces.remote.commands.list).toHaveBeenCalledWith('s1')
    // A second ensure for a cached session is served from the cache.
    face?.ensure('s1')
    expect(surfaces.remote.commands.list).toHaveBeenCalledTimes(1)
  })

  it('caches per session: a second session reads its own catalog', async () => {
    const { surfaces } = bindSurfaces()
    const face = commandFace()
    face?.ensure('s1')
    await vi.waitFor(() => expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(true))
    surfaces.remote.commands.list.mockReturnValue(
      Promise.resolve({ ok: true, value: [COMPACT] }))
    face?.ensure('s2')
    await vi.waitFor(() => expect(face?.catalogs.getSnapshot().value.has('s2')).toBe(true))
    expect(face?.catalogs.getSnapshot().value.get('s1')).toEqual([GOAL, COMPACT])
    expect(face?.catalogs.getSnapshot().value.get('s2')).toEqual([COMPACT])
  })

  it('a failed read leaves the session uncached (a later ensure retries) and does not throw', async () => {
    bindSurfaces({ listResult: { ok: false, error: { code: 'x/y', message: 'no' } } })
    const face = commandFace()
    expect(() => face?.ensure('s1')).not.toThrow()
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(false)
  })

  it('a rejecting read leaves the session uncached and does not throw', async () => {
    bindSurfaces({ reject: new Error('transport down') })
    const face = commandFace()
    expect(() => face?.ensure('s1')).not.toThrow()
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(false)
  })

  it('does not publish during a session with an in-flight read (one read per session)', async () => {
    const { surfaces } = bindSurfaces()
    let release: (value: unknown) => void = () => {}
    surfaces.remote.commands.list.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve }))
    const face = commandFace()
    face?.ensure('s1')
    face?.ensure('s1')
    expect(surfaces.remote.commands.list).toHaveBeenCalledTimes(1)
    release({ ok: true, value: [COMPACT] })
    await vi.waitFor(() => expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(true))
  })

  it('the commands/change event invalidates every session cache', async () => {
    const { surfaces, listeners } = bindSurfaces()
    const face = commandFace()
    face?.ensure('s1')
    await vi.waitFor(() => expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(true))
    fire(listeners, 'commands/change')
    expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(false)
  })

  it('the agent-preset/selected event invalidates only that session', async () => {
    const { surfaces, listeners } = bindSurfaces()
    const face = commandFace()
    face?.ensure('s1')
    face?.ensure('s2')
    await vi.waitFor(() => {
      expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(true)
      expect(face?.catalogs.getSnapshot().value.has('s2')).toBe(true)
    })
    fire(listeners, 'agent-preset/selected', 's1')
    expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(false)
    expect(face?.catalogs.getSnapshot().value.has('s2')).toBe(true)
  })

  it('the connection/reset event invalidates every session cache', async () => {
    const { listeners } = bindSurfaces()
    const face = commandFace()
    face?.ensure('s1')
    await vi.waitFor(() => expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(true))
    fire(listeners, 'connection/reset')
    expect(face?.catalogs.getSnapshot().value.has('s1')).toBe(false)
  })

  it('is one process-wide instance (every surface shares the cache)', () => {
    bindSurfaces()
    expect(commandFace()).toBe(commandFace())
  })
})

describe('commandFace execute', () => {
  it('runs the line remotely and reports success', async () => {
    const { surfaces } = bindSurfaces({
      executeResult: { ok: true, value: { commandId: 'c1', result: { kind: 'success' } } },
    })
    const face = commandFace()
    await expect(face?.execute('s1', '/compact')).resolves.toEqual({ kind: 'success' })
    expect(surfaces.remote.commands.execute).toHaveBeenCalledWith('s1', '/compact')
  })

  it('maps a handler error result to an error carrying its text', async () => {
    bindSurfaces({
      executeResult: {
        ok: true, value: { commandId: 'c1', result: { kind: 'error', text: 'no goal set' } },
      },
    })
    const face = commandFace()
    await expect(face?.execute('s1', '/compact')).resolves.toEqual({ kind: 'error', text: 'no goal set' })
  })

  it('maps an undefined value to unmatched (unknown or malformed command)', async () => {
    bindSurfaces({ executeResult: { ok: true, value: undefined } })
    const face = commandFace()
    await expect(face?.execute('s1', '/nope')).resolves.toEqual({ kind: 'unmatched' })
  })

  it('maps a host refusal to a failed result carrying code and message', async () => {
    bindSurfaces({
      executeResult: { ok: false, error: { code: 'session/writer-held', message: 'busy' } },
    })
    const face = commandFace()
    await expect(face?.execute('s1', '/compact')).resolves.toEqual({
      kind: 'failed', message: 'session/writer-held: busy',
    })
  })

  it('a rejecting call fails without throwing', async () => {
    const { surfaces } = bindSurfaces()
    surfaces.remote.commands.execute.mockReturnValue(Promise.reject(new Error('transport down')))
    const face = commandFace()
    await expect(face?.execute('s1', '/compact')).resolves.toMatchObject({ kind: 'failed' })
  })
})
