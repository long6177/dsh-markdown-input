/**
 * The stop view-model core (issue #32): when the takeover card offers Stop
 * and what the primary action names. The native bar's conditions are copied
 * line-for-line from the pinned rc.2 InputBar (ui-conversation
 * skeleton/InputBar.tsx): an ordinary running session keeps Stop while the
 * composer is empty or owner-blocked (`primaryStops`), and a continuable
 * child keeps Send primary and exposes Stop independently (`interruptible`)
 * — the two arms are mutually exclusive on the subagent address.
 *
 * The session snapshot's subagent field is wire data despite its typed face,
 * so an absent field reads through the native's normalization (`?? null`):
 * the ordinary-session reading, never a crash.
 */

/** The session snapshot's subagent address (the only field the math reads). */
export interface StopSubagent {
  readonly address: { readonly mode: string }
}

/** The conditions the native stop math reads off the card's planes. */
export interface StopConditions {
  /** The session snapshot's running flag; absent reads idle. */
  readonly running: boolean
  /** The session snapshot's subagent, null on an ordinary session. */
  readonly subagent: StopSubagent | null | undefined
  /** Draft empty: no text and no attachments (native `empty`). */
  readonly empty: boolean
  /** A composer block is raised (native `blocked !== undefined`). */
  readonly blocked: boolean
}

/**
 * Native `primaryStops`: the primary send action becomes stop while an
 * ordinary (unaddressed) session runs and the composer is empty or
 * owner-blocked; an actionable draft keeps the busy send gesture.
 * @param conditions - the card's running/address/empty/blocked reads.
 */
export function primaryStopsOf(conditions: StopConditions): boolean {
  const subagent = conditions.subagent ?? null
  return conditions.running && subagent === null && (conditions.empty || conditions.blocked)
}

/**
 * Native `interruptible`: the dedicated stop button's visibility — a running
 * session addressed to a continuable child (the only arm that keeps Send
 * primary while running).
 * @param conditions - the card's running/address reads.
 */
export function dedicatedStopOf(
  conditions: Pick<StopConditions, 'running' | 'subagent'>,
): boolean {
  return conditions.running && conditions.subagent?.address.mode === 'continuable'
}
