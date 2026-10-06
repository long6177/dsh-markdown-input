/**
 * Seam: the takeover card's stats pills as the user sees them (issue #43,
 * alpha.13 retest). The pills are the card's rebuild of the native StatsPills
 * (`ui-chat/src/client/chat/StatsPills.tsx`), the `conversation.composer.dock`
 * slot's order-0 occupant the takeover structurally hides with the fallback
 * bar — the same gap the context meter fell through, one seat over.
 *
 * Groups:
 *
 * 1. the face itself: the detailed two-pill row (counts + throughput, total +
 *    cache hit), the native per-pill gates (each projection hides its own
 *    pill, the row hides whole without steps and without tokens), the compact
 *    mode's two plain readings, and the vendored pill geometry pinned as
 *    sheet text (the issue #44 pattern — jsdom has no layout, the sheet is
 *    the shipped artifact);
 *
 * 2. the dialogs (issue #43's third round, alpha.14 retest): the detailed
 *    pills are buttons over one exclusive open slot — click opens the
 *    trigger-anchored portal dialog, opening either pill closes the other,
 *    a second click / Escape / an outside pointerdown closes, and the rows
 *    render conditionally; the counts pill demotes to its static span when
 *    no timed figure could fill its dialog;
 *
 * 3. the mode plane: the `ui-chat` settings form reached through the
 *    `configForms` service, capability-detected; an absent service reads as
 *    the native default (detailed).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import {
  StatsPillsFace, statsPillsFaceDefinition,
  type StatsProjectionReader,
} from '../src/client/StatsPillsFace.tsx'
import { resolveStatsCopy, type SessionStatsView, type StatsPillsCopy, type TokenUsageView } from '../src/client/stats-pills-core.ts'
import {
  installStatsSettingsSource, resetStatsLocale, resetStatsSettingsSource,
  setStatsSettingsSource, statsSettingsStore,
  type StatsSettingsStore,
} from '../src/client/stats-pills-face.ts'
import { en, zh } from '../src/client/locales.ts'

/** The plugin fallback templates as the card resolves them (unbound host seat). */
const EN_COPY: StatsPillsCopy = {
  counts: en['stats.counts'],
  cacheHit: en['stats.cacheHit'],
  dialogTitle: en['stats.dialog.title'],
  dialogUsageTitle: en['stats.dialog.usageTitle'],
  dialogLlmTime: en['stats.dialog.llmTime'],
  dialogToolTime: en['stats.dialog.toolTime'],
  dialogTtft: en['stats.dialog.ttft'],
  dialogSpeed: en['stats.dialog.speed'],
  tokensPerSecond: en['message.tokensPerSecond'],
  turnUsageCount: en['message.turnUsage.count'],
  turnUsageCacheHit: en['message.turnUsage.cacheHit'],
  turnUsageInput: en['message.turnUsage.input'],
  turnUsageCacheRead: en['message.turnUsage.cacheRead'],
  turnUsageCacheWrite: en['message.turnUsage.cacheWrite'],
  turnUsageOutput: en['message.turnUsage.output'],
  compactSeconds: en['duration.compactSeconds'],
  compactMinutes: en['duration.compactMinutes'],
  thousand: en['number.thousand'],
  million: en['number.million'],
  groupSeparator: en['number.groupSeparator'],
}

/** The zh mirror, for the locale rendering assertions. */
const ZH_COPY: StatsPillsCopy = {
  counts: zh['stats.counts'],
  cacheHit: zh['stats.cacheHit'],
  dialogTitle: zh['stats.dialog.title'],
  dialogUsageTitle: zh['stats.dialog.usageTitle'],
  dialogLlmTime: zh['stats.dialog.llmTime'],
  dialogToolTime: zh['stats.dialog.toolTime'],
  dialogTtft: zh['stats.dialog.ttft'],
  dialogSpeed: zh['stats.dialog.speed'],
  tokensPerSecond: zh['message.tokensPerSecond'],
  turnUsageCount: zh['message.turnUsage.count'],
  turnUsageCacheHit: zh['message.turnUsage.cacheHit'],
  turnUsageInput: zh['message.turnUsage.input'],
  turnUsageCacheRead: zh['message.turnUsage.cacheRead'],
  turnUsageCacheWrite: zh['message.turnUsage.cacheWrite'],
  turnUsageOutput: zh['message.turnUsage.output'],
  compactSeconds: zh['duration.compactSeconds'],
  compactMinutes: zh['duration.compactMinutes'],
  thousand: zh['number.thousand'],
  million: zh['number.million'],
  groupSeparator: zh['number.groupSeparator'],
}

