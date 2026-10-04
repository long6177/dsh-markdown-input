/**
 * Seam: the goal face's host data plane (issue #34). The strip's verbs ride
 * the host's `remote.goals` namespace (`get` for the live activation read,
 `edit`/`pause`/`resume`/`clear` as CAS mutations over the projected ref)
 * plus the forwarded `goal/activation-changed` and `connection/reset`
 * events — the same surfaces the native dock's inject face composes.
 * Capability-detected at the surface level: a miss degrades to `undefined`,
 * never a throw (the strip keeps rendering, only its buttons shed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  goalFace, goalFaceSupported, installGoalSource, resetGoalFace, setGoalSource,
} from '../src/client/goal-face.ts'

const REF = { id: 'g1', revision: 3 }

/** A complete goals remote: every verb recorded, answers wired per test. */
function goalsRemote(answers: {
  get?: unknown
  edit?: unknown
  pause?: unknown
  resume?: unknown
  clear?: unknown
} = {}) {
  const call = (answer: unknown) => () => Promise.resolve(answer ?? { ok: true, value: null })
  return {
    get: vi.fn(call(answers.get)),
    edit: vi.fn(call(answers.edit)),
    pause: vi.fn(call(answers.pause)),
    resume: vi.fn(call(answers.resume)),
    clear: vi.fn(call(answers.clear)),
  }
}

function bindSurfaces(options: {
  /** `null` = the goals namespace service is absent. */
  goals?: ReturnType<typeof goalsRemote> | null
  withEvents?: boolean
} = {}) {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const remoteEvents = {
    $on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {
        const at = bucket.indexOf(listener)
        if (at >= 0) bucket.splice(at, 1)
      }
    }),
  }
  const goals = options.goals === null ? undefined : (options.goals ?? goalsRemote())
  setGoalSource(() => goals === undefined
    ? undefined
    : { goals, remoteEvents: options.withEvents === false ? undefined : remoteEvents })
  return { goals: goals as ReturnType<typeof goalsRemote>, remoteEvents, listeners }
}

afterEach(() => {
  resetGoalFace()
})

describe('goalFaceSupported', () => {
  it('is false while no source is installed', () => {
    expect(goalFaceSupported()).toBe(false)
    expect(goalFace()).toBeUndefined()
  })

  it('is false when the goals namespace is absent', () => {
    bindSurfaces({ goals: null })
    expect(goalFaceSupported()).toBe(false)
  })

  it('is false when a verb is missing from the namespace (installer gate)', () => {
    const partial = goalsRemote() as unknown as Record<string, unknown>
    delete partial.resume
    const ctx = {
      get: (key: string) => (key === 'remote.goals'
        ? partial
        : key === 'remote' ? { $on: vi.fn() } : undefined),
    } as unknown as ClientContext
    installGoalSource(ctx)
    expect(goalFaceSupported()).toBe(false)
  })

  it('is true when the namespace carries every verb', () => {
    bindSurfaces()
    expect(goalFaceSupported()).toBe(true)
  })

  it('is true without the forwarded-event face (subscriptions shed, verbs stay)', () => {
    bindSurfaces({ withEvents: false })
    expect(goalFaceSupported()).toBe(true)
  })
})

describe('installGoalSource', () => {
  it('resolves the traced remote.goals service, not a property on the bare remote (#29 shape)', () => {
    const goals = goalsRemote()
    const ctx = {
      get: (key: string) => (key === 'remote.goals'
        ? goals
        : key === 'remote' ? { $on: vi.fn() } : undefined),
    } as unknown as ClientContext
    installGoalSource(ctx)
    expect(goalFaceSupported()).toBe(true)
  })

  it('degrades when the namespace service is absent', () => {
    const ctx = {
      get: () => undefined,
    } as unknown as ClientContext
    installGoalSource(ctx)
    expect(goalFaceSupported()).toBe(false)
  })
})

