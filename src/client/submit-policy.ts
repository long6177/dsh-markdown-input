/**
 * The submission policy (issue #79): how the takeover card resolves submit
 * gestures into delivery modes. The native bar reads the user's busy-Enter
 * preference (`ui-conversation.busyEnter`), the session's busy and
 * steerability signals, and resolves plain Enter, the Send button, and the
 * Cmd/Ctrl+Enter chord through one formula (`resolveSubmitMode`,
 * ui-conversation submission-policy.ts). The takeover card rode the
 * queue-only public face so far — the preference and the accelerated
 * gesture were silently ignored; this module is the decision layer that
 * restores them.
 *
 * Every signal here is a real wire field: the preference rides the
 * `configForms` service's `ui-conversation` form (the stats-pills settings
 * precedent), and the session signals ride the Session snapshot's
 * `running`/`subagent` fields with the stop-core normalization (`?? null`).
 * A missing face or a malformed field degrades to the native default
 * (queue), which is the exact behavior the card had before this module.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ObservableSource } from './conversation-face.ts'

/** Delivery mode for one composer message (the wire's InputSubmitMode). */
export type SubmitMode = 'queue' | 'steer'

/** Busy-Enter behaviors accepted at the settings boundary. */
export type BusyEnterBehavior = SubmitMode

/** Native default preserves Enter-as-Queue (`DEFAULT_BUSY_ENTER_BEHAVIOR`). */
export const DEFAULT_BUSY_ENTER: BusyEnterBehavior = 'queue'

/** The submit gestures: plain Enter (and the Send button) or the accelerated chord. */
export type SubmitGesture = 'enter' | 'accelerated'

/** The input machine's phases (the wire's InputState.phase). */
export type InputPhase = 'plain' | 'adjudicating' | 'claimed' | 'submitting'

/** The session snapshot's subagent address (the only field the math reads). */
export interface PolicySubagent {
  readonly address: { readonly mode: string }
}

/**
 * Resolve one submission gesture against the busy-Enter preference (the
 * upstream formula, submission-policy.ts:30-39). Plain Enter and the
 * primary Send button share the `enter` gesture, so the button delivers
 * exactly what Enter would; the accelerated chord takes the opposite of
 * the preference.
 * @param preferred - the live busy-Enter preference.
 * @param running - whether the addressed session reports busy.
 * @param gesture - plain Enter (or the Send button) or the accelerated chord.
 * @param steeringAvailable - whether this session's transport supports steering.
 */
export function resolveSubmitMode(
  preferred: BusyEnterBehavior,
  running: boolean,
  gesture: SubmitGesture,
  steeringAvailable: boolean,
): SubmitMode {
  if (!running || !steeringAvailable) return 'queue'
  if (gesture === 'enter') return preferred
  return preferred === 'queue' ? 'steer' : 'queue'
}

/**
 * Whether the session transport supports steering (the native
 * `steeringAvailable` read): an unaddressed session or a continuable child.
 * The subagent field is wire data despite its typed face — an absent field
 * reads through the native normalization (`?? null`, the stop-core
 * convention): the ordinary-session reading.
 * @param subagent - the session snapshot's subagent, null when unaddressed.
 */
export function steeringAvailableOf(subagent: PolicySubagent | null | undefined): boolean {
  const normalized = subagent ?? null
  return normalized === null || normalized.address.mode === 'continuable'
}

/** The settings form snapshot as the policy consumes it (structural subset). */
export interface BusyEnterSnapshot {
  readonly value?: { readonly busyEnter?: unknown } | undefined
}

/** The settings form as the face consumes it (a bare snapshot store). */
export type BusyEnterStore = ObservableSource<BusyEnterSnapshot>

/** The settings namespace whose `busyEnter` field the native bar follows. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/**
 * The busy-Enter preference one settings snapshot selects: the accepted
 * wire value when it names steer, the native default otherwise — including
 * an absent service, a still-loading form, and a malformed section.
 * @param snapshot - the settings form snapshot, if the service is present.
 */
export function busyEnterOf(snapshot: BusyEnterSnapshot | undefined): BusyEnterBehavior {
  return snapshot?.value?.busyEnter === 'steer' ? 'steer' : DEFAULT_BUSY_ENTER
}

export type BusyEnterSource = () => BusyEnterStore | undefined

