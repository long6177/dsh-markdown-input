/**
 * Seam 2 tests: the paste layer's decision core. The engine decides, per
 * paste, whether the native host path must stay untouched and when the
 * clipboard HTML converts to clean Markdown and inserts through the
 * version-guarded face — with every guard miss degrading to the native
 * paste, never swallowing the user's clipboard.
 */
import { describe, expect, it } from 'vitest'
import {
  composerEditorRoot, decideRichPaste, insertGuarded, plainPasteGestureTracker,
  readClipboard, type InsertionFace, type PasteClipboard,
} from '../src/client/paste-layer.ts'

/** A clipboard payload summary. */
function clipboard(overrides: Partial<PasteClipboard> = {}): PasteClipboard {
  return { hasFiles: false, html: '', plain: '', ...overrides }
}

describe('decideRichPaste', () => {
  it('leaves file and image pastes to the host intake', () => {
    const rich = clipboard({ hasFiles: true, html: '<p>pic</p>', plain: 'pic' })
    expect(decideRichPaste(rich, false)).toEqual({ action: 'native' })
  })

  it('leaves the plain-paste gesture (Ctrl/Cmd+Shift+V) to the host text path', () => {
    const rich = clipboard({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    expect(decideRichPaste(rich, true)).toEqual({ action: 'native' })
  })

  it('leaves clipboard without an HTML flavor to the host text path', () => {
    expect(decideRichPaste(clipboard({ plain: 'just text' }), false)).toEqual({ action: 'native' })
    expect(decideRichPaste(clipboard({ html: '   ', plain: 'just text' }), false)).toEqual({ action: 'native' })
  })

  it('stays native when conversion would add nothing over the plain text', () => {
    // A plain paragraph converts to exactly the plain flavor; the host paste
    // is identical, so the native path keeps its own paste semantics.
    expect(decideRichPaste(clipboard({ html: '<p>hello</p>', plain: 'hello' }), false))
      .toEqual({ action: 'native' })
    // Plain flavors carry trailing newlines on some sources; trimmed equality.
    expect(decideRichPaste(clipboard({ html: '<p>hello</p>', plain: 'hello\r\n' }), false))
      .toEqual({ action: 'native' })
  })

  it('converts rich HTML the plain flavor cannot represent', () => {
    expect(decideRichPaste(clipboard({ html: '<p><strong>bold</strong></p>', plain: 'bold' }), false))
      .toEqual({ action: 'convert', markdown: '**bold**' })
    expect(decideRichPaste(clipboard({ html: '<h1>Title</h1>', plain: '' }), false))
      .toEqual({ action: 'convert', markdown: '# Title' })
  })

  it('stays native when the HTML carries nothing convertible', () => {
    // An image-only copy drops to empty Markdown; the plain flavor (often the
    // caption) must still paste through the host path.
    const imageOnly = clipboard({ html: '<img src="x.png">', plain: 'x' })
    expect(decideRichPaste(imageOnly, false)).toEqual({ action: 'native' })
  })
})

/** An insertion face with scripted insert results. */
function faceOf(results: boolean[]): { face: InsertionFace, inserts: string[] } {
  const inserts: string[] = []
  return {
    face: {
      captureInsertion: () => ({ start: 0, end: 0, draftRev: 7 }),
      insertText: (text, _span) => {
        inserts.push(text)
        return results[inserts.length - 1] ?? true
      },
    },
    inserts,
  }
}

describe('insertGuarded', () => {
  it('captures the span and inserts in one guarded step', () => {
    const { face, inserts } = faceOf([true])
    expect(insertGuarded(face, '# hi')).toBe(true)
    expect(inserts).toEqual(['# hi'])
  })

  it('re-captures once on a revision miss and succeeds', () => {
    const { face, inserts } = faceOf([false, true])
    expect(insertGuarded(face, 'x')).toBe(true)
    expect(inserts).toEqual(['x', 'x'])
  })

  it('answers false after a second refusal without inserting a third time', () => {
    const { face, inserts } = faceOf([false, false])
    expect(insertGuarded(face, 'x')).toBe(false)
    expect(inserts).toEqual(['x', 'x'])
  })
})

/** A duck-typed DataTransfer for the extraction seam. */
function dataTransfer(
  kinds: readonly string[],
  data: Record<string, string> = {},
): unknown {
  return {
    items: kinds.map(kind => ({ kind })),
    getData: (type: string) => data[type] ?? '',
  }
}

describe('readClipboard', () => {
  it('reports file items and reads both text flavors', () => {
    const read = readClipboard(dataTransfer(['string', 'file', 'string'], {
      'text/html': '<p>hi</p>',
      'text/plain': 'hi',
    }))
    expect(read).toEqual({ hasFiles: true, html: '<p>hi</p>', plain: 'hi' })
  })

  it('answers an empty payload without files when no item is a file', () => {
    const read = readClipboard(dataTransfer(['string'], { 'text/plain': 'text' }))
    expect(read).toEqual({ hasFiles: false, html: '', plain: 'text' })
  })

  it('tolerates a missing clipboard payload and throwing reads', () => {
    expect(readClipboard(null)).toEqual({ hasFiles: false, html: '', plain: '' })
    expect(readClipboard(undefined)).toEqual({ hasFiles: false, html: '', plain: '' })
    const hostile = {
      items: [{ kind: 'string' }],
      getData: () => { throw new Error('denied') },
    }
    expect(readClipboard(hostile)).toEqual({ hasFiles: false, html: '', plain: '' })
  })
})

describe('plainPasteGestureTracker', () => {
  /** A controllable clock for the lookback window. */
  function trackedClock(): { now: () => number, advance: (ms: number) => void } {
    let time = 1000
    return {
      now: () => time,
      advance: ms => { time += ms },
    }
  }

  const plainV = { key: 'v', ctrlKey: true, metaKey: false, shiftKey: true }
  const macV = { key: 'V', ctrlKey: false, metaKey: true, shiftKey: true }

  it('arms on Ctrl/Cmd+Shift+V and expires after the window', () => {
    const clock = trackedClock()
    const gesture = plainPasteGestureTracker(1000, clock.now)
    gesture.keydown(plainV)
    expect(gesture.active()).toBe(true)
    clock.advance(900)
    expect(gesture.active()).toBe(true)
    clock.advance(200)
    expect(gesture.active()).toBe(false)
  })

  it('arms on the macOS Cmd+Shift+V form', () => {
    const clock = trackedClock()
    const gesture = plainPasteGestureTracker(1000, clock.now)
    gesture.keydown(macV)
    expect(gesture.active()).toBe(true)
  })

  it('does not arm on ordinary V or on unshifted chords', () => {
    const clock = trackedClock()
    const gesture = plainPasteGestureTracker(1000, clock.now)
    gesture.keydown({ key: 'v', ctrlKey: true, metaKey: false, shiftKey: false })
    gesture.keydown({ key: 'v', ctrlKey: false, metaKey: false, shiftKey: true })
    gesture.keydown({ key: 'x', ctrlKey: true, metaKey: false, shiftKey: true })
    expect(gesture.active()).toBe(false)
  })
})

describe('composerEditorRoot', () => {
  /** The composer fixture: card with the editor root, dock beside it. */
  function fixture(): { anchor: HTMLElement, editor: HTMLElement } {
    const wrapper = document.createElement('div')
    const card = document.createElement('div')
    const editor = document.createElement('div')
    editor.setAttribute('data-lexical-editor', 'true')
    const dock = document.createElement('div')
    const anchor = document.createElement('span')
    card.appendChild(editor)
    dock.appendChild(anchor)
    wrapper.appendChild(card)
    wrapper.appendChild(dock)
    return { anchor, editor }
  }

  it('finds the composer editor root from the dock anchor', () => {
    const { anchor, editor } = fixture()
    expect(composerEditorRoot(anchor)).toBe(editor)
  })

  it('answers null without an anchor or without an editor in reach', () => {
    expect(composerEditorRoot(null)).toBe(null)
    const lone = document.createElement('span')
    // Detached: no parent chain exists, the walk ends immediately.
    expect(composerEditorRoot(lone)).toBe(null)
  })

  it('answers null when the walk exceeds its bounded hop count', () => {
    // A deep ancestor chain must not walk away into app-level editors.
    let node = document.createElement('div')
    for (let i = 0; i < 12; i += 1) {
      const child = document.createElement('div')
      node.appendChild(child)
      node = child
    }
    const anchor = document.createElement('span')
    node.appendChild(anchor)
    expect(composerEditorRoot(anchor)).toBe(null)
  })
})
