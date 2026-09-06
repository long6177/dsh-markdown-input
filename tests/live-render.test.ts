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
