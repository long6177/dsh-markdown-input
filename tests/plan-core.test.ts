/**
 * Seam: the plan chip's pure view model (issue #34). The chip's visibility
 * math and the exit-execution failure mapping are copied from the native
 * PlanChip (`ui-plan` PlanModeControl) and its injected `exitPlanMode` —
 * the chip shows while the folded target is plan mode (`pending ? !active :
 * active`, a host value, never client optimism) and runs `/plan off`.
 */
import { describe, expect, it } from 'vitest'
import {
  PLAN_EXIT_LINE, planChipVisible, planExitFailure, planProjectionOf,
} from '../src/client/plan-core.ts'
import type { CommandExecuteResult } from '../src/client/command-face.ts'

describe('planChipVisible', () => {
  it('hides while the plan projection is absent (capability missing, never a value)', () => {
    expect(planChipVisible(undefined)).toBe(false)
  })

  it('shows while plan mode is active', () => {
    expect(planChipVisible({ active: true, pending: false })).toBe(true)
  })

  it('hides while plan mode is off', () => {
    expect(planChipVisible({ active: false, pending: false })).toBe(false)
  })

  it('shows the folded target while a /plan selection is pending (on→off shows, off→on hides)', () => {
    // Active with a pending turn-off: the target reads off, so the chip hides.
    expect(planChipVisible({ active: true, pending: true })).toBe(false)
    // Inactive with a pending turn-on (/plan on just sent): the chip shows
    // before the host logs the mode — native folded-value parity.
    expect(planChipVisible({ active: false, pending: true })).toBe(true)
  })
})

describe('planExitFailure', () => {
  it('accepts a settled execution', () => {
    const result: CommandExecuteResult = { kind: 'success' }
    expect(planExitFailure(result)).toBeNull()
  })

  it('surfaces the handler error outcome text', () => {
    const result: CommandExecuteResult = { kind: 'error', text: 'plan mode is not active' }
    expect(planExitFailure(result)).toBe('plan mode is not active')
  })

  it('names the native unknown-command line for an unmatched host', () => {
    const result: CommandExecuteResult = { kind: 'unmatched' }
    expect(planExitFailure(result)).toBe('unknown command: /plan off')
  })

  it('carries the host refusal or transport failure message', () => {
    const result: CommandExecuteResult = { kind: 'failed', message: 'timeout' }
    expect(planExitFailure(result)).toBe('timeout')
  })
})

describe('planProjectionOf', () => {
  it('reads a well-formed frame', () => {
    expect(planProjectionOf({ active: true, pending: false })).toEqual({ active: true, pending: false })
  })

  it('reads the key absence for null, non-objects, and foreign frames', () => {
    expect(planProjectionOf(undefined)).toBeUndefined()
    expect(planProjectionOf(null)).toBeUndefined()
    expect(planProjectionOf('plan')).toBeUndefined()
    expect(planProjectionOf({})).toBeUndefined()
    expect(planProjectionOf({ active: 'yes', pending: false })).toBeUndefined()
  })
})

describe('PLAN_EXIT_LINE', () => {
  it('is the native detached-execution line', () => {
    expect(PLAN_EXIT_LINE).toBe('/plan off')
  })
})
