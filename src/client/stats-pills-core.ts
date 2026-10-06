/**
 * Pure core of the takeover card's stats pills (issue #43, alpha.13 retest):
 * the figures the native StatsPills shows in the composer dock row — the
 * session counts pill (`7 轮 160 步 · 247 tok/s`) and the token-usage pill
 * (`22.5M tok · 缓存命中 99%`) — vendored from the host algorithms so the
 * takeover card's rebuild reads exactly what the native pills read.
 *
 * The native component is `ui-chat/src/client/chat/StatsPills.tsx` (0.2.0-rc.2),
 * the `conversation.composer.dock` slot's own order-0 occupant
 * (`ui-chat/src/client/apply.ts:284-288`). That slot is mounted only from
 * inside the host InputBar — the same structural gap the context meter fell
 * through (issue #43's first round) — so the takeover card renders the pills
 * itself, in the same row, BEFORE the meter (the native slot order 0 against
 * the meter's fixed sibling position after the slot).
 *
 * Data planes: the `sessionStats` projection (whole-log counts and wall
 * times, `session/session-stats/src/projection.ts:113-212`) and the
 * `tokenUsage` projection (the four durable billing buckets,
 * `llm/token-meter/src/usage-projection.ts:117-150`). Both are read
 * STRUCTURALLY — the host client type merges are outside this build's
 * dependency graph (the `contextPressure` precedent, context-occupancy.ts).
 * The native component's window-scoped fallback fold (`deriveStats` over the
 * chat snapshot's settled nodes) has no counterpart here: the takeover card
 * holds no chat-snapshot seat, so a host build without the `sessionStats`
 * projection hides the counts pill whole (the face-degrade rule).
 *
 * The copy goes through a resolved-template record (see stats-pills-face.ts):
 * the host `chat` namespace's own keys when it answers, the plugin's
 * verbatim-copy fallbacks otherwise, so every interpolator here is the plain
 * `{name}` fill.
 *
 * Issue #43's third round (alpha.14 retest) adds the detailed dialogs' pure
 * side: the duration formatter and the exact grouped token count the two
 * dialogs render, the TTFT mean, and the gate that demotes the counts pill to
 * its static span when no row could fill the dialog (host
 * `StatsPills.tsx:91-99`, `:130-132` + `token-format.ts:23-30`, `:160-171`).
 */

/**
 * Structural view of the host `sessionStats` projection's wire view — exactly
 * the fields the pills consume (`session-stats/src/projection.ts:32-49`).
 */
export interface SessionStatsView {
  /** Distinct turns with at least one closed step. */
  readonly turns: number
  /** Closed steps so far. */
  readonly steps: number
  /** Summed model wall time over message-assembling steps, ms. */
  readonly llmMs: number
  /** Summed matched tool call→result wall time, ms. */
  readonly toolMs: number
  /** Summed first-token latency over `ttftSteps`, ms. */
  readonly ttftMs: number
  /** Steps carrying a recorded first token. */
  readonly ttftSteps: number
  /** Summed decode wall time over usage-reporting steps, ms. */
  readonly decodeMs: number
  /** Summed provider output tokens over the same steps. */
  readonly decodeTokens: number
}

/**
 * Structural view of the host `tokenUsage` projection's wire view — the four
 * disjoint durable billing buckets (`usage-projection.ts:29-34`).
 */
