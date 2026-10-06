/**
 * Seam: the tool-row collapse measurement — the truncation ladder's row
 * half. It always measures EXPANDED demand (the attribute is cleared
 * first), toggles `data-model-compact` only when the expanded controls
 * cannot share the line, ignores zero-width (hidden face) children, and
 * survives missing observers or DOM faces — a layout hint must never
 * throw into the card.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeControlRow, type ControlRow } from '../src/client/control-row.ts'

/**
 * The sheet text as shipped: vitest's `css: false` stubs `*.module.css`
 * imports (a `?raw` query rides the same stub and returns the class-map
 * object), so the CSS contract below is read straight off disk.
 */
function readSheet(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}
const composerCss = readSheet('../src/client/MarkdownComposer.module.css')
const modelSelectCss = readSheet('../src/client/ModelSelectFace.module.css')

/** A fake row whose children answer fixed widths and whose content width is `available` (padded by 16). */
function fakeRow(available: number, widths: number[]): ControlRow & { toggles: boolean[] } {
  const toggles: boolean[] = []
  return {
    toggles,
    children: widths.map((width) => ({ getBoundingClientRect: () => ({ width }) })),
    getBoundingClientRect: () => ({ width: available + 16 }),
    toggleAttribute: vi.fn((name: string, force?: boolean) => {
      if (name === 'data-model-compact') toggles.push(force ?? false)
    }),
  } as unknown as ControlRow & { toggles: boolean[] }
}

