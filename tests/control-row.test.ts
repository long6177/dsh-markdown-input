/**
 * Seam: the tool-row collapse measurement — the truncation ladder's row
 * half. It always measures EXPANDED demand (the attribute is cleared
 * first), toggles `data-model-compact` only when the expanded controls
 * cannot share the line, ignores zero-width (hidden face) children, and
 * survives missing observers or DOM faces — a layout hint must never
 * throw into the card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeControlRow, type ControlRow } from '../src/client/control-row.ts'

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
