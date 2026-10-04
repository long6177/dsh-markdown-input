/**
 * The `feedbackUi` capability door of the `+` menu and the `/` completion
 * popup (issue #35): the host command catalog registers `feedback` as an
 * input-taking command (`dsh-command-feedback` carries `input`), which the
 * row assembly would read as a claim — the pick would insert the localized
 * `/反馈 ` token into the draft. That is not the native experience: the host's
 * `ui-message-feedback` plugin decorates the command with
 * `ui: { kind: 'action', run: session => feedbackUi.openSession(session.sessionId) }`
 * (packages/client/ui-message-feedback/src/client/index.ts:133-141), and the
 * host dispatch table tries contribution → decoration → input claim → bare
 * execute (ui-commands service.ts:251-275), so a menu pick (or a bare Enter)
 * hits the decoration first and opens the session feedback dialog with no
 * text inserted. A typed `/feedback <text>` line never consults the
 * decoration (matchEnter keeps the argued line on the claim path), so the
 * typed remark keeps submitting through the host claim pipeline.
 *
 * The service is read lazily per call, exactly like model-face.ts: it is
 * deliberately NOT a declared `inject` dependency of this plugin (a host
 * build without ui-message-feedback would hold the whole plugin pending),
 * and a missing service degrades the ONE feedback row back to its claim
 * shape — never a dead row, never a throw into the card. The service is
 * resolved off the client root context (`ctx.get('feedbackUi')`, the same
 * key the host plugin provides at index.ts:88), so the row upgrades whenever
 * the decoration owner has activated.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from './conversation-face.ts'

/**
 * The host `feedbackUi` service face, re-declared structurally (the host
 * declares the same shape on the cordis Context at ui-message-feedback
 * index.ts:42-54); this pins only the single verb the rows call.
 */
export interface FeedbackUiFace {
  /**
   * Open the Session's feedback draft without recording feedback.
   * @param sessionId - Session whose feedback draft to open.
   */
  openSession(sessionId: SessionId): void
}

/** The host service surfaces this face needs, resolved per call. */
export type FeedbackSource = () => FeedbackUiFace | undefined

let source: FeedbackSource = () => undefined

/**
 * Bind the feedback source (the client apply does this once; the thunk
 * resolves per call so boot order stays free — the service materializes when
 * its own plugin fiber activates, which may be after this plugin loads).
 * @param resolve - lazy resolver; `undefined` = service absent.
 */
export function setFeedbackSource(resolve: FeedbackSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). The single service read is its own capability check — a
 * host build without ui-message-feedback reads as absent, never a throw.
 * @param ctx - client root context.
 */
export function installFeedbackSource(ctx: ClientContext): void {
  setFeedbackSource(() => {
    try {
      const feedback = ctx.get('feedbackUi') as Partial<FeedbackUiFace> | undefined
      if (feedback === undefined || feedback === null || typeof feedback.openSession !== 'function') {
        return undefined
      }
      return feedback as FeedbackUiFace
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the feedback dialog face: is the host service present?
 * Pure — safe to call during render (the row assembly reads it per open, so
 * a decoration owner that activates later still upgrades the row).
 */
export function feedbackUiSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * Open the session feedback dialog through the host service — the
 * decoration's own `run` verb. A missing service is a silent no-op: the row
 * only reaches here when the assembly saw the service, and a service that
 * vanished between assembly and pick must not throw into the card.
 * @param sessionId - owning session; undefined leaves the call a no-op.
 */
export function openFeedbackSession(sessionId: SessionId | undefined): void {
  if (sessionId === undefined) return
  let feedback: FeedbackUiFace | undefined
  try {
    feedback = source()
  } catch {
    return
  }
  if (feedback === undefined) return
  try {
    feedback.openSession(sessionId)
  } catch (error: unknown) {
    console.error('[markdown-input] feedback dialog open failed', error)
  }
}

/**
 * Test seam: drop the source so a fresh test sees a fresh surface. Never call
 * in plugin code — the face is page-lifetime by design.
 */
export function resetFeedbackSource(): void {
  source = () => undefined
}