/** The computed style the measurement reads (padding + column gap). */
function stubComputedStyle(): void {
  vi.stubGlobal('getComputedStyle', vi.fn(() => ({
    paddingLeft: '8', paddingRight: '8', columnGap: '8',
  })) as unknown as typeof getComputedStyle)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('observeControlRow', () => {
  it('toggles compact only when expanded demand exceeds the row', () => {
    stubComputedStyle()
    // Content width 200; children sum 90+95 + one 8px gap = 193 → fits.
    const fits = fakeRow(200, [90, 95])
    const disposeFits = observeControlRow(fits)
    // The final verdict is what the pill renders from.
    expect(fits.toggles.at(-1)).toBe(false)
    disposeFits()

    // Children sum 110+95 + gap = 213 > 200 → compact.
    const tight = fakeRow(200, [110, 95])
    const disposeTight = observeControlRow(tight)
    expect(tight.toggles.at(-1)).toBe(true)
    disposeTight()
  })

  it('measures expanded demand first, even while collapsed', () => {
    stubComputedStyle()
    const row = fakeRow(200, [110, 95])
    const dispose = observeControlRow(row)
    // Every measure starts by clearing the attribute: the first toggle is
    // always the expanded verdict.
    expect(row.toggles[0]).toBe(false)
    dispose()
  })

  it('ignores zero-width children (hidden faces) in the demand sum', () => {
    stubComputedStyle()
    const row = fakeRow(200, [90, 0, 95])
    const dispose = observeControlRow(row)
    // Only two counted widths → the hidden face adds no gap either.
    expect(row.toggles.at(-1)).toBe(false)
    dispose()
  })

  it('survives a missing ResizeObserver with a static measure', () => {
    stubComputedStyle()
    vi.stubGlobal('ResizeObserver', undefined)
    const row = fakeRow(200, [110, 95])
    expect(() => {
      const dispose = observeControlRow(row)
      dispose()
    }).not.toThrow()
    expect(row.toggles.at(-1)).toBe(true)
  })

  it('survives a missing computed-style face (stays expanded, never throws)', () => {
    vi.stubGlobal('getComputedStyle', undefined)
    const row = fakeRow(200, [90, 95])
    expect(() => {
      const dispose = observeControlRow(row)
      dispose()
    }).not.toThrow()
    expect(row.toggles).not.toContain(true)
  })

  it('disconnects cleanly', () => {
    stubComputedStyle()
    const row = fakeRow(200, [90, 95])
    const dispose = observeControlRow(row)
    expect(() => dispose()).not.toThrow()
  })
})

/** A rule's declaration block, matched by its literal selector text. */
function ruleOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return sheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

/**
 * The CSS half of the same seam, pinned as sheet text (issue #39): the row's
 * compact attribute and the pill's two-level shrink chain are a cross-file
 * contract between this plugin's sheets — jsdom has no layout, so these are
 * regression nails on what the rules say, not behavior tests.
 */
describe('tool-row ↔ model-pill CSS contract (issue #39)', () => {
  it('pins the expanded-state display variables on the base .toolRow rule', () => {
    const base = ruleOf(composerCss, '.toolRow')
    // The inheritance nail: the variable names are the host seat contract,
    // so a host ancestor defining them must not leak into the pill. The
    // values equal the consumer fallbacks in ModelSelectFace.
    expect(base).toContain('--dsh-composer-model-text-display: block')
    expect(base).toContain('--dsh-composer-model-icon-display: none')
  })

  it('flips both variables in the compact rule and nowhere else', () => {
    const compact = ruleOf(composerCss, '.toolRow[data-model-compact]')
    expect(compact).toContain('--dsh-composer-model-text-display: none')
    expect(compact).toContain('--dsh-composer-model-icon-display: block')
    // Base pin + compact flip are the sheet's only writers of the pair.
    expect([...composerCss.matchAll(/--dsh-composer-model-(?:text|icon)-display:/gu)])
      .toHaveLength(4)
  })

  it('keeps the invented mode seat at the sibling icon-trigger footprint', () => {
    const mode = ruleOf(composerCss, '.modeButton')
    // 4px padding around a 14px glyph — the same 22px box the attach
    // fallback's `.iconButton` and the `+` trigger occupy.
    expect(mode).toContain('width: 22px')
    expect(mode).toContain('height: 22px')
  })

  it("keeps the pill's two-level shrink chain intact", () => {
    // Level 1: the effort span absorbs the whole deficit before the model
    // name loses a pixel.
    expect(ruleOf(modelSelectCss, '.triggerEffort')).toContain('flex-shrink: 1000')
    // Level 2 cap: the legacy fallback, then the row-relative cap.
    const trigger = ruleOf(modelSelectCss, '.trigger')
    expect(trigger).toContain('max-width: 220px')
    expect(trigger).toContain('max-width: min(360px, 45cqw)')
  })

  it('lays the row out as the native two-group line with no spring filler', () => {
    const row = ruleOf(composerCss, '.toolRow')
    // The native `.row` contract (host InputBar.module.css:251-261): wrap
    // resolves a transient overflow by moving the trailing group onto its own
    // line, and space-between parks the slack BETWEEN the groups — slack is
    // then strictly positive at width, never absorbed by a filler.
    expect(row).toContain('flex-wrap: wrap')
    expect(row).toContain('justify-content: space-between')
    // The `.spring { flex: 1 }` filler is gone: it absorbed all the slack so
    // needed ≡ available and the verdict rode sub-pixel rounding (the
    // alpha.13 wide-window false compact).
    expect(composerCss).not.toContain('.spring')
  })

  it('keeps both row groups non-shrinkable so overflow stays measurable', () => {
    // The measurement premise: a group rectangle always equals its natural
    // demand width. A flex-compressed child would hand the measurement its
    // laid-back width, the sum would mask the deficit, and a tight row would
    // stay expanded (the alpha.13 narrow-window false expanded — the pill
    // then ellipsized instead of flipping to icon).
    expect(ruleOf(composerCss, '.leading')).toContain('flex: none')
    expect(ruleOf(composerCss, '.trailing')).toContain('flex: none')
    // The native trailing re-anchor (InputBar.module.css:293-302): the auto
    // margin pins the group right on a single line and re-anchors it right
    // on a wrapped line.
    expect(ruleOf(composerCss, '.trailing')).toContain('margin-left: auto')
  })
})
