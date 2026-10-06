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
 * 2. the mode plane: the `ui-chat` settings form reached through the
 *    `configForms` service, capability-detected; an absent service reads as
 *    the native default (detailed).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cleanup, render } from '@testing-library/react'
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
  tokensPerSecond: en['message.tokensPerSecond'],
  turnUsageCount: en['message.turnUsage.count'],
  thousand: en['number.thousand'],
  million: en['number.million'],
}

/** The zh mirror, for the locale rendering assertions. */
const ZH_COPY: StatsPillsCopy = {
  counts: zh['stats.counts'],
  cacheHit: zh['stats.cacheHit'],
  tokensPerSecond: zh['message.tokensPerSecond'],
  turnUsageCount: zh['message.turnUsage.count'],
  thousand: zh['number.thousand'],
  million: zh['number.million'],
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
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
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
})
