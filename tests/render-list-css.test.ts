/**
 * Seam: the render-mode list face's CSS (issue #46) — the hanging-indent
 * mechanism and the marker-widget column. Pinned as sheet text (the issue
 * #44 pattern): jsdom has no layout and the sheet is the shipped artifact,
 * so these are regression nails on what the rules say, not behavior tests.
 */
import { describe, expect, it } from 'vitest'
import { readSheet, ruleOf } from './sheet.ts'

const composerCss = readSheet('../src/client/MarkdownComposer.module.css')

describe('render-mode list CSS contract (issue #46)', () => {
  it('hangs list rows: the first line pulls back into the marker column, wraps align to the content start', () => {
    const row = ruleOf(composerCss, '.surface :global(.cm-md-listitem)')
    expect(row).toContain('text-indent: calc(-1 * var(--cm-md-li-hang))')
    expect(row).toContain('padding-left: calc(var(--cm-md-li-indent) + var(--cm-md-li-hang))')
    // Bullet rows are the default hang; the depth indent defaults to zero.
    expect(row).toContain('--cm-md-li-hang: 1.2em')
    expect(row).toContain('--cm-md-li-indent: 0em')
  })

  it('steps the depth indent per nesting level, capped at six', () => {
    for (let depth = 2; depth <= 6; depth++) {
      const rule = ruleOf(composerCss, `.surface :global(.cm-md-li-d${depth})`)
      expect(rule).toContain(`--cm-md-li-indent: ${((depth - 1) * 1.5).toFixed(1)}em`)
    }
    expect(ruleOf(composerCss, '.surface :global(.cm-md-li-d7)')).toBe('')
  })

  it('gives ordered rows the wider marker column', () => {
    expect(ruleOf(composerCss, '.surface :global(.cm-md-li-ordered)'))
      .toContain('--cm-md-li-hang: 1.75em')
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