/** The screenshot figures (issue #43, alpha.13): 7 turns / 160 steps, 247 tok/s, 22.5M tok, 99% hit. */
const STATS: SessionStatsView = {
  turns: 7, steps: 160, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
  decodeMs: 1_000, decodeTokens: 247,
}

/** 22.275M cached + 225k uncached = 22.5M billed input; output adds nothing. */
const USAGE: TokenUsageView = {
  uncachedInputTokens: 225_000, outputTokens: 0,
  cacheReadTokens: 22_275_000, cacheWriteTokens: 0,
}

/** A stable-snapshot settings store (React 18 requires getSnapshot caching). */
function settingsStore(mode?: 'compact' | 'detailed'): StatsSettingsStore {
  const snapshot = { value: mode === undefined ? undefined : { performanceUsage: mode } }
  return { subscribe: () => () => {}, getSnapshot: () => snapshot }
}

/** One face mount with the projections (and, optionally, the mode) pinned. */
function mountPills(table: {
  stats?: SessionStatsView | null
  usage?: TokenUsageView | null
  settings?: 'compact' | 'detailed' | 'loading'
  copy?: StatsPillsCopy
}, gateSeat: unknown = (key: string) => key): ReturnType<typeof render> {
  setStatsSettingsSource(() => table.settings === undefined ? undefined : settingsStore(table.settings))
  return render(
    <FaceGate definition={statsPillsFaceDefinition(gateSeat)}>
      <StatsPillsFace
        useProjection={((key: string) => {
          if (key === 'sessionStats') return table.stats
          if (key === 'tokenUsage') return table.usage
          return undefined
        }) as unknown as StatsProjectionReader}
        copy={table.copy ?? EN_COPY}
      />
    </FaceGate>,
  )
}

function pillsRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-composer-stats]')
}

/** The pill elements, structurally: the root's direct span children. */
function pills(): HTMLElement[] {
  return [...pillsRoot()?.children ?? []].filter((node): node is HTMLElement => node instanceof HTMLElement)
}

function pillTexts(): string[] {
  return pills().map(pill => pill.textContent ?? '')
}

afterEach(() => {
  cleanup()
  resetStatsLocale()
  resetStatsSettingsSource()
  resetFaces()
})

