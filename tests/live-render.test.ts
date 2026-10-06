/**
 * Live-render decoration tests at the EditorState seam: the pure
 * `buildRenderDecorations` function is the folding behavior of the editor.
 * Assertions are on what a user would see: which source ranges fold away,
 * which spans take which style, and which lines stay raw.
 */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { Decoration, DecorationSet } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { activeLinesOf, buildRenderDecorations } from '../src/client/live-render.ts'

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
  kind: 'replace' | 'mark' | 'line'
  class?: string
  widget?: string
}

function collect(set: DecorationSet): DecorationRecord[] {
  const out: DecorationRecord[] = []
  const cursor = set.iter()
  while (cursor.value !== null) {
    const { from, to, value } = cursor as { from: number, to: number, value: Decoration }
    const spec = value.spec as { class?: string; widget?: object }
    const kind: DecorationRecord['kind'] = spec.widget !== undefined
      ? 'replace'
      : from === to ? 'line' : spec.class !== undefined ? 'mark' : 'replace'
    out.push({
      from,
      to,
      kind,
      ...(spec.class === undefined ? {} : { class: spec.class }),
      ...(spec.widget === undefined ? {} : { widget: spec.widget.constructor.name }),
    })
    cursor.next()
  }
  return out
}

function text(doc: string, from: number, to: number): string {
  return doc.slice(from, to)
}

/** The widget's rendered text for the replace decoration covering [from, to). */
function labelOf(set: DecorationSet, from: number, to: number): string {
  const cursor = set.iter(from)
  while (cursor.value !== null && cursor.from < to) {
    const spec = cursor.value.spec as { widget?: { toDOM(): HTMLElement } }
    if (spec.widget !== undefined) {
      const dom = spec.widget.toDOM()
      return dom.textContent ?? ''
    }
    cursor.next()
  }
  return ''
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
  const doc = 'before\n```ts\nconst a = 1;\n```\nafter'

  it('folds both fences, keeps the language tag, and styles every block line', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
      .toEqual(['```', '```'])
    const lines = records.filter(r => r.kind === 'line')
    expect(lines.map(r => doc.slice(0, r.from).split('\n').length)).toEqual([2, 3, 4])
    expect(lines.every(r => r.class === 'cm-md-codeblock')).toBe(true)
  })

  it('keeps fences visible while the cursor is inside the block', () => {
    const records = collect(setup(doc, [3]))
    expect(records.filter(r => r.kind === 'replace')).toEqual([])
    expect(records.filter(r => r.kind === 'line').length).toBe(3)
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

describe('buildRenderDecorations: bullet lists (#46)', () => {
  const doc = '- dash\n* star\n+ plus'

  it('folds each marker with its trailing space into the shared dot widget when inactive', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace').map(r => ({ at: text(doc, r.from, r.to), widget: r.widget })))
      .toEqual([
        { at: '- ', widget: 'ListMarkerWidget' },
        { at: '* ', widget: 'ListMarkerWidget' },
        { at: '+ ', widget: 'ListMarkerWidget' },
      ])
  })

  it('keeps the raw marker on the active line but keeps the list row classes', () => {
    const records = collect(setup(doc, [2]))
    // Line 2 ('* star', [7, 14)) is the active one; its neighbours still fold.
    expect(records.filter(r => r.kind === 'replace' && r.from >= 6 && r.to <= 14)).toEqual([])
    const line = records.filter(r => r.kind === 'line').map(r => r.class)
    expect(line).toEqual([
      'cm-md-listitem cm-md-li-d1 cm-md-li-bullet',
      'cm-md-listitem cm-md-li-d1 cm-md-li-bullet',
      'cm-md-listitem cm-md-li-d1 cm-md-li-bullet',
    ])
  })

  it('opens the widget at the line start so the indent spaces fold with the marker', () => {
    const records = collect(setup('  - nested deep'))
    expect(records.filter(r => r.kind === 'replace').map(r => ({ at: text('  - nested deep', r.from, r.to), widget: r.widget })))
      .toEqual([{ at: '  - ', widget: 'ListMarkerWidget' }])
  })

  it('never folds escaped dashes', () => {
    expect(collect(setup('\\- not a list')).filter(r => r.kind !== 'line')).toEqual([])
  })
})

describe('buildRenderDecorations: ordered lists (#46)', () => {
  it('numbers items by position, not by the written source number', () => {
    const doc = '1. a\n1. b\n1. c'
    const set = setup(doc)
    const labels = collect(set).filter(r => r.widget === 'ListMarkerWidget')
      .map(r => labelOf(set, r.from, r.to))
    expect(labels).toEqual(['1.', '2.', '3.'])
  })

  it('keeps multi-digit sources computing the same small sequence', () => {
    const doc = '10. a\n11. b'
    const set = setup(doc)
    const labels = collect(set).filter(r => r.widget === 'ListMarkerWidget')
      .map(r => labelOf(set, r.from, r.to))
    expect(labels).toEqual(['1.', '2.'])
  })

  it('keeps each item’s own `)` suffix while the number still computes', () => {
    const doc = '1) x\n1) y'
    const set = setup(doc)
    const labels = collect(set).filter(r => r.widget === 'ListMarkerWidget')
      .map(r => labelOf(set, r.from, r.to))
    expect(labels).toEqual(['1)', '2)'])
  })

  it('counts each nested ordered list independently', () => {
    const doc = '1. a\n   1. x\n   1. y\n2. b'
    const set = setup(doc)
    const labels = collect(set).filter(r => r.widget === 'ListMarkerWidget')
      .map(r => labelOf(set, r.from, r.to))
    expect(labels).toEqual(['1.', '1.', '2.', '2.'])
  })
})

describe('buildRenderDecorations: nested lists (#46)', () => {
  const doc = '- top\n  - inner\n- top2'

  it('indents nested rows by depth class while the markers fold per level', () => {
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'line').map(r => r.class)).toEqual([
      'cm-md-listitem cm-md-li-d1 cm-md-li-bullet',
      'cm-md-listitem cm-md-li-d2 cm-md-li-bullet',
      'cm-md-listitem cm-md-li-d1 cm-md-li-bullet',
    ])
    expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
      .toEqual(['- ', '  - ', '- '])
  })

  it('caps the depth class at six levels', () => {
    const deep = '- l1\n  - l2\n    - l3\n      - l4\n        - l5\n          - l6\n            - l7'
    const classes = collect(setup(deep)).filter(r => r.kind === 'line').map(r => r.class)
    expect(classes.some(c => c.includes('cm-md-li-d7'))).toBe(false)
    expect(classes.filter(c => c.includes('cm-md-li-d6')).length).toBe(2)
  })
})

