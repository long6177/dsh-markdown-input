/**
 * Seam: the render-mode list face's CSS (issue #46) — the hanging-indent
 * mechanism and the marker-widget column. Pinned as sheet text (the issue
 * #44 pattern): jsdom has no layout and the sheet is the shipped artifact,
 * so these are regression nails on what the rules say, not behavior tests.
 */
import { describe, expect, it } from 'vitest'
import { readSheet, ruleOf } from './sheet.ts'

const composerCss = readSheet('../src/client/MarkdownComposer.module.css')

describe('render-mode list CSS contract (issue #46; geometry reworked on the alpha.17 feedback)', () => {
  it('insets the whole row per level: first line pulls back into the marker column, wraps align to the content start', () => {
    const row = ruleOf(composerCss, '.surface :global(.cm-md-listitem)')
    expect(row).toContain('text-indent: calc(-1 * var(--cm-md-li-hang))')
    expect(row).toContain('padding-left: calc(var(--cm-md-li-indent) + var(--cm-md-li-hang))')
    // Level 1 drops the whole row in one step; bullets use the compact
    // marker column.
    expect(row).toContain('--cm-md-li-hang: 0.9em')
    expect(row).toContain('--cm-md-li-indent: 1.5em')
  })

  it('steps the per-level inset one 1.5em per nesting level, capped at six', () => {
    for (let depth = 2; depth <= 6; depth++) {
      const rule = ruleOf(composerCss, `.surface :global(.cm-md-li-d${depth})`)
      expect(rule).toContain(`--cm-md-li-indent: ${(depth * 1.5).toFixed(1)}em`)
    }
    expect(ruleOf(composerCss, '.surface :global(.cm-md-li-d7)')).toBe('')
  })

  it('gives ordered rows the narrower two-digit ordinal column', () => {
    expect(ruleOf(composerCss, '.surface :global(.cm-md-li-ordered)'))
      .toContain('--cm-md-li-hang: 1.35em')
  })

  it('spans the marker widget across the hang column so the content starts after it', () => {
    const mark = ruleOf(composerCss, '.surface :global(.cm-md-listmark)')
    expect(mark).toContain('display: inline-block')
    expect(mark).toContain('min-width: var(--cm-md-li-hang)')
  })

  it('resets the inherited first-line pull inside the marker box so the glyph stays visible (alpha.16 regression)', () => {
    // `text-indent` is inherited: the row's -1 * hang pull reached inside the
    // inline-block widget and shifted the `•`/ordinal glyph a full hang
    // column left of its own box — the column stayed, the glyph did not
    // (real-machine alpha.16). The widget must zero the pull.
    const mark = ruleOf(composerCss, '.surface :global(.cm-md-listmark)')
    expect(mark).toContain('text-indent: 0')
  })
})