let busyEnterSource: BusyEnterSource = () => undefined

/**
 * Bind the busy-Enter settings source (the client apply does this once; the
 * thunk resolves per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the service is absent.
 */
export function setBusyEnterSource(resolve: BusyEnterSource): void {
  busyEnterSource = resolve
}

/**
 * The `ui-conversation` settings form, or undefined while the configForms
 * service is absent — the card then runs the native default (queue). Read
 * per call (a render) so a service that materializes later is still found;
 * a throwing `ctx.get` reads as absent — a render must never be the thing
 * that throws into the card.
 */
export function busyEnterStore(): BusyEnterStore | undefined {
  try {
    return busyEnterSource()
  } catch {
    return undefined
  }
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply). The form is capability-detected: a service without the
 * `get` face, or a form without the snapshot-store face, reads as absent.
 * @param ctx - client root context.
 */
export function installBusyEnterSource(ctx: ClientContext): void {
  setBusyEnterSource(() => {
    const forms = ctx.get('configForms') as { get?(namespace: string): unknown } | undefined
    if (forms === undefined || forms === null || typeof forms.get !== 'function') return undefined
    const form = forms.get(CONVERSATION_SETTINGS_NAMESPACE) as
      | (BusyEnterStore & Record<string, unknown>)
      | undefined
    if (form === undefined || form === null) return undefined
    if (typeof form.getSnapshot !== 'function' || typeof form.subscribe !== 'function') {
      return undefined
    }
    return form as BusyEnterStore
  })
}

/**
 * Test seam: drop the source so a fresh test sees no settings service. Never
 * call in plugin code — the binding is page-lifetime by design.
 */
export function resetBusyEnterSource(): void {
  busyEnterSource = () => undefined
}

/** The gate inputs the whole-queue steer reads (all real signals). */
export interface SteerQueueGate {
  /** A session id exists (session-scoped steering is addressable at all). */
  readonly sessionBound: boolean
  /** The input machine phase; busy admission phases close the gate. */
  readonly phase: InputPhase
  /** Draft empty: no text and no attachments. */
  readonly draftEmpty: boolean
  /** The session snapshot's running flag. */
  readonly running: boolean
  /** steeringAvailableOf(session.subagent). */
  readonly steeringAvailable: boolean
  /** The `+` command menu is open (the native `!commandMenuOpen` arm). */
  readonly menuOpen: boolean
  /** At least one queued row is durably placed (`placement === 'queued'`). */
  readonly hasQueuedRows: boolean
}

/**
 * The native `canSteerQueue` gate for the whole-queue steer gesture — the
 * same formula the runtime placeholder reads, so the hint never promises a
 * gesture the chord would refuse (issue #79 AC3/AC4). The queued-row arm
 * tests the wire's own `placement` field (queue-core's documented line
 * field), a deliberate refinement over the native `queue.length > 0`.
 * @param gate - the card's live signals.
 */
export function canSteerQueueOf(gate: SteerQueueGate): boolean {
  return gate.sessionBound
    && gate.phase !== 'adjudicating' && gate.phase !== 'submitting'
    && gate.draftEmpty
    && gate.running
    && gate.steeringAvailable
    && !gate.menuOpen
    && gate.hasQueuedRows
}

/** The submit label the primary seat's copy resolves to. */
export type SubmitLabelKey = 'stop' | 'send.queue' | 'send.steer' | 'send'

/**
 * The primary seat's label decision (the native InputBar's `primaryLabel`
 * formula): stop while the stop arm holds; otherwise the resolved mode's
 * name — but only when the click would really deliver a plain message
 * right now (enabled, over a plain non-command draft on a running steerable
 * session); every other state keeps plain send.
 * @param conditions - the card's live label inputs.
 */
export function primarySubmitLabelOf(conditions: {
  readonly primaryStops: boolean
  readonly running: boolean
  readonly steeringAvailable: boolean
  readonly enabled: boolean
  readonly plainMessageDraft: boolean
  readonly submitMode: SubmitMode
}): SubmitLabelKey {
  if (conditions.primaryStops) return 'stop'
  if (conditions.running && conditions.steeringAvailable && conditions.enabled
    && conditions.plainMessageDraft) {
    return conditions.submitMode === 'steer' ? 'send.steer' : 'send.queue'
  }
  return 'send'
}