describe('goalFace verbs', () => {
  it('edit addresses the CAS ref and wraps the objective payload', async () => {
    const { goals } = bindSurfaces()
    const face = goalFace()!
    await expect(face.edit('s1', REF, 'new objective')).resolves.toEqual({ ok: true })
    expect(goals.edit).toHaveBeenCalledWith('s1', REF, { objective: 'new objective' })
  })

  it('pause, resume, and clear address the ref bare', async () => {
    const { goals } = bindSurfaces()
    const face = goalFace()!
    await face.pause('s1', REF)
    await face.resume('s1', REF)
    await face.clear('s1', REF)
    expect(goals.pause).toHaveBeenCalledWith('s1', REF)
    expect(goals.resume).toHaveBeenCalledWith('s1', REF)
    expect(goals.clear).toHaveBeenCalledWith('s1', REF)
  })

  it('maps a refused mutation to the failure result, never a throw', async () => {
    bindSurfaces({
      goals: goalsRemote({
        edit: { ok: false, error: { code: 'revision-conflict', message: 'stale ref' } },
      }),
    })
    const face = goalFace()!
    await expect(face.edit('s1', REF, 'x')).resolves.toEqual({
      ok: false,
      error: { code: 'revision-conflict', message: 'stale ref' },
    })
  })

  it('maps a transport rejection to a failure result', async () => {
    const goals = goalsRemote()
    goals.edit.mockRejectedValue(new Error('socket closed'))
    bindSurfaces({ goals })
    const face = goalFace()!
    await expect(face.edit('s1', REF, 'x')).resolves.toEqual({
      ok: false,
      error: { code: 'failed', message: 'socket closed' },
    })
  })
})

describe('goalFace.readActivation', () => {
  it('maps the live goal view to the activation edge', async () => {
    const { goals } = bindSurfaces({
      goals: goalsRemote({ get: { ok: true, value: { ...REF, activation: 'disarmed' } } }),
    })
    const face = goalFace()!
    await expect(face.readActivation('s1')).resolves.toEqual({
      id: 'g1', revision: 3, activation: 'disarmed',
    })
    expect(goals.get).toHaveBeenCalledWith('s1')
  })

  it('answers undefined while the live read answers no goal', async () => {
    bindSurfaces({ goals: goalsRemote({ get: { ok: true, value: undefined } }) })
    const face = goalFace()!
    await expect(face.readActivation('s1')).resolves.toBeUndefined()
  })

  it('answers undefined on a refused read (the edge stays as-is)', async () => {
    bindSurfaces({ goals: goalsRemote({ get: { ok: false, error: { code: 'x', message: 'not open' } } }) })
    const face = goalFace()!
    await expect(face.readActivation('s1')).resolves.toBeUndefined()
  })
})

describe('goalFace subscriptions', () => {
  it('delivers activation edges for the session only, absent goal as undefined', () => {
    const { listeners } = bindSurfaces()
    const face = goalFace()!
    const seen: unknown[] = []
    const dispose = face.subscribeActivation('s1', (edge) => { seen.push(edge) })
    for (const listener of listeners.get('goal/activation-changed') ?? []) {
      listener({ sessionId: 's2', goal: { id: 'other', revision: 1, activation: 'armed' } })
      listener({ sessionId: 's1', goal: { id: 'g1', revision: 3, activation: 'disarmed' } })
      listener({ sessionId: 's1' })
    }
    expect(seen).toEqual([
      { id: 'g1', revision: 3, activation: 'disarmed' },
      undefined,
    ])
    dispose()
  })

  it('dispose unsubscribes the underlying event listener', () => {
    const { remoteEvents, listeners } = bindSurfaces()
    const face = goalFace()!
    const dispose = face.subscribeActivation('s1', () => {})
    dispose()
    const bucket = listeners.get('goal/activation-changed') ?? []
    expect(remoteEvents.$on).toHaveBeenCalled()
    expect(bucket.every((listener) => (listener as { removed?: boolean }).removed !== true)).toBe(true)
  })

  it('no-ops without the event face (verbs stay usable)', () => {
    bindSurfaces({ withEvents: false })
    const face = goalFace()!
    expect(() => face.subscribeActivation('s1', () => {})).not.toThrow()
    expect(() => face.subscribeReset(() => {})).not.toThrow()
  })

  it('subscribeReset fires on connection resets', () => {
    const { listeners } = bindSurfaces()
    const face = goalFace()!
    let resets = 0
    const dispose = face.subscribeReset(() => { resets += 1 })
    for (const listener of listeners.get('connection/reset') ?? []) listener()
    expect(resets).toBe(1)
    dispose()
  })
})