describe('StatsPillsFace detailed row', () => {
  it('renders the counts pill then the usage pill with the vendored icons', () => {
    mountPills({ stats: STATS, usage: USAGE })
    const root = pillsRoot()
    expect(root).not.toBeNull()
    const pillList = pills()
    expect(pillList).toHaveLength(2)
    // Counts pill: gauge glyph, `7 turns 160 steps`, the `·`-joined 247 tok/s.
    expect(pillList[0]?.querySelector('svg')).not.toBeNull()
    expect(pillTexts()[0]).toBe('7 turns 160 steps·247 tok/s')
    // Usage pill: database glyph, the compact total, the `·`-joined hit share.
    expect(pillTexts()[1]).toBe('22.5M tok·Cache hit 99%')
  })

  it('renders the zh copy it is given', () => {
    mountPills({ stats: STATS, usage: USAGE, copy: ZH_COPY })
    expect(pillTexts()[0]).toBe('7 轮 160 步·247 tok/s')
    expect(pillTexts()[1]).toBe('22.5M tok·缓存命中 99%')
  })

  it('hides the counts pill when the sessionStats projection is missing', () => {
    mountPills({ usage: USAGE })
    expect(pillTexts()).toEqual(['22.5M tok·Cache hit 99%'])
  })

  it('hides the usage pill when the tokenUsage projection is missing', () => {
    mountPills({ stats: STATS })
    expect(pillTexts()).toEqual(['7 turns 160 steps·247 tok/s'])
  })

  it('hides the usage pill when no bucket billed (counts only)', () => {
    mountPills({ stats: STATS, usage: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    expect(pillTexts()).toEqual(['7 turns 160 steps·247 tok/s'])
  })

  it('keeps the usage pill alone for a zero-step session with billed tokens', () => {
    mountPills({ stats: { ...STATS, steps: 0, turns: 0 }, usage: USAGE })
    expect(pillTexts()).toEqual(['22.5M tok·Cache hit 99%'])
  })

  it('renders nothing when neither projection answers', () => {
    mountPills({})
    expect(pillsRoot()).toBeNull()
  })

  it('renders nothing when the projection seat is not callable (gate probe)', () => {
    mountPills({ stats: STATS, usage: USAGE }, null)
    expect(pillsRoot()).toBeNull()
  })

  it('drops the throughput reading when no step carried decode timing', () => {
    mountPills({ stats: { ...STATS, decodeMs: 0, decodeTokens: 0 }, usage: USAGE })
    expect(pillTexts()[0]).toBe('7 turns 160 steps')
  })
})

describe('StatsPillsFace compact mode', () => {
  it('renders the two plain readings without counts or totals', () => {
    mountPills({ stats: STATS, usage: USAGE, settings: 'compact' })
    expect(pillTexts()).toEqual(['247 tok/s', 'Cache hit 99%'])
  })

  it('renders nothing when neither reading exists in compact mode', () => {
    mountPills({ settings: 'compact' })
    expect(pillsRoot()).toBeNull()
  })

  it('falls back to the detailed row while the form has not loaded', () => {
    mountPills({ stats: STATS, usage: USAGE, settings: 'loading' })
    expect(pillTexts()[0]).toBe('7 turns 160 steps·247 tok/s')
  })

  it('keeps the detailed row when no settings service exists', () => {
    mountPills({ stats: STATS, usage: USAGE })
    expect(pillTexts()[0]).toBe('7 turns 160 steps·247 tok/s')
  })
})

/* ------------------------------------------------------------------ *
 * Detailed dialogs (issue #43's third round, alpha.14 retest): the two
 * pills are buttons over one exclusive open slot, each portaling the
 * trigger-anchored stat dialog (the native stat-dialog posture).
 * ------------------------------------------------------------------ */

/** A session where every timed figure exists, for the dialog row tests. */
const TIMED_STATS: SessionStatsView = {
  turns: 7, steps: 160, llmMs: 1_250, toolMs: 2_000, ttftMs: 1_200, ttftSteps: 4,
  decodeMs: 10_000, decodeTokens: 2_470,
}

/** The counts pill's portaled dialog, when open. */
function timeDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-session-stats-dialog]')
}

/** The usage pill's portaled dialog, when open. */
function usageDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-session-usage-dialog]')
}

