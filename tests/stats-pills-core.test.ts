/**
 * The stats pills' pure core (issue #43, alpha.13 retest): the vendored host
 * algorithms — decode throughput rounding, the cache-hit percentage with its
 * never-round-to-100 tail, the compact K/M token scale, the three-bucket
 * billed-input sum — plus the pill row's visibility gates and the copy fold
 * (host `chat` words first, the plugin's verbatim fallbacks on a miss). The
 * third round (alpha.14 retest) adds the dialogs' pure side: the duration
 * formatter, the exact grouped token count, the TTFT mean, and the counts
 * pill's static-span gate.
 */
import { describe, expect, it } from 'vitest'
import {
  billedInputTokens, cacheHitPercent, compactReadings, exactCount, fillTemplate, formatCacheHitPercent,
  formatDuration, formatExactTokens, formatTokens, formatTokensPerSecond, hasTokenActivity,
  resolveStatsCopy, statsPillsVisible, statsStepsOf, timeDialogAvailable, tokensPerSecondOf,
  ttftMeanMs,
} from '../src/client/stats-pills-core.ts'
import type { SessionStatsView, StatsPillsCopy, TokenUsageView } from '../src/client/stats-pills-core.ts'

function usage(over: Partial<TokenUsageView> = {}): TokenUsageView {
  return {
    uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, ...over,
  }
}

function stats(over: Partial<SessionStatsView> = {}): SessionStatsView {
  return {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0, decodeMs: 0,
    decodeTokens: 0, ...over,
  }
}

describe('formatTokensPerSecond (host message-chrome.ts:71-74)', () => {
  it('rounds to whole tokens from ten up', () => {
    expect(formatTokensPerSecond(247.4)).toBe('247')
    expect(formatTokensPerSecond(10)).toBe('10')
    expect(formatTokensPerSecond(10.5)).toBe('11')
    expect(formatTokensPerSecond(99.49)).toBe('99')
  })

  it('keeps one decimal below ten', () => {
    expect(formatTokensPerSecond(9.94)).toBe('9.9')
    expect(formatTokensPerSecond(0)).toBe('0')
    expect(formatTokensPerSecond(5)).toBe('5')
  })

  it('clamps negative throughput to zero', () => {
    expect(formatTokensPerSecond(-3)).toBe('0')
  })
})

describe('billedInputTokens (host StatsPills.tsx:118-120)', () => {
  it('sums the three prompt-side buckets and excludes output', () => {
    expect(billedInputTokens(usage({
      uncachedInputTokens: 100,
      cacheReadTokens: 22_000,
      cacheWriteTokens: 400,
      outputTokens: 9_000,
    }))).toBe(22_500)
  })

  it('answers zero for an all-zero fold', () => {
    expect(billedInputTokens(usage())).toBe(0)
  })
})

describe('formatCacheHitPercent (host token-format.ts:67-98)', () => {
  it('answers null without billed input', () => {
    expect(formatCacheHitPercent(0, 0)).toBeNull()
  })

  it('answers 100 only for a full hit', () => {
    expect(formatCacheHitPercent(22_500, 22_500)).toBe('100')
  })

  it('rounds an ordinary ratio to integer percent', () => {
    expect(formatCacheHitPercent(9_900, 10_000)).toBe('99')
    expect(formatCacheHitPercent(2_250, 22_500)).toBe('10')
    // Positive tie rounds up: 99.5% of 200 → 100? No — 199/200 = 99.5 rounds to 100,
    // so the tail below must catch it; 49/100 stays 49.
    expect(formatCacheHitPercent(49, 100)).toBe('49')
  })

  it('never rounds a partial hit to 100 (the honest tail)', () => {
    // 99.9% would round to 100 at integer precision: the answer spends one
    // decimal instead.
    expect(formatCacheHitPercent(9_990, 10_000)).toBe('99.9')
    expect(formatCacheHitPercent(99_990, 100_000)).toBe('99.99')
    // Exactly one token missed out of a large prompt stays honest however deep.
    expect(formatCacheHitPercent(999_999, 1_000_000)).toBe('99.9999')
  })

  it('keeps a 99 that rounds honestly at integer precision', () => {
    // 98.4% rounds to 98, no tail needed.
    expect(formatCacheHitPercent(9_840, 10_000)).toBe('98')
  })
})

