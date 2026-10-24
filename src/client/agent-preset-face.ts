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
import type { ObservableSource } from './conversation-face.ts'

/** The host namespace the preset seat's display copy lives in (ui-agent-preset's locale NS). */
export const AGENT_PRESET_NS = 'settings.agentPreset'

/**
 * The host settings namespace carrying the Developer-tools preference
 * (`ui-settings/src/developer-tools-settings.ts`): the form's `enabled`
 * field is the gate the native seat filters its menu by.
 */
export const DEVELOPER_TOOLS_NAMESPACE = 'ui-settings'

/**
 * The host settings namespace whose roster document the seat follows
 * (`settings-store.ts:17`, the native `AGENT_PRESET_SETTINGS_NS`): a
 * `settings/document-updated` for THIS namespace (and only this one) is a
 * roster change worth a re-read.
 */
export const AGENT_PRESET_SETTINGS_NS = 'agent-preset-registry'

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

/**
 * Structural view of the Developer-tools form snapshot — exactly the field
 * the native gate reads (`ui-settings/src/client/developer-tools.ts:16`).
 */
export interface DeveloperToolsSnapshot {
  readonly value?: { readonly enabled?: boolean } | undefined
}

/** The Developer-tools form as the face consumes it (a bare snapshot store). */
export type DeveloperToolsStore = ObservableSource<DeveloperToolsSnapshot>

/**
 * The Developer-tools preference one snapshot selects, the native observable
 * face's own reading (`developer-tools.ts:16`): `value?.enabled ?? false` —
 * a form whose document has not landed yet reads OFF, exactly as the native
 * seat sees it. An absent store reads the same way, so a host build without
 * the settings service keeps the gate closed (the tool presets stay hidden
 * unless the host can confirm they are wanted).
 * @param snapshot - the form snapshot, if the service is present.
 */
export function developerToolsEnabledOf(snapshot: DeveloperToolsSnapshot | undefined): boolean {
  return snapshot?.value?.enabled ?? false
}

export type DeveloperToolsSource = () => DeveloperToolsStore | undefined

let developerToolsSource: DeveloperToolsSource = () => undefined

/**
 * Bind the Developer-tools source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the service is absent.
 */
export function setDeveloperToolsSource(resolve: DeveloperToolsSource): void {
  developerToolsSource = resolve
}

/**
 * The `ui-settings` form, or undefined while the configForms service is
 * absent — the seat then runs the gate closed (see
 * {@link developerToolsEnabledOf}). Read per call (a render) so a service
 * that materializes later is still found; a throwing `ctx.get` reads as
 * absent — a render must never be the thing that throws into the card.
 */
export function developerToolsStore(): DeveloperToolsStore | undefined {
  try {
    return developerToolsSource()
  } catch {
    return undefined
  }
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply). The form is capability-detected, the `installStatsSettingsSource`
 * idiom one namespace over: a service without the `get` face, or a form
 * without the snapshot-store face, reads as absent.
 * @param ctx - client root context.
 */
export function installDeveloperToolsSource(ctx: ClientContext): void {
  setDeveloperToolsSource(() => {
    const forms = ctx.get('configForms') as { get?(namespace: string): unknown } | undefined
    if (forms === undefined || forms === null || typeof forms.get !== 'function') return undefined
    const form = forms.get(DEVELOPER_TOOLS_NAMESPACE) as
      | (DeveloperToolsStore & Record<string, unknown>)
      | undefined
    if (form === undefined || form === null) return undefined
    if (typeof form.getSnapshot !== 'function' || typeof form.subscribe !== 'function') {
      return undefined
    }
    return form as DeveloperToolsStore
  })
}

/**
 * Test seam: drop the source so a fresh test sees no settings service. Never
 * call in plugin code — the binding is page-lifetime by design.
 */
export function resetDeveloperToolsSource(): void {
  developerToolsSource = () => undefined
}