/** The detailed pill buttons, in row order (counts pill first). */
function pillButtons(): HTMLButtonElement[] {
  return [...(pillsRoot()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
}

function rowLabels(dialog: HTMLElement): string[] {
  return [...dialog.querySelectorAll('dt')].map(dt => dt.textContent ?? '')
}

function rowValues(dialog: HTMLElement): string[] {
  return [...dialog.querySelectorAll('dd')].map(dd => dd.textContent ?? '')
}

describe('StatsPillsFace detailed dialogs (issue #43, third round)', () => {
  it('opens the session-stat dialog on click with every timed row', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    expect(timeDialog()).toBeNull()
    fireEvent.click(pillButtons()[0]!)
    const open = timeDialog()
    expect(open).not.toBeNull()
    expect(open).toHaveAttribute('role', 'dialog')
    expect(open).toHaveAttribute('aria-label', EN_COPY.dialogTitle)
    // Heading = gauge glyph + the section name; no right-side value (text is
    // the contract — the sheet classes are hashed at runtime).
    expect(open?.textContent).toContain(EN_COPY.dialogTitle)
    expect(rowLabels(open!)).toEqual([
      EN_COPY.dialogLlmTime, EN_COPY.dialogToolTime, EN_COPY.dialogTtft, EN_COPY.dialogSpeed,
    ])
    // 1250ms → 1.3s, 2000ms → 2s, mean TTFT 1200/4 → 0.3s, 247 tok/s.
    expect(rowValues(open!)).toEqual(['1.3s', '2s', '0.3s', '247 tok/s'])
    expect(pillButtons()[0]).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders the timed rows conditionally, absent figures drop their row', () => {
    // Only decode timing: llm/tool/ttft rows stay out with no placeholders.
    mountPills({ stats: { ...TIMED_STATS, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0 }, usage: USAGE })
    fireEvent.click(pillButtons()[0]!)
    const open = timeDialog()
    expect(rowLabels(open!)).toEqual([EN_COPY.dialogSpeed])
    expect(rowValues(open!)).toEqual(['247 tok/s'])
  })

  it('opens the token-usage dialog with the exact grouped headline value', () => {
    mountPills({ stats: STATS, usage: USAGE })
    fireEvent.click(pillButtons()[1]!)
    const open = usageDialog()
    expect(open).not.toBeNull()
    expect(open).toHaveAttribute('role', 'dialog')
    expect(open).toHaveAttribute('aria-label', EN_COPY.dialogUsageTitle)
    expect(open?.textContent).toContain(EN_COPY.dialogUsageTitle)
    // Headline right side: the exact grouped total (the pill label's 22.5M unrounded).
    expect(open?.textContent).toContain('22,500,000 tok')
    expect(rowLabels(open!)).toEqual([
      EN_COPY.turnUsageCacheHit, EN_COPY.turnUsageInput, EN_COPY.turnUsageCacheRead, EN_COPY.turnUsageOutput,
    ])
    expect(rowValues(open!)).toEqual(['99%', '225,000 tok', '22,275,000 tok', '0 tok'])
  })

  it('drops the cache-hit row and pill tail when nothing billed input', () => {
    // Output-only usage: cacheHitPercent answers null, the pill reads the pure total.
    mountPills({ stats: STATS, usage: { uncachedInputTokens: 0, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0 } })
    expect(pillTexts()[1]).toBe('500 tok')
    fireEvent.click(pillButtons()[1]!)
    const open = usageDialog()
    expect(rowLabels(open!)).toEqual([
      EN_COPY.turnUsageInput, EN_COPY.turnUsageCacheRead, EN_COPY.turnUsageOutput,
    ])
  })

  it('renders the cache-write row only when the bucket billed', () => {
    mountPills({
      stats: STATS,
      usage: { uncachedInputTokens: 100, outputTokens: 0, cacheReadTokens: 200, cacheWriteTokens: 400 },
    })
    fireEvent.click(pillButtons()[1]!)
    const open = usageDialog()
    expect(rowLabels(open!)).toEqual([
      EN_COPY.turnUsageCacheHit, EN_COPY.turnUsageInput, EN_COPY.turnUsageCacheRead,
      EN_COPY.turnUsageCacheWrite, EN_COPY.turnUsageOutput,
    ])
    expect(rowValues(open!)).toEqual(['29%', '100 tok', '200 tok', '400 tok', '0 tok'])
  })

  it('keeps the two dialogs mutually exclusive (opening one closes the other)', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).not.toBeNull()
    expect(usageDialog()).toBeNull()
    // Opening the usage pill closes the time pill's dialog.
    fireEvent.click(pillButtons()[1]!)
    expect(timeDialog()).toBeNull()
    expect(usageDialog()).not.toBeNull()
    expect(pillButtons()[0]).toHaveAttribute('aria-expanded', 'false')
    expect(pillButtons()[1]).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes on a second click of the same pill (toggle)', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).not.toBeNull()
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).toBeNull()
    expect(pillButtons()[0]).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on Escape', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(timeDialog()).toBeNull()
    expect(pillButtons()[0]).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on an outside pointerdown', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).not.toBeNull()
    // The dismissal rides the primitive's document-level pointerdown listener;
    // jsdom's PointerEvent is used directly so the listener's `event.target`
    // is a real node outside the pill anchor (the context-meter precedent).
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(timeDialog()).toBeNull()
  })

  it('carries the dialog aria posture and the composite accessible names', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE })
    const [time, usage] = pillButtons()
    expect(time).toHaveAttribute('aria-haspopup', 'dialog')
    expect(time).toHaveAttribute('aria-expanded', 'false')
    expect(time).toHaveAttribute('aria-label', '7 turns 160 steps · 247 tok/s')
    expect(usage).toHaveAttribute('aria-haspopup', 'dialog')
    expect(usage).toHaveAttribute('aria-expanded', 'false')
    expect(usage).toHaveAttribute('aria-label', '22.5M tok · Cache hit 99%')
  })

  it('demotes the counts pill to a static span without any timed figure', () => {
    // Steps exist, nothing is timed: the pill renders, as a span, no dialog.
    mountPills({
      stats: { turns: 2, steps: 3, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0, decodeTokens: 0 },
      usage: USAGE,
    })
    expect(pillTexts()[0]).toBe('2 turns 3 steps')
    const pillList = pills()
    expect(pillList[0]?.querySelector('button')).toBeNull()
    // The usage pill is still a button over its four always-present buckets.
    expect(pillList[1]?.querySelector('button')).not.toBeNull()
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()).toBeNull()
    expect(usageDialog()).not.toBeNull()
  })

  it('keeps compact mode free of buttons', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE, settings: 'compact' })
    expect(pillButtons()).toHaveLength(0)
    expect(document.querySelectorAll('[data-session-stats-dialog], [data-session-usage-dialog]')).toHaveLength(0)
  })

  it('speaks the zh dialog copy it is given', () => {
    mountPills({ stats: TIMED_STATS, usage: USAGE, copy: ZH_COPY })
    fireEvent.click(pillButtons()[0]!)
    expect(timeDialog()?.textContent).toContain('会话统计')
    expect(rowLabels(timeDialog()!)).toEqual(['模型用时', '工具调用用时', '首 token 平均（TTFT）', '输出速度（TPS）'])
    expect(rowValues(timeDialog()!)).toEqual(['1.3秒', '2秒', '0.3秒', '247 tok/s'])
    fireEvent.click(pillButtons()[1]!)
    expect(usageDialog()?.textContent).toContain('Token 用量')
    expect(rowLabels(usageDialog()!)).toEqual(['缓存命中', '未缓存输入', '缓存读取', '输出'])
    expect(usageDialog()?.textContent).toContain('22,500,000 tok')
  })
})