describe('cacheHitPercent (host StatsPills.tsx:108-111)', () => {
  it('reads the ratio over billed input, output excluded', () => {
    // billedInput = 22,500; 22,000/22,500 = 97.8% → rounds to 98; the output
    // bucket never joins the denominator.
    expect(cacheHitPercent(usage({
      uncachedInputTokens: 500,
      cacheReadTokens: 22_000,
      outputTokens: 7_000,
    }))).toBe('98')
  })

  it('answers null when only output billed', () => {
    expect(cacheHitPercent(usage({ outputTokens: 500 }))).toBeNull()
  })
})

describe('formatTokens (host token-format.ts:9-15)', () => {
  const templates = { thousand: '{value}K', million: '{value}M' }

  it('keeps unscaled counts below 1000', () => {
    expect(formatTokens(517, templates)).toBe('517')
    expect(formatTokens(0, templates)).toBe('0')
  })

  it('scales thousands with one decimal under 100', () => {
    expect(formatTokens(1_220, templates)).toBe('1.2K')
    expect(formatTokens(517_000, templates)).toBe('517K')
  })

  it('scales millions the same way', () => {
    expect(formatTokens(22_500_000, templates)).toBe('22.5M')
    expect(formatTokens(1_000_000, templates)).toBe('1M')
  })

  it('carries the host rounding at the K/M boundaries', () => {
    // 999.999K scales to 1000 → '1000K' (host verbatim, not promoted to M).
    expect(formatTokens(999_999, templates)).toBe('1000K')
  })
})

describe('pill visibility gates (host StatsPills.tsx:330-347)', () => {
  it('reads an absent sessionStats projection as zero steps', () => {
    expect(statsStepsOf(undefined)).toBe(0)
    expect(statsStepsOf(null)).toBe(0)
    expect(statsStepsOf(stats({ steps: 160 }))).toBe(160)
  })

  it('admits the usage pill only on billed activity', () => {
    expect(hasTokenActivity(undefined)).toBe(false)
    expect(hasTokenActivity(usage())).toBe(false)
    expect(hasTokenActivity(usage({ outputTokens: 1 }))).toBe(true)
    expect(hasTokenActivity(usage({ cacheWriteTokens: 1 }))).toBe(true)
  })

  it('hides the detailed row whole without steps and without tokens', () => {
    expect(statsPillsVisible(stats(), usage())).toBe(false)
    expect(statsPillsVisible(undefined, undefined)).toBe(false)
  })

  it('keeps the detailed row with either half', () => {
    expect(statsPillsVisible(stats({ turns: 7, steps: 160 }), usage())).toBe(true)
    expect(statsPillsVisible(stats(), usage({ outputTokens: 5 }))).toBe(true)
  })
})

describe('tokensPerSecondOf (host StatsPills.tsx:144-148)', () => {
  it('divides decode tokens by decode seconds', () => {
    expect(tokensPerSecondOf(stats({ decodeMs: 10_000, decodeTokens: 2_470 }))).toBeCloseTo(247)
  })

  it('answers null without decode timing', () => {
    expect(tokensPerSecondOf(stats({ decodeTokens: 2_470 }))).toBeNull()
    expect(tokensPerSecondOf(stats({ decodeMs: 0, decodeTokens: 0 }))).toBeNull()
  })
})

describe('compactReadings (host StatsPills.tsx:332-336)', () => {
  it('answers both readings when both planes serve', () => {
    const readings = compactReadings(
      stats({ turns: 7, steps: 160, decodeMs: 10_000, decodeTokens: 2_470 }),
      usage({ cacheReadTokens: 22_000, uncachedInputTokens: 500 }),
    )
    expect(readings.speedTps).toBeCloseTo(247)
    expect(readings.cacheHit).toBe('98')
  })

  it('answers null speed without decode timing and null hit without tokens', () => {
    expect(compactReadings(stats(), usage())).toEqual({ speedTps: null, cacheHit: null })
    expect(compactReadings(undefined, undefined)).toEqual({ speedTps: null, cacheHit: null })
  })

  it('keeps speed alone when tokens never billed', () => {
    expect(compactReadings(stats({ decodeMs: 1_000, decodeTokens: 50 }), usage()))
      .toEqual({ speedTps: 50, cacheHit: null })
  })
})

