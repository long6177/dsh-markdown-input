/**
 * The plan chip's pure view model (issue #34): when the takeover card's
 * tool row shows the plan chip and what a failed exit reports. The math is
 * copied from the native PlanChip (`ui-plan` PlanModeControl, the slot
 * `conversation.input.plan` seat the takeover structurally replaces): the
 * chip renders only while the folded target is plan mode — `pending ? !
 * active : active`, a host value, never client optimism — and exit runs the
 * native detached line `/plan off`, whose failure strings stay English
 * (error-surface policy).
 */

/** The `plan` session projection's wire value (host PlanProjection shape). */
export interface PlanProjectionState {
  /** The logged plan-mode state in force. */
  readonly active: boolean
  /** True while a logged `/plan` selection targets a state other than `active`. */
  readonly pending: boolean
}

/**
 * Structural read of one `plan` projection frame: wire data despite its
 * typed face — a missing or foreign field reads as the key's absence
 * (capability absence is the key's absence, never a value).
 * @param value - the raw projection value.
 */
export function planProjectionOf(value: unknown): PlanProjectionState | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const plan = value as Partial<PlanProjectionState>
  if (typeof plan.active !== 'boolean' || typeof plan.pending !== 'boolean') return undefined
  return { active: plan.active, pending: plan.pending }
}

/** The native detached-execution line the chip runs to leave plan mode. */
export const PLAN_EXIT_LINE = '/plan off'

/**
 * Native chip visibility: the folded target is plan mode. An absent
 * projection (plan-mode not composed on the host) reads hidden — the
 * capability's absence is the key's absence, never a value.
 * @param plan - the `plan` projection snapshot, undefined when absent.
 */
export function planChipVisible(plan: PlanProjectionState | undefined): boolean {
  if (plan === undefined) return false
  return plan.pending ? !plan.active : plan.active
}

/**
 * Map one settled exit execution to the failure line the chip reports
 * inline (native `exitPlanMode`'s contract: null on admitted execution, a
 * user-visible failure line otherwise).
 * @param result - the command face's mapped execution outcome.
 */
export function planExitFailure(result: {
  readonly kind: 'success' | 'error' | 'unmatched' | 'failed'
  readonly text?: string
  readonly message?: string
}): string | null {
  switch (result.kind) {
    case 'success': return null
    case 'error': return result.text ?? ''
    case 'unmatched': return `unknown command: ${PLAN_EXIT_LINE}`
    case 'failed': return result.message ?? ''
  }
}
