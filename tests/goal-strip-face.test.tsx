/**
 * Seam: the takeover card's goal strip as the user sees it (issue #34). The
 * strip is the card's rebuild of the native GoalBar/GoalDock (`ui-goal`,
 * the `conversation.input.dock` order-10 seat the takeover structurally
 * hides with the whole fallback bar): a present, non-complete goal shows
 * glyph, phase label (activation-aware), objective, and pause/resume/edit/
 * clear verbs; loading, absent, and complete goals render nothing; a
 * failed mutation reports inline while the strip stays.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { GoalStripFace, goalStripFaceDefinition } from '../src/client/GoalStripFace.tsx'
import { resetGoalFace, setGoalSource } from '../src/client/goal-face.ts'
import { en } from '../src/client/locales.ts'
import type { GoalProjectionView } from '../src/client/goal-core.ts'

function fakeT(key: keyof typeof en, params?: Record<string, string>): string {
  return en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
}

function strip(): HTMLElement | null {
  return document.querySelector('[data-markdown-goal]')
}

function labeled(label: string): HTMLButtonElement | null {
  return document.querySelector(`button[aria-label="${label}"]`)
}

function goalBar(): HTMLElement | null {
  return document.querySelector('[data-markdown-goal-bar]')
}

function stripError(): HTMLElement | null {
  return document.querySelector('[data-markdown-goal-error]')
}

function objectiveInput(): HTMLInputElement | null {
  return document.querySelector('input[data-markdown-goal-input]')
}

/** A complete goals remote: verbs recorded, per-test answers. */
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

interface Harness {
  goals: ReturnType<typeof goalsRemote>
  fire(event: 'goal/activation-changed' | 'connection/reset', ...args: unknown[]): void
}

/**
 * Bind the goal source with a recording remote and live-event capture;
 * `get` answers an armed activation unless the test overrides it.
 */