describe('fillTemplate', () => {
  it('substitutes named params and keeps unknown placeholders', () => {
    expect(fillTemplate('{turns} 轮 {steps} 步', { turns: 7, steps: 160 })).toBe('7 轮 160 步')
    expect(fillTemplate('{turns} turns {steps} steps', { turns: 7, steps: 160 })).toBe('7 turns 160 steps')
    expect(fillTemplate('缓存命中 {percent}%', { percent: '99.9' })).toBe('缓存命中 99.9%')
    expect(fillTemplate('{known} {unknown}', { known: 1 })).toBe('1 {unknown}')
  })
})

describe('resolveStatsCopy', () => {
  const own: StatsPillsCopy = {
    counts: '{turns} 轮 {steps} 步',
    cacheHit: '缓存命中 {percent}%',
    dialogTitle: '会话统计',
    dialogUsageTitle: 'Token 用量',
    dialogLlmTime: '模型用时',
    dialogToolTime: '工具调用用时',
    dialogTtft: '首 token 平均（TTFT）',
    dialogSpeed: '输出速度（TPS）',
    tokensPerSecond: '{tps} tok/s',
    turnUsageCount: '{count} tok',
    turnUsageCacheHit: '缓存命中',
    turnUsageInput: '未缓存输入',
    turnUsageCacheRead: '缓存读取',
    turnUsageCacheWrite: '缓存写入',
    turnUsageOutput: '输出',
    compactSeconds: '{seconds}秒',
    compactMinutes: '{minutes}分{seconds}秒',
    thousand: '{value}K',
    million: '{value}M',
    groupSeparator: ',',
  }

  it('answers with the plugin copy when the host seat is unbound', () => {
    expect(resolveStatsCopy(undefined, own)).toEqual(own)
  })

  it('prefers the host answer for every key the namespace carries', () => {
    const hostT = (key: string): string => key === 'stats.counts' ? '{turns} turns {steps} steps' : key
    const resolved = resolveStatsCopy(hostT, own)
    expect(resolved.counts).toBe('{turns} turns {steps} steps')
    // A host miss echoes the raw key: the plugin fallback answers that key.
    expect(resolved.cacheHit).toBe(own.cacheHit)
    expect(resolved.dialogTitle).toBe(own.dialogTitle)
    expect(resolved.dialogUsageTitle).toBe(own.dialogUsageTitle)
    expect(resolved.dialogLlmTime).toBe(own.dialogLlmTime)
    expect(resolved.dialogToolTime).toBe(own.dialogToolTime)
    expect(resolved.dialogTtft).toBe(own.dialogTtft)
    expect(resolved.dialogSpeed).toBe(own.dialogSpeed)
    expect(resolved.tokensPerSecond).toBe(own.tokensPerSecond)
    expect(resolved.turnUsageCount).toBe(own.turnUsageCount)
    expect(resolved.turnUsageCacheHit).toBe(own.turnUsageCacheHit)
    expect(resolved.turnUsageInput).toBe(own.turnUsageInput)
    expect(resolved.turnUsageCacheRead).toBe(own.turnUsageCacheRead)
    expect(resolved.turnUsageCacheWrite).toBe(own.turnUsageCacheWrite)
    expect(resolved.turnUsageOutput).toBe(own.turnUsageOutput)
    expect(resolved.compactSeconds).toBe(own.compactSeconds)
    expect(resolved.compactMinutes).toBe(own.compactMinutes)
    expect(resolved.thousand).toBe(own.thousand)
    expect(resolved.million).toBe(own.million)
    expect(resolved.groupSeparator).toBe(own.groupSeparator)
  })

  it('takes each key independently (a partial host dictionary mixes)', () => {
    const hostT = (key: string): string => key === 'number.thousand' ? '{value}千' : key
    const resolved = resolveStatsCopy(hostT, own)
    expect(resolved.thousand).toBe('{value}千')
    expect(resolved.million).toBe(own.million)
    expect(resolved.counts).toBe(own.counts)
  })
})

