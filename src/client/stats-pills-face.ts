/**
 * Data plane of the takeover card's stats pills (issue #43, alpha.13 retest).
 *
 * Copy binding: the pill words are the HOST `chat` namespace's own keys
 * (`stats.counts`, `stats.cacheHit`, `message.tokensPerSecond`,
 * `message.turnUsage.count` — `ui-chat/src/client/locale.ts`, whose NS is
 * `chat`) plus the shared `number.thousand` / `number.million` templates the
 * namespace-bound lookup consults through the common vocabulary. apply binds
 * the namespace read-only — the same posture as the `conversation` binding
 * for the context meter, minus the hard dependency: the plugin's locales.ts
 * ships the host strings verbatim as fallbacks, so a build whose `chat`
 * dictionary misses a key still speaks the native words
 * (`resolveStatsCopy` in stats-pills-core.ts).
 *
 * Mode binding: the host's detailed/compact presentation setting
 * (`performanceUsage`, default `detailed`) is a `ConfigForm` section in the
 * `ui-chat` settings namespace (`ui-chat/src/chat-settings.ts:35-41`); the
 * native StatsPills receives it as a slot-injected hook
 * (`PerformanceUsageInjected`) that is unreachable outside the hidden
 * fallback bar. The setting itself IS reachable here: `configForms` is a
 * client-root service (ui-settings provides it; ui-chat declares it in its
 * own inject), so the same lazy `ctx.get` installer pattern every other face
 * uses resolves the `ui-chat` form and the pills read its snapshot — a host
 * build without the service degrades to the native default (detailed).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSource } from './conversation-face.ts'

/** The host namespace the pills' copy lives in (ui-chat's locale NS). */
export const STATS_NS = 'chat'

/** The settings namespace whose `performanceUsage` field the native pills follow. */
export const STATS_SETTINGS_NAMESPACE = 'ui-chat'

let localeT: TranslateNS<typeof STATS_NS> | undefined

/**
 * Bind the pills' translate seat (the client apply does this once, beside the
 * other namespace bindings). The `chat` namespace belongs to ui-chat, which
 * registers it as part of its own plugin body, so binding here is a read,
 * never a claim.
 * @param t - the `chat` namespace translate.
 */
export function setStatsLocale(t: TranslateNS<typeof STATS_NS>): void {
  localeT = t
}

/**
 * The pills' translate seat, or undefined before apply binds it — the card
 * then renders the plugin's own verbatim fallback copy
 * (`resolveStatsCopy`'s unbound arm), never raw keys.
 */
export function statsLocale(): TranslateNS<typeof STATS_NS> | undefined {
  return localeT
}

/**
 * Test seam: drop the binding so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetStatsLocale(): void {
  localeT = undefined
}

/**
 * Structural view of the `ui-chat` settings form snapshot — exactly the field
 * the pills read (the full snapshot carries status/revision/etc., a
 * structural superset).
 */
export interface StatsSettingsSnapshot {
  readonly value?: { readonly performanceUsage?: unknown } | undefined
}

/** The settings form as the face consumes it (a bare snapshot store). */
export type StatsSettingsStore = ObservableSource<StatsSettingsSnapshot>

export type StatsSettingsSource = () => StatsSettingsStore | undefined

let settingsSource: StatsSettingsSource = () => undefined

/**
 * Bind the settings source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the service is absent.
 */
export function setStatsSettingsSource(resolve: StatsSettingsSource): void {
  settingsSource = resolve
}

/**
 * The `ui-chat` settings form, or undefined while the configForms service is
 * absent — the pills then run the native default mode (detailed). Read per
 * call (a render) so a service that materializes later is still found; a
 * throwing `ctx.get` reads as absent — a render must never be the thing that
 * throws into the card.
 */
export function statsSettingsStore(): StatsSettingsStore | undefined {
  try {
    return settingsSource()
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
export function installStatsSettingsSource(ctx: ClientContext): void {
  setStatsSettingsSource(() => {
    const forms = ctx.get('configForms') as { get?(namespace: string): unknown } | undefined
    if (forms === undefined || forms === null || typeof forms.get !== 'function') return undefined
    const form = forms.get(STATS_SETTINGS_NAMESPACE) as
      | (StatsSettingsStore & Record<string, unknown>)
      | undefined
    if (form === undefined || form === null) return undefined
    if (typeof form.getSnapshot !== 'function' || typeof form.subscribe !== 'function') {
      return undefined
    }
    return form as StatsSettingsStore
  })
}

/**
 * Test seam: drop the source so a fresh test sees no settings service. Never
 * call in plugin code — the binding is page-lifetime by design.
 */
export function resetStatsSettingsSource(): void {
  settingsSource = () => undefined
}

/** The presentation modes the host setting accepts (`chat-settings.ts:35`). */
export type PerformanceUsageMode = 'compact' | 'detailed'

/** The host's preserved default for users without an explicit preference (`chat-settings.ts:41`). */
export const DEFAULT_PERFORMANCE_USAGE: PerformanceUsageMode = 'detailed'

/**
 * The presentation mode one settings snapshot selects: the accepted
 * `performanceUsage` value when it names compact, the native default
 * otherwise — including an absent service, a still-loading form, and a
 * malformed section (the host `PerformanceUsagePolicy` adopts exactly the
 * accepted value and keeps its default under everything else).
 * @param snapshot - the settings form snapshot, if the service is present.
 */
export function performanceUsageModeOf(
  snapshot: StatsSettingsSnapshot | undefined,
): PerformanceUsageMode {
  return snapshot?.value?.performanceUsage === 'compact' ? 'compact' : DEFAULT_PERFORMANCE_USAGE
}