describe('stats settings face (the configForms plane)', () => {
  it('resolves the ui-chat form through the configForms service', () => {
    const store = settingsStore('compact')
    installStatsSettingsSource({
      get: (key: string) => key === 'configForms'
        ? { get: (namespace: string) => namespace === 'ui-chat' ? store : undefined }
        : undefined,
    } as never)
    expect(statsSettingsStore()).toBe(store)
  })

  it('reads a missing or faceless service as absent', () => {
    installStatsSettingsSource({
      get: () => undefined,
    } as never)
    expect(statsSettingsStore()).toBeUndefined()
    installStatsSettingsSource({
      get: () => { throw new Error('service not provided') },
    } as never)
    expect(statsSettingsStore()).toBeUndefined()
    installStatsSettingsSource({
      get: () => ({ get: () => ({ getSnapshot: 'not a function' }) }),
    } as never)
    expect(statsSettingsStore()).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ *
 * Sheet contract: the vendored pill geometry (the issue #44 pattern).
 * ------------------------------------------------------------------ */

function readSheet(path: string): string {
  // Normalize CRLF: autocrlf checkouts hand the multi-line selector regexes
  // `\r\n` line breaks, which never match the `\n` the rules were authored with.
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/gu, '\n')
}

function ruleOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return sheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

describe('StatsPillsFace CSS contract (host StatsPills.module.css vendored)', () => {
  const sheet = readSheet('../src/client/StatsPillsFace.module.css')

  it('mirrors the native pills row geometry', () => {
    const root = ruleOf(sheet, '.root')
    expect(root).toContain('gap: 12px')
    expect(root).toContain('justify-content: center')
    expect(root).toContain('font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px)')
    const pill = ruleOf(sheet, '.pill')
    expect(pill).toContain('padding: 1px 8px')
    expect(pill).toContain('border-radius: 999px')
    expect(pill).toContain('font-variant-numeric: tabular-nums')
    expect(pill).toContain('color: var(--dsw-alias-label-tertiary)')
    expect(pill).toContain('gap: 6px')
    const icon = ruleOf(sheet, '.pill svg')
    expect(icon).toContain('width: 14px')
    expect(icon).toContain('height: 14px')
    const sep = ruleOf(sheet, '.sep')
    expect(sep).toContain('margin: 0 6px')
    expect(sep).toContain('color: var(--dsw-alias-separator-primary)')
  })

  it('mirrors the native dialog-trigger affordances (anchor + button highlight)', () => {
    // The anchor shrink-wraps its pill so the panel clamp measures the pill.
    const anchor = ruleOf(sheet, '.anchor')
    expect(anchor).toContain('display: inline-flex')
    expect(anchor).toContain('min-width: 0')
    // Only the button form invites interaction; the expanded pill lifts.
    expect(ruleOf(sheet, 'button.pill')).toContain('cursor: pointer')
    const hover = ruleOf(sheet, "button.pill:hover,\nbutton.pill[aria-expanded='true']")
    expect(hover).toContain('background: var(--dsw-alias-interactive-bg-hover)')
    expect(hover).toContain('color: var(--dsw-alias-label-secondary)')
  })
})

describe('StatDialogFace CSS contract (host stat-dialog.module.css vendored)', () => {
  const sheet = readSheet('../src/client/StatDialogFace.module.css')

  it('mirrors the native panel skin', () => {
    const panel = ruleOf(sheet, '.panel')
    expect(panel).toContain('position: fixed')
    expect(panel).toContain('z-index: 1100')
    expect(panel).toContain('width: max-content')
    expect(panel).toContain('min-width: min(300px, calc(100vw - 24px))')
    expect(panel).toContain('max-width: min(440px, calc(100vw - 24px))')
    expect(panel).toContain('padding: 16px')
    expect(panel).toContain('border-radius: var(--dsw-radius-lg)')
    expect(panel).toContain('background: var(--dsw-specific-menu)')
    expect(panel).toContain('backdrop-filter: var(--dsw-menu-backdrop-filter)')
    expect(panel).toContain('--dsw-elevation-stroke-color: var(--dsw-alias-border-l1)')
    expect(panel).toContain('box-shadow: var(--dsw-elevation-prominent)')
    expect(panel).toContain('font-size: 12px')
    expect(panel).toContain('line-height: 18px')
    expect(panel).toContain('color: var(--dsw-alias-label-secondary)')
  })

  it('mirrors the native title row, rule and details grid', () => {
    const title = ruleOf(sheet, '.title')
    expect(title).toContain('justify-content: space-between')
    expect(title).toContain('gap: 16px')
    expect(title).toContain('margin-bottom: 8px')
    expect(title).toContain('color: var(--dsw-alias-label-primary)')
    expect(title).toContain('font-weight: 500')
    const rule = ruleOf(sheet, '.titleRule')
    expect(rule).toContain('margin-bottom: 10px')
    expect(rule).toContain('border-top: 0.5px solid var(--dsw-alias-border-l2)')
    const titleValue = ruleOf(sheet, '.titleValue')
    expect(titleValue).toContain('font-variant-numeric: tabular-nums')
    const titleLabel = ruleOf(sheet, '.titleLabel')
    expect(titleLabel).toContain('display: inline-flex')
    expect(titleLabel).toContain('gap: 6px')
    const titleIcon = ruleOf(sheet, '.titleLabel svg')
    expect(titleIcon).toContain('width: 14px')
    expect(titleIcon).toContain('height: 14px')
    const details = ruleOf(sheet, '.details')
    expect(details).toContain('grid-template-columns: minmax(76px, auto) minmax(0, 1fr)')
    expect(details).toContain('gap: 6px 16px')
    expect(details).toContain('color: var(--dsw-alias-label-tertiary)')
    // The dd color rule is the sheet's STANDALONE `.details dd` block (the
    // shared `dt, dd` reset names the same selector first).
    const ddRules = [...sheet.matchAll(/\.details dd\s*\{([^}]*)\}/gu)]
    const dd = ddRules[ddRules.length - 1]?.[1] ?? ''
    expect(dd).toContain('color: var(--dsw-alias-label-secondary)')
    expect(dd).toContain('font-variant-numeric: tabular-nums')
    expect(dd).toContain('text-align: right')
  })
})
