/**
 * Card-level degradation of the takeover card (ADR-0005 hardening #1, Q5):
 * when the card as a whole must go — a boundary-caught render crash or an
 * editor-face probe failure — `fallbackToNative` is the one path every
 * failure funnels into. It reports the cause on the console, latches the
 * takeover off for the rest of the page life (the session latch: no retry
 * within the session; reloading the browser half restarts the attempt),
 * fires the one-shot notice event the FallbackNotice dock renders, and
 * hands off to the fallback action the apply installed — disposing the
 * `conversation.composer` chain entry, whose collapse tops the native
 * composer back in with the machine draft intact.
 */

/** One card-level fallback, as delivered to the notice and diagnostics. */
export interface DegradeEvent {
  readonly reason: string
}

let latched = false
let pendingNotice: DegradeEvent | null = null
const listeners = new Set<(event: DegradeEvent) => void>()

/**
 * Latch the takeover off (once per page life; later calls keep the first
 * reason) and announce the fallback: the event goes to every live listener,
 * and — when no listener was mounted yet (the card crashed during the very
 * commit the notice dock mounts in) — stays pending for the dock's
 * mount-time catch-up via {@link takeDegradeNotice}.
 * @param reason - why the card fell back; surfaces on the console and the notice.
 */
export function degradeTakeover(reason: string): void {
  if (latched) return
  latched = true
  const event: DegradeEvent = { reason }
  pendingNotice = event
  const delivered = [...listeners]
  for (const listener of delivered) {
    try {
      listener(event)
    } catch (listenerError: unknown) {
      console.error('[markdown-input] degrade listener failed', listenerError)
    }
  }
  if (delivered.length > 0) pendingNotice = null
}

/** Whether the takeover has latched off for this page life. */
export function takeoverDegraded(): boolean {
  return latched
}

/**
 * Take the pending one-shot notice event, if any — the catch-up for a
 * notice dock that mounts after the fallback already fired. Consuming it
 * (like live delivery does) keeps the notice one-shot across remounts.
 */
export function takeDegradeNotice(): DegradeEvent | null {
  const notice = pendingNotice
  pendingNotice = null
  return notice
}

/**
 * Subscribe to card-level fallbacks (the one-shot notice dock does).
 * @returns the unsubscribe function.
 */
export function onTakeoverDegrade(listener: (event: DegradeEvent) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

let fallbackAction: ((error: unknown) => void) | undefined

/**
 * Install the card-fallback action (the plugin apply wires it to disposing
 * the composer chain entry). The latest installation wins; pass no handler
 * to clear.
 * @param handler - called for every card-level fallback with the causing error, if any.
 */
export function bindComposerCrash(handler: ((error: unknown) => void) | undefined): void {
  fallbackAction = handler
}

/**
 * The unified card-level fallback: report, latch, announce, dispose. The
 * latch is one-shot per page life — a later failure (a second crash while
 * the frames unwind, a re-elected card) is still reported but neither
 * re-announces nor re-disposes. A failing fallback action is contained —
 * degradation must never escalate.
 * @param reason - one-line cause, named for the surface that failed.
 * @param error - the caught error, when one exists.
 * @param componentStack - React component stack, from the boundary path.
 */
export function fallbackToNative(reason: string, error?: unknown, componentStack?: string): void {
  console.error(`[markdown-input] ${reason}; reverting to the native composer`, error, componentStack)
  if (latched) return
  degradeTakeover(reason)
  try {
    fallbackAction?.(error)
  } catch (handlerError: unknown) {
    console.error('[markdown-input] composer fallback action failed', handlerError)
  }
}

/**
 * Test seam: clear the page-lifetime latch. Never call in plugin code —
 * the latch is what keeps a degraded takeover from retrying.
 */
export function resetTakeoverDegradation(): void {
  latched = false
  pendingNotice = null
}
