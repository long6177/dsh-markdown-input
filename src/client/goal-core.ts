/**
 * The goal strip's pure view model (issue #34): when the takeover card
 * shows the goal bar the native composer keeps in its `conversation.input.
 * dock` (GoalDock, order 10 — a seat the takeover structurally hides with
 * the whole fallback bar), the ref its mutations address, and how a
 * process-local activation edge counts for the projected goal. The math is
 * copied from the native GoalBar/GoalDock (`ui-goal`): loading (undefined),
 * no goal (null), and complete goals render nothing; mutations ride the
 * CAS ref read off the projection at call time; the activation only counts
 * when it matches the exact goal identity and revision.
 */

/** Durable lifecycle phase of a goal (host GoalPhase). */
export type GoalPhase = 'active' | 'paused' | 'blocked' | 'complete'

/** Process-local continuation state of the live agent process (host GoalActivation). */
export type GoalActivation = 'armed' | 'disarmed'

/** The CAS ref the mutation verbs address (host GoalRef shape). */
export interface GoalRefView {
  readonly id: string
  readonly revision: number
}

/** The projected goal snapshot the strip renders (host GoalSnapshot shape). */
export interface GoalSnapshotView extends GoalRefView {
  /** Human-requested completion objective. */
  readonly objective: string
  /** Durable lifecycle phase. */
  readonly phase: GoalPhase
  /** Present exactly while `phase` is `blocked`. */
  readonly blockedReason?: { readonly code: string; readonly message: string }
  /** Total admitted goal-round cap. */
  readonly maxGoalRounds?: number
}

/** The `goal` session projection's wire value (host GoalProjection shape). */
export interface GoalProjectionView {
  readonly goal: GoalSnapshotView
}

/** One process-local activation edge as the live read and events deliver it. */
export interface GoalActivationEdge {
  readonly id?: string
  readonly revision?: number
  readonly activation?: GoalActivation
}

/** The one failure the strip reports without a wire call (native wire shape). */
export const GOAL_NO_CURRENT_RESULT = {
  ok: false,
  error: { code: 'no-current-goal', message: 'no current goal to mutate' },
} as const

/** Settled outcome of one goal mutation, rendered inline by the strip. */
export type GoalActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Native strip visibility: loading, absent, and complete goals have no
 * strip at all.
 * @param projection - the `goal` projection snapshot (undefined loading, null unset).
 */
export function goalStripVisible(projection: GoalProjectionView | null | undefined): boolean {
  const goal = projection?.goal
  return goal !== undefined && goal !== null && goal.phase !== 'complete'
}

/**
 * The current CAS ref, read at verb call time (native `refOf`): no
 * staleness fence, the RPC's CAS is the guard.
 * @param projection - the `goal` projection snapshot.
 */
export function goalRefOf(projection: GoalProjectionView | null | undefined): GoalRefView | undefined {
  const goal = projection?.goal
  if (goal === undefined || goal === null) return undefined
  return { id: goal.id, revision: goal.revision }
}

/**
 * The activation that counts for the projected goal: the edge must match
 * the exact goal identity and revision (native GoalDock's `useGoalActivation`
 * selector), anything else reads as unknown.
 * @param edge - the latest activation snapshot.
 * @param goal - the projected goal the strip renders.
 */
export function activationFor(
  edge: GoalActivationEdge,
  goal: GoalSnapshotView,
): GoalActivation | undefined {
  if (edge.id !== goal.id || edge.revision !== goal.revision) return undefined
  return edge.activation
}
