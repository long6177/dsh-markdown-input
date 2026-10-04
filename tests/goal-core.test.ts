/**
 * Seam: the goal strip's pure view model (issue #34). Visibility, the CAS
 * ref read, and the activation edge matching are copied from the native
 * GoalBar/GoalDock (`ui-goal`) — loading, absent, and complete goals have no
 * strip at all; mutations address the projected ref; the process-local
 * activation only counts when it matches the exact goal revision.
 */
import { describe, expect, it } from 'vitest'
import {
  GOAL_NO_CURRENT_RESULT, activationFor, goalRefOf, goalStripVisible,
  type GoalProjectionView,
} from '../src/client/goal-core.ts'

const GOAL: GoalProjectionView = {
  goal: {
    id: 'g1', revision: 3, objective: 'ship the release', phase: 'active',
    maxGoalRounds: 8,
  },
}

describe('goalStripVisible', () => {
  it('hides while the projection is loading (undefined)', () => {
    expect(goalStripVisible(undefined)).toBe(false)
  })

  it('hides while no goal is set (null)', () => {
    expect(goalStripVisible(null)).toBe(false)
  })

  it('shows while the goal is active, paused, or blocked', () => {
    expect(goalStripVisible(GOAL)).toBe(true)
    expect(goalStripVisible({ goal: { ...GOAL.goal, phase: 'paused' } })).toBe(true)
    expect(goalStripVisible({
      goal: { ...GOAL.goal, phase: 'blocked', blockedReason: { code: 'policy', message: 'waiting' } },
    })).toBe(true)
  })

  it('hides a complete goal', () => {
    expect(goalStripVisible({ goal: { ...GOAL.goal, phase: 'complete' } })).toBe(false)
  })
})

describe('goalRefOf', () => {
  it('reads the CAS ref off the projected goal', () => {
    expect(goalRefOf(GOAL)).toEqual({ id: 'g1', revision: 3 })
  })

  it('answers undefined without a goal (no ref to address a mutation to)', () => {
    expect(goalRefOf(undefined)).toBeUndefined()
    expect(goalRefOf(null)).toBeUndefined()
  })
})

describe('activationFor', () => {
  it('counts the activation edge only on the exact goal revision', () => {
    expect(activationFor({ id: 'g1', revision: 3, activation: 'armed' }, GOAL.goal)).toBe('armed')
    expect(activationFor({ id: 'g1', revision: 4, activation: 'armed' }, GOAL.goal)).toBeUndefined()
    expect(activationFor({ id: 'g2', revision: 3, activation: 'disarmed' }, GOAL.goal)).toBeUndefined()
  })

  it('answers undefined while the edge is empty (no live read yet)', () => {
    expect(activationFor({}, GOAL.goal)).toBeUndefined()
  })

  it('answers undefined while the edge carries no activation value', () => {
    expect(activationFor({ id: 'g1', revision: 3 }, GOAL.goal)).toBeUndefined()
  })
})

describe('GOAL_NO_CURRENT_RESULT', () => {
  it('is the native wire-shaped local failure', () => {
    expect(GOAL_NO_CURRENT_RESULT).toEqual({
      ok: false,
      error: { code: 'no-current-goal', message: 'no current goal to mutate' },
    })
  })
})
