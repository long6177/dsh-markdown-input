/**
 * Seam tests for the L1 paint engine: editor text collection, syntax-range
 * → DOM-range mapping, highlight registration, and the lifecycle guards —
 * repaint on edit, stop on unmount, latch-off on first failure, auto-disable
 * when the host editor leaves the DOM. Everything runs against a
 * Lexical-shaped fixture with a shimmed Custom Highlight API; jsdom never
 * paints, so assertions read the ranges back out of the shim.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FakeRegistry, installHighlightShim, removeHighlightShim } from './highlight-shim.ts'
import {
  attachPaintLayer, collectPaintText, paintCapability, paintMarks,
  PAINT_HIGHLIGHT_NAMES, PAINT_STYLE_ID,
} from '../src/client/paint-layer.ts'
import { parseInlineMarks } from '../src/client/inline-syntax.ts'

/** A Lexical-shaped composer editor appended to the document body. */
function editorFixture(...blocks: string[]): HTMLElement {
  const editor = document.createElement('div')
  editor.setAttribute('data-lexical-editor', 'true')
  for (const block of blocks) {
    const paragraph = document.createElement('p')
    const span = document.createElement('span')
    span.setAttribute('data-lexical-text', 'true')
    span.textContent = block
    paragraph.appendChild(span)
    editor.appendChild(paragraph)
  }
  document.body.appendChild(editor)
  return editor
}

afterEach(() => {
  removeHighlightShim()
  document.body.innerHTML = ''
  document.head.querySelectorAll(`style[data-plugin-css="${PAINT_STYLE_ID}"]`).forEach(el => el.remove())
})

describe('paintCapability', () => {
  it('supports the Custom Highlight API surface', () => {
    installHighlightShim()
    expect(paintCapability().supported).toBe(true)
  })

  it('refuses when the Highlight class is missing', () => {
    expect(paintCapability().supported).toBe(false)
    expect(paintCapability().reason).toContain('Highlight')
  })
})

describe('collectPaintText', () => {
  it('joins blocks with newlines and records per-node segments', () => {
    const editor = editorFixture('**bold** ok', 'second')
    const paint = collectPaintText(editor)
    expect(paint.text).toBe('**bold** ok\nsecond')
    expect(paint.segments).toHaveLength(2)
    expect(paint.segments[0]).toMatchObject({ start: 0, end: 11 })
    expect(paint.segments[1]).toMatchObject({ start: 12, end: 18 })
  })

  it('concatenates sibling text nodes inside one block', () => {
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    const paragraph = document.createElement('p')
    const first = document.createElement('span')
    first.setAttribute('data-lexical-text', 'true')
    first.textContent = '**bo'
    const second = document.createElement('span')
    second.setAttribute('data-lexical-text', 'true')
    second.textContent = 'ld**'
    paragraph.append(first, second)
    editor.appendChild(paragraph)
    document.body.appendChild(editor)
    const paint = collectPaintText(editor)
    expect(paint.text).toBe('**bold**')
    expect(paint.segments).toHaveLength(2)
    expect(paint.segments[0]).toMatchObject({ start: 0, end: 4 })
    expect(paint.segments[1]).toMatchObject({ start: 4, end: 8 })
  })

  it('keeps an empty block as a bare newline', () => {
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    const full = document.createElement('p')
    full.textContent = 'a'
    const empty = document.createElement('p')
    const br = document.createElement('br')
    empty.appendChild(br)
    editor.append(full, empty, full.cloneNode(true))
    document.body.appendChild(editor)
    expect(collectPaintText(editor).text).toBe('a\n\na')
  })

  it('answers empty for an empty editor', () => {
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    document.body.appendChild(editor)
    const paint = collectPaintText(editor)
    expect(paint.text).toBe('')
    expect(paint.segments).toEqual([])
  })
})

