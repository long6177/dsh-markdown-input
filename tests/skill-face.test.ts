/**
 * Seam: the skill lexicon face's host data plane — the `remote.skills.list`
 * RPC the native `/` completion source reads its hot dictionary from,
 * consumed through narrow structural types and capability-detected at the
 * surface level (a miss degrades to `undefined`, the chip decorations'
 * `/` arm then stays plain text — never a throw into the card).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installSkillSource, resetSkillFace, skillFace,
} from '../src/client/skill-face.ts'

function bindSurfaces(options: {
  listResult?: unknown
  reject?: unknown
} = {}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const surfaces = {
    remote: {
      skills: {
        list: vi.fn(() => {
          if (options.reject !== undefined) return Promise.reject(options.reject)
          return Promise.resolve(options.listResult ?? {
            ok: true,
            value: { skills: [{ name: 'plan', description: '', modelInvocable: true }, { name: 'read-file', description: '', modelInvocable: false }] },
          })
        }),
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
  installSkillSource({
    get: (key: string) => (key === 'remote.skills'
      ? surfaces.remote.skills
      : key === 'remote' ? { $on: surfaces.remote.$on } : undefined),
  } as never)
  return { surfaces, listeners }
}

function fire(listeners: Map<string, Array<(...args: unknown[]) => void>>, event: string, ...args: unknown[]): void {
  for (const listener of listeners.get(event) ?? []) listener(...args)
}

afterEach(() => {
  resetSkillFace()
})

describe('skillFaceSupported', () => {
  it('is undefined while no source is installed', () => {
    expect(skillFace()).toBeUndefined()
  })

  it('is undefined when the remote namespace lacks the skills list verb', () => {
    installSkillSource({ get: (key: string) => (key === 'remote.skills' ? {} : undefined) } as never)
    expect(skillFace()).toBeUndefined()
  })

  it('resolves when the list verb is present', () => {
    bindSurfaces()
    expect(skillFace()).toBeDefined()
  })
})

describe('skillFace', () => {
  it('fetches a session lexicon and publishes its entries', async () => {
    bindSurfaces()
    const face = skillFace()
    expect(face).toBeDefined()
    face!.ensure('s1')
    await vi.waitFor(() => {
      // The entries pass through whole: the chip decorations read `name`,
      // the completion popup (T10) reads the discovery copy beside it.
      expect(face!.lexicons.getSnapshot().value.get('s1')).toEqual([
        { name: 'plan', description: '', modelInvocable: true },
        { name: 'read-file', description: '', modelInvocable: false },
      ])
    })
  })

  it('caches per session (one list call per ensure)', async () => {
    const { surfaces } = bindSurfaces()
    const face = skillFace()!
    face.ensure('s1')
    await vi.waitFor(() => expect(surfaces.remote.skills.list).toHaveBeenCalledOnce())
    face.ensure('s1')
    expect(surfaces.remote.skills.list).toHaveBeenCalledOnce()
  })

  it('keeps the session uncached on a failed result (a later ensure retries)', async () => {
    const { surfaces } = bindSurfaces({ listResult: { ok: false, error: { code: 'x', message: 'boom' } } })
    const face = skillFace()!
    face.ensure('s1')
    await vi.waitFor(() => expect(surfaces.remote.skills.list).toHaveBeenCalledOnce())
    expect(face.lexicons.getSnapshot().value.has('s1')).toBe(false)
  })

  it('keeps the session uncached on a rejected call', async () => {
    const { surfaces } = bindSurfaces({ reject: new Error('offline') })
    const face = skillFace()!
    face.ensure('s1')
    await vi.waitFor(() => expect(surfaces.remote.skills.list).toHaveBeenCalledOnce())
    expect(face.lexicons.getSnapshot().value.has('s1')).toBe(false)
  })

  it('drops one session on agent-preset/selected and all on connection/reset', async () => {
    const { listeners, surfaces } = bindSurfaces()
    const face = skillFace()!
    face.ensure('s1')
    face.ensure('s2')
    await vi.waitFor(() => expect(surfaces.remote.skills.list).toHaveBeenCalledTimes(2))
    expect(face.lexicons.getSnapshot().value.size).toBe(2)
    fire(listeners, 'agent-preset/selected', 's1')
    expect(face.lexicons.getSnapshot().value.size).toBe(1)
    fire(listeners, 'connection/reset')
    expect(face.lexicons.getSnapshot().value.size).toBe(0)
  })

  it('ignores non-string agent-preset payloads', async () => {
    const { listeners, surfaces } = bindSurfaces()
    const face = skillFace()!
    face.ensure('s1')
    await vi.waitFor(() => expect(surfaces.remote.skills.list).toHaveBeenCalledOnce())
    fire(listeners, 'agent-preset/selected', 42)
    expect(face.lexicons.getSnapshot().value.size).toBe(1)
  })

  it('is a page-lifetime singleton; resetSkillFace clears it', async () => {
    const { surfaces } = bindSurfaces()
    const first = skillFace()
    expect(skillFace()).toBe(first)
    resetSkillFace()
    // The reset drops the source too: the face stays undefined until a
    // fresh apply installs it again.
    expect(skillFace()).toBeUndefined()
    bindSurfaces()
    const second = skillFace()
    expect(second).toBeDefined()
    expect(second).not.toBe(first)
    expect(surfaces.remote.skills.list).not.toHaveBeenCalled()
  })
})