describe('buildRenderDecorations: lists in blockquotes (#46)', () => {
  it('folds the quote mark and the marker without overlapping replaces', () => {
    const doc = '> - x'
    const replaces = collect(setup(doc)).filter(r => r.kind === 'replace').sort((a, b) => a.from - b.from)
    expect(replaces.map(r => ({ at: text(doc, r.from, r.to), widget: r.widget }))).toEqual([
      { at: '> ', widget: undefined },
      { at: '- ', widget: 'ListMarkerWidget' },
    ])
    for (let i = 1; i < replaces.length; i++) {
      expect(replaces[i]!.from).toBeGreaterThanOrEqual(replaces[i - 1]!.to)
    }
  })
})

describe('buildRenderDecorations: task lists', () => {
  const doc = '- [ ] todo\n- [x] done\n- plain'
  it('replaces folded task markers with checkbox widgets beside the dot widget', () => {
    const records = collect(setup(doc))
    const boxes = records.filter(r => r.kind === 'replace' && r.widget === 'TaskCheckboxWidget')
    expect(boxes.map(r => ({ at: doc.slice(r.from, r.to), widget: r.widget }))).toEqual([
      { at: '[ ]', widget: 'TaskCheckboxWidget' },
      { at: '[x]', widget: 'TaskCheckboxWidget' },
    ])
    const dots = records.filter(r => r.kind === 'replace' && r.widget === 'ListMarkerWidget')
    expect(dots.map(r => doc.slice(r.from, r.to))).toEqual(['- ', '- ', '- '])
  })

  it('keeps the raw markers on the active line', () => {
    const records = collect(setup(doc, [1]))
    expect(records.filter(r => r.kind === 'replace').map(r => doc.slice(r.from, r.to)))
      .toEqual(['- ', '[x]', '- '])
  })
})

describe('buildRenderDecorations: horizontal rules (issue #48)', () => {
  it('folds each of the three marker characters into an hr line when inactive', () => {
    for (const marker of ['---', '***', '___']) {
      const doc = marker
      const records = collect(setup(doc))
      expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
        .toEqual([marker])
      expect(records.filter(r => r.kind === 'line')).toEqual([
        { from: 0, to: 0, kind: 'line', class: 'cm-md-hr' },
      ])
    }
  })

  it('folds the GFM space variants the parser accepts', () => {
    for (const marker of ['- - -', '   ---   ']) {
      const doc = marker
      const records = collect(setup(doc))
      const folded = records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to))
      // The node range is what folds: `- - -` whole, `---` with its trailing
      // spaces (the leading indent is not part of the node and stays visible).
      expect(folded).toEqual([marker.replace(/^\s+/, '')])
      expect(records.filter(r => r.kind === 'line').every(r => r.class === 'cm-md-hr')).toBe(true)
    }
  })

  it('keeps the raw marker and paints no hairline class on the active line', () => {
    const records = collect(setup('---', [1]))
    expect(records.filter(r => r.kind !== 'line')).toEqual([])
    expect(records.filter(r => r.kind === 'line' && r.class === 'cm-md-hr')).toEqual([])
  })

  it('never mistakes a setext heading underline for a rule', () => {
    const doc = 'Title\n---'
    const records = collect(setup(doc))
    expect(records.filter(r => r.kind === 'replace')).toEqual([])
    expect(records.filter(r => r.kind === 'line' && r.class === 'cm-md-hr')).toEqual([])
    // The setext pair still takes its heading shape (existing contract).
    expect(records.filter(r => r.kind === 'line').every(r => r.class === 'cm-md-h2')).toBe(true)
  })

  it('judges rules inside lists and quotes by the syntax node, not the line text', () => {
    // The rule node folds wherever the parser puts it; the quote mark's own
    // fold is the existing contract and folds alongside it. Since #46 the
    // list mark folds too — a rule inside an ordered item sits behind the
    // item's computed-ordinal widget, two non-overlapping replaces.
    const cases: ReadonlyArray<[string, string[]]> = [
      ['1. ---', ['1. ', '---']],
      ['> ---', ['> ', '---']],
    ]
    for (const [doc, expected] of cases) {
      const records = collect(setup(doc))
      expect(records.filter(r => r.kind === 'replace').map(r => text(doc, r.from, r.to)))
        .toEqual(expected)
      // The rule line takes the hairline class; a quote's own `cm-md-quote`
      // may ride along (the rule folds inside the quote's block styling),
      // and on a list row the #46 listitem classes share the same line.
      expect(records.filter(r => r.kind === 'line').every(r => r.class?.split(' ').includes('cm-md-hr')))
        .toBe(true)
    }
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
