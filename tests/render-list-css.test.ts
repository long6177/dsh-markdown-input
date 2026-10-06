/**
 * Seam: the render-mode list face's CSS (issue #46) — the hanging-indent
 * mechanism and the marker-widget column. Pinned as sheet text (the issue
 * #44 pattern): jsdom has no layout and the sheet is the shipped artifact,
 * so these are regression nails on what the rules say, not behavior tests.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** The sheet text as shipped: read straight off disk (vitest stubs *.module.css). */
function readSheet(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

/** The body of one selector's rule, or '' when absent. */
function ruleOf(sheet: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return sheet.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

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
})
