/**
 * Data plane of the Agent-preset seat (issue #42, ADR-0006 option B): the
 * roster and switch verbs over the host `remote.agentPresets` namespace — the
 * preset registry's generated Remote API (`remoteExportList` answers `list()`,
 * and `select(sessionId, presetId)` is the composition switch,
 * `preset/agent-preset-registry/src/index.ts:170,318`).
 *
 * The namespace is consumed through a local structural type and resolved
 * lazily by the installer pattern every other face in this plugin uses
 * (`goal-face.ts`, `command-face.ts`): a host build without the agent-preset
 * registry degrades this face alone, and the namespace is deliberately NOT a
 * declared `inject` dependency — a missing service would hold the whole
 * plugin pending, taking the text face down with it.
 *
 * What this module deliberately does NOT own: the roster's display copy. The
 * native chip resolves a shipped preset's name and description through the
 * `settings.agentPreset` dictionary, which belongs to a package outside this
 * build's dependency graph; this seat shows the roster's own published
 * metadata (and the id, which is the host's own fallback) instead of guessing
 * host copy.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AgentPresetOption } from './agent-preset-core.ts'

/** One Remote failure as the generated client surfaces it. */
export interface AgentPresetRemoteError {
  readonly code: string
  readonly message: string
  /** Failure-specific details; a refusal's `reason` detail carries its cause. */
  readonly details?: unknown
}

/** Structural face of the host `remote.agentPresets` namespace service. */
export interface AgentPresetsRemoteFace {
  list(): Promise<
    | { readonly ok: true; readonly value: { readonly presets: readonly AgentPresetOption[] } }
    | { readonly ok: false; readonly error: AgentPresetRemoteError }
  >
  select(
    sessionId: string,
    presetId: string,
  ): Promise<
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly error: AgentPresetRemoteError }
  >
}

export type AgentPresetsSource = () => AgentPresetsRemoteFace | undefined

let source: AgentPresetsSource = () => undefined

/**
 * Bind the roster source (the client apply does this once; the thunk resolves
 * per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the namespace is absent.
 */
export function setAgentPresetsSource(resolve: AgentPresetsSource): void {
  source = resolve
}

/**
 * The roster verbs, or undefined while the namespace is absent. Read per call
 * (a render, a probe) so a service that materializes later is still found; a
 * throwing `ctx.get` reads as absent — a probe must never be the thing that
 * throws into the card.
 */
export function agentPresetsRemoteFace(): AgentPresetsRemoteFace | undefined {
  try {
    return source()
  } catch {
    return undefined
  }
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply). Both verbs are required for the face to be usable: a
 * namespace that can read the roster but not switch it would offer a menu
 * whose picks do nothing.
 * @param ctx - client root context.
 */
export function installAgentPresetsSource(ctx: ClientContext): void {
  setAgentPresetsSource(() => {
    try {
      const service = ctx.get('remote.agentPresets') as Partial<AgentPresetsRemoteFace> | undefined
      if (service === undefined
        || typeof service.list !== 'function'
        || typeof service.select !== 'function') return undefined
      return service as AgentPresetsRemoteFace
    } catch {
      return undefined
    }
  })
}

/**
 * Test seam: drop the source so a fresh test sees fresh surfaces. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetAgentPresetsSource(): void {
  source = () => undefined
}
