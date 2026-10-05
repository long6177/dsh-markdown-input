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
 * What this module also owns since the alpha.12 feedback: the seat's copy
 * binding. The host `settings.agentPreset` dictionary carries the shipped
 * presets' display words AND the seat's three strings; the maintainer accepted
 * binding that namespace (the maintainer asked for the native menu shape, and
 * the shape IS the dictionary), so apply binds it read-only and the card
 * folds it through `resolveAgentPresetCopy` — host words first, the plugin's
 * `agentPreset.*` keys as the fallback for a build without the namespace.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { AgentPresetOption } from './agent-preset-core.ts'

/** The host namespace the preset seat's display copy lives in (ui-agent-preset's locale NS). */
export const AGENT_PRESET_NS = 'settings.agentPreset'

/** The bound host translate as the seat consumes it (untyped: the namespace is outside this build's merge table). */
export type AgentPresetLocaleTranslate = (key: string, params?: Record<string, unknown>) => string

let localeT: AgentPresetLocaleTranslate | undefined

/**
 * Bind the seat's translate seat (the client apply does this once, beside the
 * other dictionary bindings).
 * @param t - the `settings.agentPreset` namespace translate.
 */
export function setAgentPresetLocale(t: AgentPresetLocaleTranslate): void {
  localeT = t
}

/**
 * The seat's translate seat, or undefined before apply binds it — the card
 * then resolves the seat copy from the plugin's own keys and the roster rows
 * from their own metadata, exactly the pre-binding behavior.
 */
export function agentPresetLocale(): AgentPresetLocaleTranslate | undefined {
  return localeT
}

/**
 * Test seam: drop the binding so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetAgentPresetLocale(): void {
  localeT = undefined
}

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