export interface TokenUsageView {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/**
 * The host `chat` namespace keys the pills and their dialogs read, spelled
 * out: the pill copy (`stats.*`, `message.tokensPerSecond`,
 * `message.turnUsage.count` — `ui-chat/src/client/locale.ts:77-78,171,181` zh
 * / :270-271,364,374 en), the dialog copy (`stats.dialog.*`,
 * `message.turnUsage.*` — :79-84,175-179 zh / :272-277,368-372 en), the
 * duration templates (`duration.compactSeconds` / `duration.compactMinutes`,
 * :74-75 zh / :267-268 en) and the shared compact-number / grouping templates
 * (`number.*`, the locale plugin's common vocabulary a namespace-bound lookup
 * consults after its own miss).
 */
export type StatsHostKey =
  | 'stats.counts'
  | 'stats.cacheHit'
  | 'stats.dialog.title'
  | 'stats.dialog.usageTitle'
  | 'stats.dialog.llmTime'
  | 'stats.dialog.toolTime'
  | 'stats.dialog.ttft'
  | 'stats.dialog.speed'
  | 'message.tokensPerSecond'
  | 'message.turnUsage.count'
  | 'message.turnUsage.cacheHit'
  | 'message.turnUsage.input'
  | 'message.turnUsage.cacheRead'
  | 'message.turnUsage.cacheWrite'
  | 'message.turnUsage.output'
  | 'duration.compactSeconds'
  | 'duration.compactMinutes'
  | 'number.thousand'
  | 'number.million'
  | 'number.groupSeparator'

/**
 * The pill and dialog copy as the faces render it: each entry the RESOLVED
 * `{name}` template (host answer or plugin fallback — see `resolveStatsCopy`).
 */
export interface StatsPillsCopy {
  /** `stats.counts`: the counts pill's turns/steps reading. */
  readonly counts: string
  /** `stats.cacheHit`: the usage pill's cache-hit reading. */
  readonly cacheHit: string
  /** `stats.dialog.title`: the session-stat dialog's heading. */
  readonly dialogTitle: string
  /** `stats.dialog.usageTitle`: the token-usage dialog's heading. */
  readonly dialogUsageTitle: string
  /** `stats.dialog.llmTime`: the model-time row label. */
  readonly dialogLlmTime: string
  /** `stats.dialog.toolTime`: the tool-time row label. */
  readonly dialogToolTime: string
  /** `stats.dialog.ttft`: the TTFT row label. */
  readonly dialogTtft: string
  /** `stats.dialog.speed`: the output-speed row label. */
  readonly dialogSpeed: string
  /** `message.tokensPerSecond`: the decode-throughput reading. */
  readonly tokensPerSecond: string
  /** `message.turnUsage.count`: the compact total-tokens reading and the exact-count wrapper. */
  readonly turnUsageCount: string
  /** `message.turnUsage.cacheHit`: the usage dialog's cache-hit row label. */
  readonly turnUsageCacheHit: string
  /** `message.turnUsage.input`: the usage dialog's uncached-input row label. */
  readonly turnUsageInput: string
  /** `message.turnUsage.cacheRead`: the usage dialog's cache-read row label. */
  readonly turnUsageCacheRead: string
  /** `message.turnUsage.cacheWrite`: the usage dialog's cache-write row label. */
  readonly turnUsageCacheWrite: string
  /** `message.turnUsage.output`: the usage dialog's output row label. */
  readonly turnUsageOutput: string
  /** `duration.compactSeconds`: the sub-minute duration template. */
  readonly compactSeconds: string
  /** `duration.compactMinutes`: the minute-plus duration template. */
  readonly compactMinutes: string
  /** `number.thousand`: the K-scaled compact template. */
  readonly thousand: string
  /** `number.million`: the M-scaled compact template. */
  readonly million: string
  /** `number.groupSeparator`: the exact-count digit grouping separator. */
  readonly groupSeparator: string
}

/**
 * The host seat the fold reads, narrowed to the six keys. The bind delivers a
 * namespace translate that answers a params-less call with the raw template
 * (`locale/src/client/index.ts:470` — `if (!params) return template`) and a
 * miss with the echoed key, which is what the fold compares against.
 */
export type StatsHostTranslate = (
  key: StatsHostKey,
  params?: Record<string, unknown>,
) => string

/**
 * Fill one resolved `{name}` template. The locale service's own interpolation
 * (`locale/src/client/index.ts:471-473`): a placeholder with no param stays
 * as written.
 * @param template - the resolved template.
 * @param params - substitution values, stringified.
 * @returns the display string.
 */
export function fillTemplate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/**
 * Resolve the pill copy: host words first, the plugin's verbatim-copy
 * fallbacks when the host namespace misses (a build whose `chat` dictionary
 * no longer carries the keys — the bound translate echoes the raw key, the
 * locale service's `?? key` tail) or was never bound. The plugin's fallback
 * strings are the host's own zh/en dictionary lines copied verbatim
 * (locales.ts), so a fallback render reads exactly the native words.
 * @param hostT - the bound `chat` namespace translate; undefined = not bound.
 * @param own - the plugin's fallback templates.
 * @returns the six resolved templates.
 */
export function resolveStatsCopy(
  hostT: StatsHostTranslate | undefined,
  own: StatsPillsCopy,
): StatsPillsCopy {
  if (hostT === undefined) return own
  const read = (key: StatsHostKey): string => {
    const value = hostT(key)
    return value === key ? own[keyToCopy(key)] : value
  }
  return {
    counts: read('stats.counts'),
    cacheHit: read('stats.cacheHit'),
    dialogTitle: read('stats.dialog.title'),
    dialogUsageTitle: read('stats.dialog.usageTitle'),
    dialogLlmTime: read('stats.dialog.llmTime'),
    dialogToolTime: read('stats.dialog.toolTime'),
    dialogTtft: read('stats.dialog.ttft'),
    dialogSpeed: read('stats.dialog.speed'),
    tokensPerSecond: read('message.tokensPerSecond'),
    turnUsageCount: read('message.turnUsage.count'),
    turnUsageCacheHit: read('message.turnUsage.cacheHit'),
    turnUsageInput: read('message.turnUsage.input'),
    turnUsageCacheRead: read('message.turnUsage.cacheRead'),
    turnUsageCacheWrite: read('message.turnUsage.cacheWrite'),
    turnUsageOutput: read('message.turnUsage.output'),
    compactSeconds: read('duration.compactSeconds'),
    compactMinutes: read('duration.compactMinutes'),
    thousand: read('number.thousand'),
    million: read('number.million'),
    groupSeparator: read('number.groupSeparator'),
  }
}

/** Copy record key of one host key (the two unions are key-by-key parallel). */
function keyToCopy(key: StatsHostKey): keyof StatsPillsCopy {
  switch (key) {
    case 'stats.counts': return 'counts'
    case 'stats.cacheHit': return 'cacheHit'
    case 'stats.dialog.title': return 'dialogTitle'
    case 'stats.dialog.usageTitle': return 'dialogUsageTitle'
    case 'stats.dialog.llmTime': return 'dialogLlmTime'
    case 'stats.dialog.toolTime': return 'dialogToolTime'
    case 'stats.dialog.ttft': return 'dialogTtft'
    case 'stats.dialog.speed': return 'dialogSpeed'
    case 'message.tokensPerSecond': return 'tokensPerSecond'
    case 'message.turnUsage.count': return 'turnUsageCount'
    case 'message.turnUsage.cacheHit': return 'turnUsageCacheHit'
    case 'message.turnUsage.input': return 'turnUsageInput'
    case 'message.turnUsage.cacheRead': return 'turnUsageCacheRead'
    case 'message.turnUsage.cacheWrite': return 'turnUsageCacheWrite'
    case 'message.turnUsage.output': return 'turnUsageOutput'
    case 'duration.compactSeconds': return 'compactSeconds'
    case 'duration.compactMinutes': return 'compactMinutes'
    case 'number.thousand': return 'thousand'
    case 'number.million': return 'million'
    case 'number.groupSeparator': return 'groupSeparator'
  }
}

/** The compact-number templates as `formatTokens` consumes them. */
export interface CompactNumberTemplates {
  readonly thousand: string
  readonly million: string
}

/**
 * Decode-throughput figure: whole tokens from ten up, one decimal below
 * (host `message-chrome.ts:71-74` verbatim).
 * @param tps - Tokens per second.
 * @returns Display number without unit.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Sum the three disjoint prompt-side billing buckets (host StatsPills.tsx:
 * 118-120 verbatim): everything a request can bill on input, output excluded.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageView): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Round a cache-read ratio to exact percentage units, with positive ties rounded up (host `token-format.ts:33-50` verbatim). */
function roundedPercentUnits(cacheReadTokens: number, denominator: number, decimalPlaces: 0 | 1): number {
  const unitsPerPercent = decimalPlaces === 0 ? 1 : 10
  const scale = unitsPerPercent * 100
  const doubledScale = scale * 2
  const denominatorQuotient = Math.floor(denominator / doubledScale)
  const denominatorRemainder = denominator % doubledScale
  let lower = 0
  let upper = scale
  while (lower < upper) {
    const candidate = Math.floor((lower + upper + 1) / 2)
    const factor = candidate * 2 - 1
    const threshold = factor * denominatorQuotient
      + Math.ceil(factor * denominatorRemainder / doubledScale)
    if (cacheReadTokens >= threshold) lower = candidate
    else upper = candidate - 1
  }
  return lower
}

function displayPercentUnits(units: number, decimalPlaces: 0 | 1): string {
  if (decimalPlaces === 0) return String(units)
  const whole = Math.floor(units / 10)
  const tenths = units % 10
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`
}

/**
 * Display-ready cache-hit share without rounding a partial hit to 100%
 * (host `token-format.ts:67-98` verbatim). A partial hit that would round to
 * 100 automatically spends enough extra precision to stay honest.
 * @param cacheReadTokens - exact prompt tokens served from cache.
 * @param promptTokens - exact aggregate prompt tokens.
 * @param decimalPlaces - ordinary-ratio precision.
 * @returns percentage text, or null when there was no prompt input.
 */
export function formatCacheHitPercent(
  cacheReadTokens: number,
  promptTokens: number,
  decimalPlaces: 0 | 1 = 0,
): string | null {
  if (promptTokens === 0) return null
  const missedInputTokens = promptTokens - cacheReadTokens
  if (missedInputTokens === 0) return '100'

  const roundedUnits = roundedPercentUnits(cacheReadTokens, promptTokens, decimalPlaces)
  const fullHitUnits = decimalPlaces === 0 ? 100 : 1_000
  if (roundedUnits < fullHitUnits) return displayPercentUnits(roundedUnits, decimalPlaces)

  let distinguishingPlaces = 1
  let scaledDoubleGap = missedInputTokens * 200
  const denominatorTens = Math.floor(promptTokens / 10)
  while (scaledDoubleGap <= denominatorTens) {
    scaledDoubleGap *= 10
    distinguishingPlaces += 1
  }
  const denominatorOnes = promptTokens % 10
  let roundedLoss = 5
  for (let loss = 1; loss < 5; loss += 1) {
    const factor = loss * 2 + 1
    const threshold = factor * denominatorTens + Math.floor(factor * denominatorOnes / 10)
    if (scaledDoubleGap <= threshold) {
      roundedLoss = loss
      break
    }
  }
  return `99.${'9'.repeat(distinguishingPlaces - 1)}${10 - roundedLoss}`
}

/**
 * Display-ready cache-hit share of prompt-side input over the whole durable
 * log (host StatsPills.tsx:108-111 verbatim).
 * @param usage - the session's token-usage projection value.
 * @returns integer text when integer rounding stays below 100, the honest
 * tail otherwise; null when there was no billed input.
 */
export function cacheHitPercent(usage: TokenUsageView): string | null {
  const denominator = billedInputTokens(usage)
  return formatCacheHitPercent(usage.cacheReadTokens, denominator)
}

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (host `token-format.ts:9-15`
 * verbatim), through the resolved templates.
 * @param value - non-negative token count.
 * @param templates - the resolved `number.thousand` / `number.million`.
 * @returns compact display string.
 */
export function formatTokens(value: number, templates: CompactNumberTemplates): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return fillTemplate(templates.thousand, { value: scaled(value / 1_000) })
  return fillTemplate(templates.million, { value: scaled(value / 1_000_000) })
}

/**
 * The counts pill's decode-throughput figure: tokens per second over the
 * decode-timed steps, null when no step carried both a decode time and output
 * tokens (host StatsPills.tsx:144-148's arm).
 * @param stats - the sessionStats projection value.
 * @returns raw tokens per second, or null without decode timing.
 */
export function tokensPerSecondOf(stats: SessionStatsView): number | null {
  return stats.decodeMs > 0 ? stats.decodeTokens / (stats.decodeMs / 1_000) : null
}

/**
 * Closed-step count of a possibly-absent sessionStats projection: absent
 * reads as zero, which gates the counts pill off (the native `stats.steps > 0`
 * arm with the fold fallback removed — see the module docstring).
 * @param stats - the projection value, if the host serves it.
 */
export function statsStepsOf(stats: SessionStatsView | null | undefined): number {
  return stats?.steps ?? 0
}

/**
 * Whether the usage pill has anything to show (host StatsPills.tsx:330-331
 * verbatim): the projection served AND at least one bucket billed — a session
 * whose steps all settled without billing shows counts without a usage pill.
 * @param usage - the projection value, if the host serves it.
 */
export function hasTokenActivity(usage: TokenUsageView | null | undefined): boolean {
  return usage !== undefined && usage !== null
    && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
}

/**
 * Whether the whole detailed-mode pills row exists (host StatsPills.tsx:347
 * inverted): at least one closed step OR one billed token, else nothing.
 * @param stats - the sessionStats projection value.
 * @param usage - the tokenUsage projection value.
 */
export function statsPillsVisible(
  stats: SessionStatsView | null | undefined,
  usage: TokenUsageView | null | undefined,
): boolean {
  return statsStepsOf(stats) > 0 || hasTokenActivity(usage)
}

/**
 * The compact mode's two plain readings (host StatsPills.tsx:332-336): the
 * decode speed and the cache-hit share — either alone justifies the row;
 * both null hide it whole (:337).
 * @param stats - the sessionStats projection value.
 * @param usage - the tokenUsage projection value.
 * @returns speed in tokens/second (null without decode timing) and the
 * cache-hit text (null without token activity or billed input).
 */
export function compactReadings(
  stats: SessionStatsView | null | undefined,
  usage: TokenUsageView | null | undefined,
): { readonly speedTps: number | null; readonly cacheHit: string | null } {
  const speedTps = stats !== undefined && stats !== null && stats.decodeMs > 0
    ? stats.decodeTokens / (stats.decodeMs / 1_000)
    : null
  const cacheHit = usage !== undefined && usage !== null && hasTokenActivity(usage)
    ? cacheHitPercent(usage)
    : null
  return { speedTps, cacheHit }
}

/**
 * Compact duration: `45.2s` under a minute, `2m42s` from there on (host
 * `StatsPills.tsx:91-99` verbatim, through the resolved duration templates).
 * @param ms - duration in milliseconds.
 * @param copy - the resolved `duration.compactSeconds` / `compactMinutes`.
 * @returns display string.
 */
export function formatDuration(
  ms: number,
  copy: Pick<StatsPillsCopy, 'compactSeconds' | 'compactMinutes'>,
): string {
  const s = ms / 1_000
  if (s < 60) return fillTemplate(copy.compactSeconds, { seconds: Math.round(s * 10) / 10 })
  const whole = Math.round(s)
  return fillTemplate(copy.compactMinutes, {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  })
}

/**
 * Exact integer token count with locale-owned digit grouping (host
 * `token-format.ts:23-30` verbatim, the separator through the resolved
 * `number.groupSeparator`).
 * @param value - non-negative safe integer token count.
 * @param groupSeparator - the resolved grouping separator.
 * @returns an unrounded, three-digit-grouped display string.
 */
export function formatExactTokens(value: number, groupSeparator: string): string {
  const digits = String(value)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(groupSeparator)
}

/**
 * The usage dialog's exact figure for one bucket: the grouped integer inside
 * the host `message.turnUsage.count` wrapper (host `StatsPills.tsx:130-132`
 * verbatim — the same `{count} tok` template the pill label uses).
 * @param value - non-negative safe integer token count.
 * @param copy - the resolved count wrapper and grouping separator.
 * @returns the display string.
 */
export function exactCount(
  value: number,
  copy: Pick<StatsPillsCopy, 'turnUsageCount' | 'groupSeparator'>,
): string {
  return fillTemplate(copy.turnUsageCount, { count: formatExactTokens(value, copy.groupSeparator) })
}

/**
 * The session's mean first-token latency (host `StatsPills.tsx:216`'s
 * `ttftMs / ttftSteps` arm): null without a recorded first token, so the row
 * stays out instead of dividing by zero.
 * @param stats - the sessionStats projection value.
 * @returns mean TTFT in milliseconds, or null when no step recorded one.
 */
export function ttftMeanMs(stats: SessionStatsView): number | null {
  return stats.ttftSteps > 0 ? stats.ttftMs / stats.ttftSteps : null
}

/**
 * Whether the counts pill has any timed figure to open a dialog for (host
 * `StatsPills.tsx:162` inverted): without model time, tool time, a recorded
 * first token, or decode timing the dialog would render zero rows, so the
 * pill stays the native static span form.
 * @param stats - the sessionStats projection value.
 */
export function timeDialogAvailable(stats: SessionStatsView): boolean {
  return stats.llmMs > 0 || stats.toolMs > 0 || stats.ttftSteps > 0 || stats.decodeMs > 0
}