describe('formatDuration (host StatsPills.tsx:91-99)', () => {
  const copy = { compactSeconds: '{seconds}秒', compactMinutes: '{minutes}分{seconds}秒' }

  it('renders sub-minute durations with one decimal through the seconds template', () => {
    expect(formatDuration(45_200, copy)).toBe('45.2秒')
    expect(formatDuration(0, copy)).toBe('0秒')
    expect(formatDuration(300, copy)).toBe('0.3秒')
  })

  it('rounds the sub-minute tenths half up (1.25s → 1.3s)', () => {
    expect(formatDuration(1_250, copy)).toBe('1.3秒')
  })

  it('crosses to the minutes template at the 60s boundary', () => {
    // Exactly 60s: whole = 60 → 1分0秒 (the seconds template never wins the tie).
    expect(formatDuration(60_000, copy)).toBe('1分0秒')
    expect(formatDuration(162_000, copy)).toBe('2分42秒')
    // Host verbatim quirk: 59.96s stays in the seconds branch (s < 60) and its
    // tenths round to a whole 60 — the sub-minute template can read '60秒'.
    expect(formatDuration(59_960, copy)).toBe('60秒')
  })

  it('speaks the host en templates the same way', () => {
    const en = { compactSeconds: '{seconds}s', compactMinutes: '{minutes}m{seconds}s' }
    expect(formatDuration(45_200, en)).toBe('45.2s')
    expect(formatDuration(162_000, en)).toBe('2m42s')
  })
})

describe('formatExactTokens (host token-format.ts:23-30)', () => {
  it('groups digits by three with the locale separator', () => {
    expect(formatExactTokens(0, ',')).toBe('0')
    expect(formatExactTokens(517, ',')).toBe('517')
    expect(formatExactTokens(22_500, ',')).toBe('22,500')
    expect(formatExactTokens(2_250_500, ',')).toBe('2,250,500')
  })

  it('joins with whatever separator the dictionary answers', () => {
    expect(formatExactTokens(12_345, ' ')).toBe('12 345')
    expect(formatExactTokens(12_345, '')).toBe('12345')
  })
})

describe('exactCount (host StatsPills.tsx:130-132)', () => {
  const copy = { turnUsageCount: '{count} tok', groupSeparator: ',' }

  it('wraps the grouped integer in the host count template', () => {
    expect(exactCount(22_500_000, copy)).toBe('22,500,000 tok')
    expect(exactCount(0, copy)).toBe('0 tok')
  })
})

describe('ttftMeanMs (host StatsPills.tsx:216)', () => {
  it('divides summed TTFT by the steps that recorded one', () => {
    expect(ttftMeanMs(stats({ ttftMs: 1_200, ttftSteps: 4 }))).toBe(300)
    expect(ttftMeanMs(stats({ ttftMs: 1, ttftSteps: 3 }))).toBeCloseTo(1 / 3)
  })

  it('answers null without a recorded first token (no zero division)', () => {
    expect(ttftMeanMs(stats())).toBeNull()
    expect(ttftMeanMs(stats({ ttftMs: 500 }))).toBeNull()
  })
})

describe('timeDialogAvailable (host StatsPills.tsx:162 inverted)', () => {
  it('admits the dialog when any timed figure exists', () => {
    expect(timeDialogAvailable(stats({ llmMs: 1 }))).toBe(true)
    expect(timeDialogAvailable(stats({ toolMs: 1 }))).toBe(true)
    expect(timeDialogAvailable(stats({ ttftSteps: 1 }))).toBe(true)
    expect(timeDialogAvailable(stats({ decodeMs: 1 }))).toBe(true)
  })

  it('demotes the pill to its static span without any timed figure', () => {
    expect(timeDialogAvailable(stats())).toBe(false)
    // Counts and tokens alone do not time anything.
    expect(timeDialogAvailable(stats({ turns: 7, steps: 160, decodeTokens: 500 }))).toBe(false)
  })
})
