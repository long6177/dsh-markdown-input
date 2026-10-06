/**
 * Live-render decoration tests at the EditorState seam: the pure
 * `buildRenderDecorations` function is the folding behavior of the editor.
 * Assertions are on what a user would see: which source ranges fold away,
 * which spans take which style, and which lines stay raw.
 */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Decoration, DecorationSet } from '@codemirror/view'
import { EditorView } from '@codemirror/view'
import { forceParsing } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { activeLinesOf, buildRenderDecorations, CodeLangWidget } from '../src/client/live-render.ts'

// markdownLanguage is the GFM-extended base (task lists included).
const extensions = [markdown({ base: markdownLanguage })]

function setup(doc: string, active: number[] = []): DecorationSet {
  const state = EditorState.create({ doc, extensions })
  return buildRenderDecorations(state, new Set(active))
}

/** One flattened decoration, described in assertion-friendly terms. */
interface DecorationRecord {
  from: number
  to: number
  kind: 'replace' | 'mark' | 'line' | 'widget'
  class?: string
  widget?: string
  lang?: string
}

function collect(set: DecorationSet): DecorationRecord[] {
  const out: DecorationRecord[] = []
  const cursor = set.iter()
  while (cursor.value !== null) {
    const { from, to, value } = cursor as { from: number, to: number, value: Decoration }
    const spec = value.spec as { class?: string; widget?: object }
    const kind: DecorationRecord['kind'] = spec.widget !== undefined
      ? from === to ? 'widget' : 'replace'
      : from === to ? 'line' : spec.class !== undefined ? 'mark' : 'replace'
    const widget = spec.widget instanceof CodeLangWidget ? spec.widget : undefined
    out.push({
      from,
      to,
      kind,
      ...(spec.class === undefined ? {} : { class: spec.class }),
      ...(spec.widget === undefined ? {} : { widget: spec.widget.constructor.name }),
      ...(widget === undefined ? {} : { lang: widget.lang }),
    })
    cursor.next()
  }
  return out
}

function text(doc: string, from: number, to: number): string {
  return doc.slice(from, to)
}

describe('buildRenderDecorations: headings', () => {
  const doc = '# Title'
  it('folds the mark and styles the line when inactive', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace')).toEqual([
      { from: 0, to: 2, kind: 'replace' },
    ])
    expect(doc.slice(2, doc.length)).toBe('Title')
    expect(records.filter(r => r.kind === 'line')).toEqual([
      { from: 0, to: 0, kind: 'line', class: 'cm-md-h1' },
    ])
  })

  it('keeps the mark visible on the active line but keeps the heading style', () => {
    const records = collect(setup(doc, [1]))
    expect(records.filter(r => r.kind === 'replace')).toEqual([])
    expect(records.filter(r => r.kind === 'line')).toEqual([
      { from: 0, to: 0, kind: 'line', class: 'cm-md-h1' },
    ])
  })
})

describe('buildRenderDecorations: inline marks', () => {
  const doc = 'a **strong** b *em* c `code` d [text](https://example.com) e'

  it('folds markers and styles content when the line is inactive', () => {
    const records = collect(setup(doc))
    const folded = records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to))
    expect(folded).toEqual(['**', '**', '*', '*', '`', '`', '[', '](https://example.com)'])
    const styled = new Set(records.filter(r => r.kind === 'mark').map(r => `${r.class}:${text(doc, r.from, r.to)}`))
    expect(styled).toEqual(new Set(['cm-md-strong:strong', 'cm-md-em:em', 'cm-md-code:code', 'cm-md-link:text']))
  })

  it('stays raw on the active line', () => {
    const records = collect(setup(doc, [1]))
    expect(records.filter(r => r.kind !== 'line')).toEqual([])
  })

  it('stays raw when the selection spans the line', () => {
    const spanning = EditorState.create({
      doc,
      extensions,
      selection: { anchor: 0, head: doc.length },
    })
    expect(collect(buildRenderDecorations(spanning, activeLinesOf(spanning)))
      .filter(r => r.kind === 'replace')).toEqual([])
  })
})

