/**
 * The workspace row's verb plane (issue #42, ADR-0006 option B): the pick's
 * "reuse-or-create the blank Session in this Workspace and switch to it"
 * action, read off the host `uiWorkspace` service.
 *
 * The native hero's pick goes through `ConversationInjected.selectWorkspace`,
 * which is a factory-owned inject face this plugin cannot receive (it belongs
 * to ui-conversation's own `conversation.content` registration). The same
 * navigation is publicly available on the service it wraps: `startSession`
 * ("Connect and open a blank Session in the selected Workspace",
 * `ui-workspace/src/client/navigation.ts:63`) — `openWorkspace` →
 * `connectWorkspace` → `reuseOrCreateBlank` → `replaceMain`, which is exactly
 * the ticket's reuse-or-create verb. Our card IS the blank Session being
 * moved, so no draft-transfer plumbing is needed (that is `selectWorkspace`'s
 * job for a NON-blank session with a draft to carry).
 *
 * Resolution is the installer pattern every other face in this plugin uses
 * (`goal-face.ts`, `command-face.ts`): the client apply hands in a lazy thunk
 * resolving the service per call, so boot order stays free and a host build
 * without ui-workspace degrades this row alone. It is deliberately NOT a
 * declared `inject` dependency of the plugin: a missing service would hold
 * the whole plugin pending, taking the text face down with it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
/** Narrow face of the host `uiWorkspace` service: the New Session verb. */
export interface UiWorkspaceVerbFace {
  /** Connect and open a blank Session in the selected Workspace, reusing one when it exists. */
  startSession(workspaceId?: string): void
}

export type UiWorkspaceVerbSource = () => UiWorkspaceVerbFace | undefined

let source: UiWorkspaceVerbSource = () => undefined

/**
 * Bind the verb source (the client apply does this once; the thunk resolves
 * per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the host service is absent.
 */
export function setWorkspaceVerbSource(resolve: UiWorkspaceVerbSource): void {
  source = resolve
}

/**
 * The verb, or undefined while the host service is absent. Read per call (a
 * render, a probe) so a service that materializes later is still found; a
 * throwing `ctx.get` (sealed globals, exotic host builds) reads as absent —
 * a row probe must never be the thing that throws into the card.
 */
export function workspaceVerbFace(): UiWorkspaceVerbFace | undefined {
  try {
    return source()
  } catch {
    return undefined
  }
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply), the same lazy door the goal and command faces use. The
 * namespace resolves by its traced dotted service key.
 * @param ctx - client root context.
 */
export function installWorkspaceVerbSource(ctx: ClientContext): void {
  setWorkspaceVerbSource(() => {
    try {
      const service = ctx.get('uiWorkspace') as Partial<UiWorkspaceVerbFace> | undefined
      return typeof service?.startSession === 'function' ? service as UiWorkspaceVerbFace : undefined
    } catch {
      return undefined
    }
  })
}

/**
 * Test seam: drop the source so a fresh test sees fresh surfaces. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetWorkspaceVerbSource(): void {
  source = () => undefined
}
