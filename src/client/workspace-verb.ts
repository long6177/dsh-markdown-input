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
/**
 * Narrow face of the host `uiWorkspace` service: the New Session verbs.
 *
 * `startSession` is the void form the ticket's first cut shipped (the
 * upstream `navigation.ts:88` contract — its failures are its own, console +
 * the host notice). `openWorkspace` (#78) is the rejectable form the native
 * hero's `selectWorkspace` wraps (`navigation.ts:280-286`, "@throws on
 * failure"): the pick awaits it and rolls the pending label back when it
 * refuses. The card prefers the rejectable verb whenever the host exposes
 * it and falls back to the void one otherwise.
 */
export interface UiWorkspaceVerbFace {
  /** Connect and open a blank Session in the selected Workspace, reusing one when it exists. */
  startSession(workspaceId?: string): void
  /**
   * Open the named Workspace (creating its blank Session when needed),
   * rejecting on failure — the native pick's own verb
   * (`ui-workspace/src/client/navigation.ts:55`).
   */
  openWorkspace?(workspaceId: string): Promise<void>
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
      if (service === undefined || typeof service.startSession !== 'function') return undefined
      // The rejectable verb rides along whenever the host exposes it (#78),
      // wrapped so the host object itself is never touched; a build without
      // it keeps the service verbatim and the pick loses the rollback arm,
      // never the pick itself.
      const { startSession, openWorkspace } = service
      if (openWorkspace === undefined) return service as UiWorkspaceVerbFace
      return {
        startSession: (workspaceId?: string) => startSession.call(service, workspaceId),
        openWorkspace: (workspaceId: string) => openWorkspace.call(service, workspaceId),
      }
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