describe('buildRenderDecorations: strikethrough', () => {
  const doc = 'a ~~gone~~ b'
  it('folds the marks and strikes the content when the line is inactive', () => {
    const records = collect(setup(doc))
    const folded = records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to))
    expect(folded).toEqual(['~~', '~~'])
    expect(records.filter(r => r.kind === 'mark').map(r => `${r.class}:${text(doc, r.from, r.to)}`))
      .toEqual(['cm-md-strike:gone'])
  })

  it('stays raw on the active line', () => {
    const records = collect(setup(doc, [1]))
    expect(records.filter(r => r.kind !== 'line')).toEqual([])
  })
})

describe('buildRenderDecorations: fenced code', () => {
  const doc = 'before\n```ts title="x"\nconst a = 1;\n```\nafter'

  it('hides the opening and closing fence lines whole, including their line breaks (#47)', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
      .toEqual(['```ts title="x"\n', '```\n'])
    const lines = records.filter(r => r.kind === 'line')
    expect(lines.map(r => doc.slice(0, r.from).split('\n').length)).toEqual([2, 3, 4])
    // Every block line keeps the codeblock class; the tag's first content
    // line additionally carries the positioning class.
    expect(lines.map(r => r.class?.split(' ')[0])).toEqual(Array(3).fill('cm-md-codeblock'))
  })

  it('keeps fences visible while the cursor is inside the block', () => {
    const records = collect(setup(doc, [3]))
    expect(records.filter(r => r.kind === 'replace')).toEqual([])
    expect(records.filter(r => r.kind === 'widget')).toEqual([])
    expect(records.filter(r => r.kind === 'line').length).toBe(3)
  })

  it('swallows the closing fence line break so no blank line remains mid-document (#47)', () => {
    const closed = '```ts\nconst a = 1;\n```\nafter'
    expect(collect(setup(closed)).filter(r => r.kind === 'replace').map(r => text(closed, r.from, r.to)))
      .toEqual(['```ts\n', '```\n'])
  })

  it('folds a document-final closing fence to line end only, leaving one blank line (#47)', () => {
    const final = '```ts\nconst a = 1;\n```'
    expect(collect(setup(final)).filter(r => r.kind === 'replace').map(r => text(final, r.from, r.to)))
      .toEqual(['```ts\n', '```'])
  })

  it('folds an unclosed fence whole when the cursor is elsewhere (#47)', () => {
    const unclosed = 'before\n```py\nopen\ncode'
    expect(collect(setup(unclosed)).filter(r => r.kind === 'replace').map(r => text(unclosed, r.from, r.to)))
      .toEqual(['```py\n'])
    expect(collect(setup(unclosed)).filter(r => r.kind === 'line').map(r => r.class?.split(' ')[0]))
      .toEqual(Array(3).fill('cm-md-codeblock'))
  })

  it('folds a document-final unclosed fence to line end only (#47)', () => {
    const tail = 'before\n```ts'
    expect(collect(setup(tail, [1])).filter(r => r.kind === 'replace').map(r => text(tail, r.from, r.to)))
      .toEqual(['```ts'])
  })

  it('keeps an unclosed fence raw while the cursor is on it', () => {
    const unclosed = 'before\n```py\nopen\ncode'
    const records = collect(setup(unclosed, [2]))
    expect(records.filter(r => r.kind !== 'line')).toEqual([])
    expect(records.filter(r => r.kind === 'line').length).toBe(3)
  })
})

