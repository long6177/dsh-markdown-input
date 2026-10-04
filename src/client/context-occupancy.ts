/**
 * Pure core of the ContextMeter occupant (issue #43), vendored from the host
 * `ui-conversation/src/client/context-occupancy.ts` (0.2.0-rc.2) with the
 * compact-number formatter the meter's panel uses pulled in beside it.
 *
 * The host's token-meter projection keys (`contextPressure`,
 * `contextBreakdown`) are NOT part of this plugin's dependency graph — the
 * `dsh-token-meter` client types are not in the installed host roster, the
 * same posture the `plan`/`todos` rebuilds took. The projection values are
 * therefore read STRUCTURALLY: the two views below pin exactly the fields the
 * meter consumes, and a host build that ships more of the projection stays
 * readable without a type dependency.
 *
 * The function is deliberately total and null-returning: `contextOccupancy`
 * answers null until both the numerator and the route capacity are known, and
 * the meter renders NOTHING then (native parity — no dead seat while a
 * provider has not reported pressure).
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Structural view of the host `contextPressure` projection (the token-meter
 * merge key's value).
 */
export interface ContextPressureView {
  /** Used tokens, provider-anchored, without the pending surface delta. */
  readonly pressureTokens?: number | undefined
  /** Used tokens including the heuristically repriced pending surface delta. */
  readonly projectedTokens?: number | undefined
  /** The route's context capacity; absent until a provider reports one. */
  readonly contextWindow?: number | undefined
}

/**
 * Structural view of the host `contextBreakdown` projection: the heuristic
 * composition of the used context, in tokens.
 */
export interface ContextBreakdownView {
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly messageTokens: number
}

/** Context usage rendered by the dock meter, mirroring the host interface. */
export interface ContextOccupancy {
  /** Rounded usage, clamped to 100. */
  readonly percent: number
  /** The used count the percent was derived from (projected over pressure). */
  readonly usedTokens: number
  /** The route capacity the percent was derived against. */
  readonly contextWindow: number
}

/**
 * Resolve bounded display occupancy from independently updated pressure
 * fields (host `context-occupancy.ts` verbatim). Null and undefined are both
 * accepted: the host renders `null` for an unresolved projection and the
 * renderer hands `undefined` for a key the host never contributed.
 * @param pressure - latest token-meter projection.
 * @returns occupancy, or null until numerator and capacity are known.
 */
export function contextOccupancy(
  pressure: ContextPressureView | null | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/**
 * The host `conversation` namespace keys the meter reads, spelled out: the
 * copy of the ring/panel (`context.*`) and the shared compact-number
 * templates (`number.*`). This plugin registers nothing and invents nothing,
 * it only renders these keys through the seat apply binds. Provenance on the
 * host side: ui-conversation ships `context.*`
 * (`ui-conversation/src/client/locales.ts`), and the locale plugin ships
 * `number.*` in the shared `common` vocabulary
 * (`locale/src/locales/{zh,en}.ts`) that a namespace-bound translate consults
 * after its own dictionary misses — both zh and en.
 */
export type ContextMeterKey =
  | 'context.aria'
  | 'context.used'
  | 'context.system'
  | 'context.tools'
  | 'context.messages'
  | 'number.thousand'
  | 'number.million'

/**
 * The `conversation` namespace translate seat, narrowed to the keys above —
 * the exact type of the host seat's translate function over that key union,
 * so binding the host's `TranslateNS<'conversation'>` needs no cast and a
 * typo in a key is a compile error.
 */
export type ContextTranslate = Translate<ContextMeterKey>

/**
 * Format a token count for the compact context panel (host ContextMeter.tsx
 * `formatTokens` verbatim): unscaled below 1000, one decimal under 100, whole
 * numbers above, through the localized K/M templates.
 * @param value - token count.
 * @param t - the `conversation` namespace translate seat.
 * @returns compact localized count using K or M when needed.
 */
export function formatTokens(value: number, t: ContextTranslate): string {
  const scaled = (candidate: number): string => candidate >= 100
    ? String(Math.round(candidate))
    : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}