function bindGoals(options: {
  get?: unknown
  edit?: unknown
  resume?: unknown
  clear?: unknown
} = {}): Harness {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const goals = goalsRemote(options)
  setGoalSource(() => ({
    goals,
    remoteEvents: {
      $on: (event: string, listener: (...args: unknown[]) => void) => {
        const bucket = listeners.get(event) ?? []
        bucket.push(listener)
        listeners.set(event, bucket)
        return () => {
          const at = bucket.indexOf(listener)
          if (at >= 0) bucket.splice(at, 1)
        }
      },
    },
  }))
  return {
    goals,
    fire(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
  }
}

function goalProjection(overrides: Partial<GoalProjectionView['goal']> = {}): GoalProjectionView {
  return {
    goal: {
      id: 'g1', revision: 3, objective: 'ship the release', phase: 'active',
      maxGoalRounds: 8, ...overrides,
    },
  }
}

function mountStrip(
  projection: GoalProjectionView | null | undefined,
  options: { sessionId?: string; running?: boolean } = {},
) {
  const view = render(
    <FaceGate definition={goalStripFaceDefinition(((key: string) =>
      key === 'goal' ? projection : undefined) as unknown)}>
      <GoalStripFace
        useProjection={(key) => (key === 'goal' ? projection : undefined)}
        sessionId={'sessionId' in options ? options.sessionId : 's1'}
        running={options.running ?? false}
        t={fakeT}
      />
    </FaceGate>,
  )
  const rerender = (
    nextProjection: GoalProjectionView | null | undefined,
    nextOptions: { sessionId?: string; running?: boolean } = {},
  ) => {
    view.rerender(
      <FaceGate definition={goalStripFaceDefinition(((key: string) =>
        key === 'goal' ? nextProjection : undefined) as unknown)}>
        <GoalStripFace
          useProjection={(key) => (key === 'goal' ? nextProjection : undefined)}
          sessionId={'sessionId' in nextOptions
            ? nextOptions.sessionId
            : 'sessionId' in options ? options.sessionId : 's1'}
          running={nextOptions.running ?? options.running ?? false}
          t={fakeT}
        />
      </FaceGate>,
    )
  }
  return { view, rerender }
}

afterEach(() => {
  cleanup()
  resetGoalFace()
  resetFaces()
})

describe('GoalStripFace visibility', () => {
  it('renders nothing while the projection is loading (undefined)', () => {
    bindGoals()
    mountStrip(undefined)
    expect(strip()).toBeNull()
  })

  it('renders nothing while no goal is set (null)', () => {
    bindGoals()
    mountStrip(null)
    expect(strip()).toBeNull()
  })

  it('renders nothing for a complete goal', () => {
    bindGoals()
    mountStrip(goalProjection({ phase: 'complete' }))
    expect(strip()).toBeNull()
  })

  it('renders the strip for a present goal with its objective', () => {
    bindGoals()
    mountStrip(goalProjection())
    expect(strip()).not.toBeNull()
    expect(document.querySelector('[data-markdown-goal-objective]')!.textContent).toBe('ship the release')
  })

  it('keeps rendering while the verb face is absent — only the buttons shed', () => {
    setGoalSource(() => undefined)
    mountStrip(goalProjection())
    expect(strip()).not.toBeNull()
    expect(labeled(fakeT('goal.action.pause'))).toBeNull()
    expect(labeled(fakeT('goal.action.edit'))).toBeNull()
    expect(labeled(fakeT('goal.action.clear'))).toBeNull()
  })
})

describe('GoalStripFace phases and activation', () => {
  it('labels an armed active goal and shows pause, edit, and clear', async () => {
    bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    mountStrip(goalProjection())
    await waitFor(() => {
      expect(goalBar()!.textContent).toContain(fakeT('goal.phase.active'))
    })
    expect(labeled(fakeT('goal.action.pause'))).not.toBeNull()
    expect(labeled(fakeT('goal.action.resume'))).toBeNull()
    expect(labeled(fakeT('goal.action.edit'))).not.toBeNull()
    expect(labeled(fakeT('goal.action.clear'))).not.toBeNull()
  })

  it('labels a disarmed active goal and swaps pause for resume', async () => {
    bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'disarmed' } } })
    mountStrip(goalProjection())
    await waitFor(() => {
      expect(goalBar()!.textContent).toContain(fakeT('goal.phase.active.disarmed'))
    })
    expect(labeled(fakeT('goal.action.pause'))).toBeNull()
    expect(labeled(fakeT('goal.action.resume'))).not.toBeNull()
  })

  it('ignores an activation edge that does not match the exact goal revision', async () => {
    const harness = bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    mountStrip(goalProjection())
    await waitFor(() => {
      expect(labeled(fakeT('goal.action.pause'))).not.toBeNull()
    })
    harness.fire('goal/activation-changed', { sessionId: 's1', goal: { id: 'g1', revision: 4, activation: 'disarmed' } })
    expect(labeled(fakeT('goal.action.pause'))).not.toBeNull()
    harness.fire('goal/activation-changed', { sessionId: 's1', goal: { id: 'g1', revision: 3, activation: 'disarmed' } })
    await waitFor(() => {
      expect(labeled(fakeT('goal.action.resume'))).not.toBeNull()
    })
  })

  it('labels a paused goal with resume only, whatever the activation', () => {
    bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    mountStrip(goalProjection({ phase: 'paused' }))
    expect(goalBar()!.textContent).toContain(fakeT('goal.phase.paused'))
    expect(labeled(fakeT('goal.action.pause'))).toBeNull()
    expect(labeled(fakeT('goal.action.resume'))).not.toBeNull()
  })

  it('titles a blocked goal with its reason and labels it blocked', () => {
    bindGoals()
    mountStrip(goalProjection({
      phase: 'blocked',
      blockedReason: { code: 'approval', message: 'waiting for approval' },
    }))
    expect(goalBar()!.textContent).toContain(fakeT('goal.phase.blocked'))
    expect(goalBar()!.getAttribute('title')).toBe('waiting for approval')
  })

  it('re-reads the live activation when the running state flips', async () => {
    const harness = bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    const { rerender } = mountStrip(goalProjection(), { running: false })
    await waitFor(() => expect(harness.goals.get).toHaveBeenCalledTimes(1))
    harness.goals.get.mockClear()
    rerender(goalProjection(), { running: true })
    await waitFor(() => expect(harness.goals.get).toHaveBeenCalledTimes(1))
  })

  it('re-reads the live activation after a transport reset', async () => {
    const harness = bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    mountStrip(goalProjection())
    await waitFor(() => expect(harness.goals.get).toHaveBeenCalledTimes(1))
    harness.goals.get.mockClear()
    harness.fire('connection/reset')
    await waitFor(() => expect(harness.goals.get).toHaveBeenCalledTimes(1))
  })
})