describe('paintMarks', () => {
  it('registers marker dimming and per-type content highlights', () => {
    installHighlightShim()
    const registry = new FakeRegistry()
    const editor = editorFixture('**bold** `c`')
    const paint = collectPaintText(editor)
    paintMarks(parseInlineMarks(paint.text), paint, registry, document)
    // Code-span backticks dim into the shared mark highlight too.
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.mark)).toEqual(['`', '`', '**', '**'])
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.code)).toEqual(['c'])
    // Every name is set every frame, so stale ranges never survive a repaint.
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.italic)).toEqual([])
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.strike)).toEqual([])
    expect([...registry.map.keys()].sort()).toEqual(
      Object.values(PAINT_HIGHLIGHT_NAMES).sort(),
    )
  })

  it('maps one mark across split text nodes onto several ranges', () => {
    installHighlightShim()
    const registry = new FakeRegistry()
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    const paragraph = document.createElement('p')
    const first = document.createElement('span')
    first.setAttribute('data-lexical-text', 'true')
    first.textContent = '**bo'
    const second = document.createElement('span')
    second.setAttribute('data-lexical-text', 'true')
    second.textContent = 'ld**'
    paragraph.append(first, second)
    editor.appendChild(paragraph)
    document.body.appendChild(editor)
    const paint = collectPaintText(editor)
    expect(paint.text).toBe('**bold**')
    paintMarks(parseInlineMarks(paint.text), paint, registry, document)
    // The bold content 'bo|ld' straddles two Lexical text nodes: two ranges.
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bo', 'ld'])
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.mark)).toEqual(['**', '**'])
  })
})

describe('attachPaintLayer', () => {
  /** Flush the observer callback and the coalesced microtask repaint. */
  async function flushPaint(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  it('paints on attach without touching the editor DOM', () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    const editor = editorFixture('**bold** and *it*')
    const domBefore = editor.innerHTML
    const handle = attachPaintLayer(editor, { registry })
    try {
      expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
      expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.italic)).toEqual(['it'])
      expect(editor.innerHTML).toBe(domBefore)
      expect(editor.querySelector('style')).toBeNull()
      // The stylesheet rides the document head, outside the editor.
      expect(document.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`)).not.toBeNull()
    } finally {
      handle.stop()
    }
  })

  it('repaints when the draft changes and clears stale ranges', async () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    const editor = editorFixture('**bold**')
    const handle = attachPaintLayer(editor, { registry })
    try {
      const span = editor.querySelector('span')!
      span.textContent = '*it* now'
      await flushPaint()
      expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual([])
      expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.italic)).toEqual(['it'])
    } finally {
      handle.stop()
    }
  })

  it('stop clears highlights, removes the style, and stops observing', async () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    const editor = editorFixture('**bold**')
    const handle = attachPaintLayer(editor, { registry })
    handle.stop()
    expect(registry.map.size).toBe(0)
    expect(document.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`)).toBeNull()
    const span = editor.querySelector('span')!
    span.textContent = '*it*'
    await flushPaint()
    expect(registry.map.size).toBe(0)
    // Idempotent: a second stop changes nothing.
    expect(() => handle.stop()).not.toThrow()
  })

  it('latches off on the first internal failure and clears the paint', async () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    let setCalls = 0
    const hostile: PaintRegistry = {
      set(name, highlight) {
        setCalls += 1
        throw new Error('registry exploded')
      },
      delete: name => { registry.delete(name) },
    }
    const editor = editorFixture('**bold**')
    const handle = attachPaintLayer(editor, { registry: hostile })
    expect(setCalls).toBe(1)
    const span = editor.querySelector('span')!
    span.textContent = '*it*'
    await flushPaint()
    expect(setCalls).toBe(1)
    expect(registry.map.size).toBe(0)
    handle.stop()
  })

  it('auto-disables when the editor root leaves the DOM', async () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    const editor = editorFixture('**bold**')
    const handle = attachPaintLayer(editor, { registry })
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
    editor.remove()
    await flushPaint()
    expect(registry.map.size).toBe(0)
    expect(document.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`)).toBeNull()
    handle.stop()
  })

  it('stays inert when the Custom Highlight API is missing', () => {
    const registry = new FakeRegistry()
    const editor = editorFixture('**bold**')
    const handle = attachPaintLayer(editor, { registry })
    expect(registry.map.size).toBe(0)
    expect(document.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`)).toBeNull()
    handle.stop()
  })

  it('auto-disables when an ancestor of the editor is removed', async () => {
    installHighlightShim()
    const registry = CSS.highlights as unknown as FakeRegistry
    const wrapper = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    const paragraph = document.createElement('p')
    paragraph.textContent = '**bold**'
    editor.appendChild(paragraph)
    wrapper.appendChild(editor)
    document.body.appendChild(wrapper)
    const handle = attachPaintLayer(editor, { registry })
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
    // The whole composer card goes away — a mutation above the editor.
    wrapper.remove()
    await flushPaint()
    expect(registry.map.size).toBe(0)
    expect(document.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`)).toBeNull()
    handle.stop()
  })
})