describe('buildRenderDecorations: fenced code language tag (#47)', () => {
  const doc = 'before\n```ts title="x"\nconst a = 1;\n```\nafter'

  it('floats a read-only tag showing the info string first word on the first content line', () => {
    const records = collect(setup(doc)).filter(r => r.kind === 'widget')
    expect(records).toEqual([
      { from: 23, to: 23, kind: 'widget', widget: 'CodeLangWidget', lang: 'ts' },
    ])
  })

  it('tags an unclosed fence too, over its first content line', () => {
    const unclosed = 'before\n```py\nopen\ncode'
    expect(collect(setup(unclosed)).filter(r => r.kind === 'widget')).toEqual([
      { from: 13, to: 13, kind: 'widget', widget: 'CodeLangWidget', lang: 'py' },
    ])
  })

  it('shows no tag for a bare fence without an info string', () => {
    const bare = 'before\n```\ncode\n```\nafter'
    expect(collect(setup(bare)).filter(r => r.kind === 'widget')).toEqual([])
  })

  it('shows no tag for an empty block whose fences are adjacent', () => {
    const empty = 'before\n```py\n```\nafter'
    expect(collect(setup(empty)).filter(r => r.kind === 'widget')).toEqual([])
  })

  it('tags a block whose only content line is blank (the block stays visible)', () => {
    const blank = 'before\n```py\n\n```\nafter'
    expect(collect(setup(blank)).filter(r => r.kind === 'widget')).toEqual([
      { from: 13, to: 13, kind: 'widget', widget: 'CodeLangWidget', lang: 'py' },
    ])
  })

  it('drops the tag while the cursor is inside the block or on a fence line', () => {
    for (const active of [[3], [2], [4]]) {
      expect(collect(setup(doc, active)).filter(r => r.kind === 'widget')).toEqual([])
    }
  })
})

describe('buildRenderDecorations: long document rebuild (#47)', () => {
  it('rebuilds a many-block document within visible-performance bounds', () => {
    const doc = Array.from(
      { length: 200 },
      (_, i) => `\`\`\`ts alpha${i}\nconst v${i} = ${i};\n\`\`\`\nparagraph ${i}.\n`,
    ).join('')
    // The lezer parse is incremental and a bare EditorState only ever sees
    // the partial tree; drive it to completion through a real view (as it
    // settles in a live editor) before measuring the rebuild.
    const view = new EditorView({
      state: EditorState.create({ doc, extensions }),
      parent: document.body,
    })
    try {
      forceParsing(view, doc.length, 10_000)
      const state = view.state
      const started = performance.now()
      const records = collect(buildRenderDecorations(state, new Set<number>()))
      const elapsed = performance.now() - started
      // Every block folds its two fence lines whole (one block replace each)
      // and floats one language tag on its first code line.
      expect(records.filter(r => r.kind === 'replace')).toHaveLength(400)
      expect(records.filter(r => r.kind === 'widget')).toHaveLength(200)
      // Generous ceiling for one whole-document rebuild — far below any
      // perceptible frame cost even on a slow runner; guards against
      // accidental quadratic scans over the decoration set.
      expect(elapsed).toBeLessThan(1000)
    } finally {
      view.destroy()
    }
  })
})

describe('buildRenderDecorations: blockquote', () => {
  const doc = '> quoted\n> more'
  it('folds quote marks with their space and styles the lines', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
      .toEqual(['> ', '> '])
    expect(records.filter(r => r.kind === 'line').every(r => r.class === 'cm-md-quote')).toBe(true)
  })
})

describe('buildRenderDecorations: task lists', () => {
  const doc = '- [ ] todo\n- [x] done\n- plain'
  it('replaces folded task markers with checkbox widgets', () => {
    const records = collect(setup(doc))
    const boxes = records.filter(r => r.kind === 'replace' && r.widget !== undefined)
    expect(boxes.map(r => ({ at: doc.slice(r.from, r.to), widget: r.widget }))).toEqual([
      { at: '[ ]', widget: 'TaskCheckboxWidget' },
      { at: '[x]', widget: 'TaskCheckboxWidget' },
    ])
    expect(records.filter(r => r.kind === 'replace' && r.widget === undefined)).toEqual([])
  })

  it('keeps the raw marker on the active line', () => {
    const records = collect(setup(doc, [1]))
    expect(records.filter(r => r.kind === 'replace').map(r => doc.slice(r.from, r.to)))
      .toEqual(['[x]'])
  })
})

describe('buildRenderDecorations: escapes and plain text', () => {
  it('never folds escaped characters', () => {
    const doc = 'literal \\* star \\`tick'
    expect(collect(setup(doc)).filter(r => r.kind !== 'line')).toEqual([])
  })

  it('returns an empty set for a plain document', () => {
    expect(collect(setup('just some plain text\nsecond line'))).toEqual([])
  })

  it('returns an empty set for an empty document', () => {
    expect(collect(setup(''))).toEqual([])
  })
})