describe('GoalStripFace mutations', () => {
  it('pauses and resumes through the projected CAS ref', async () => {
    const harness = bindGoals({ get: { ok: true, value: { id: 'g1', revision: 3, activation: 'armed' } } })
    const { rerender } = mountStrip(goalProjection())
    await waitFor(() => expect(labeled(fakeT('goal.action.pause'))).not.toBeNull())
    fireEvent.click(labeled(fakeT('goal.action.pause'))!)
    await waitFor(() => {
      expect(harness.goals.pause).toHaveBeenCalledWith('s1', { id: 'g1', revision: 3 })
    })
    // The pushed projection frame lands (phase paused): pause sheds, resume appears.
    rerender(goalProjection({ phase: 'paused' }))
    expect(labeled(fakeT('goal.action.pause'))).toBeNull()
    fireEvent.click(labeled(fakeT('goal.action.resume'))!)
    await waitFor(() => {
      expect(harness.goals.resume).toHaveBeenCalledWith('s1', { id: 'g1', revision: 3 })
    })
    // The resumed frame re-arms: pause returns.
    rerender(goalProjection())
    await waitFor(() => expect(labeled(fakeT('goal.action.pause'))).not.toBeNull())
  })

  it('edits the objective inline and saves through the edit verb', async () => {
    const harness = bindGoals()
    mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.edit'))!)
    const input = objectiveInput()
    expect(input).not.toBeNull()
    expect(input!.value).toBe('ship the release')
    fireEvent.change(input!, { target: { value: 'ship the release, revised' } })
    fireEvent.keyDown(input!, { key: 'Enter' })
    await waitFor(() => {
      expect(harness.goals.edit).toHaveBeenCalledWith(
        's1', { id: 'g1', revision: 3 }, { objective: 'ship the release, revised' },
      )
    })
    await waitFor(() => {
      expect(objectiveInput()).toBeNull()
    })
  })

  it('keeps the editor open with the error inline when a save fails', async () => {
    bindGoals({
      edit: { ok: false, error: { code: 'revision-conflict', message: 'stale ref' } },
    })
    mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.edit'))!)
    const input = objectiveInput()!
    fireEvent.change(input, { target: { value: 'revised' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(stripError()).not.toBeNull()
    })
    expect(stripError()!.textContent).toBe('stale ref (revision-conflict)')
    expect(objectiveInput()).not.toBeNull()
  })

  it('ignores an empty edit and closes the editor on Escape', () => {
    const harness = bindGoals()
    mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.edit'))!)
    const input = objectiveInput()!
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(harness.goals.edit).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(objectiveInput()).toBeNull()
  })

  it('clears the goal and hides the strip ahead of the projection catching up', async () => {
    const harness = bindGoals()
    const { rerender } = mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.clear'))!)
    await waitFor(() => {
      expect(harness.goals.clear).toHaveBeenCalledWith('s1', { id: 'g1', revision: 3 })
    })
    await waitFor(() => {
      expect(strip()).toBeNull()
    })
    // The projection still holding the cleared goal (pre-tombstone frame)
    // must not resurrect the strip.
    rerender(goalProjection())
    expect(strip()).toBeNull()
    // A NEW goal identity clears the tombstone and shows again.
    rerender(goalProjection({ id: 'g2', revision: 1 }))
    expect(strip()).not.toBeNull()
  })

  it('reports a refused mutation inline while the strip stays', async () => {
    bindGoals({
      clear: { ok: false, error: { code: 'transport', message: 'socket closed' } },
    })
    mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.clear'))!)
    await waitFor(() => {
      expect(stripError()).not.toBeNull()
    })
    expect(stripError()!.textContent).toBe('socket closed (transport)')
    expect(strip()).not.toBeNull()
  })

  it('resets the edit and error state when a new goal identity arrives', async () => {
    const harness = bindGoals()
    const { rerender } = mountStrip(goalProjection())
    fireEvent.click(labeled(fakeT('goal.action.edit'))!)
    expect(objectiveInput()).not.toBeNull()
    rerender(goalProjection({ id: 'g2', revision: 1, objective: 'next goal' }))
    expect(objectiveInput()).toBeNull()
    expect(harness.goals.edit).not.toHaveBeenCalled()
  })

  it('sheds the buttons while the session id is absent (nothing to address)', () => {
    bindGoals()
    mountStrip(goalProjection(), { sessionId: undefined })
    expect(strip()).not.toBeNull()
    expect(labeled(fakeT('goal.action.pause'))).toBeNull()
    expect(labeled(fakeT('goal.action.edit'))).toBeNull()
  })
})
