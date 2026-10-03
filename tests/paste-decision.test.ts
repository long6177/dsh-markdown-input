/**
 * Seam 2 tests: the paste decision core the CM6 surface drives. The engine
 * decides, per paste, whether the native host path must stay untouched and
 * when the clipboard HTML converts to clean Markdown for the editor's one
 * transaction — with every miss degrading to the native paste, never
 * swallowing the user's clipboard.
 */
import { describe, expect, it } from 'vitest'
import {
  decideRichPaste, plainPasteGestureTracker, readClipboard, type PasteClipboard,
} from '../src/client/paste-decision.ts'

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
    expect(read).toEqual({ hasFiles: true, files: [], html: '<p>hi</p>', plain: 'hi' })
  })

  it('answers an empty payload without files when no item is a file', () => {
    const read = readClipboard(dataTransfer(['string'], { 'text/plain': 'text' }))
    expect(read).toEqual({ hasFiles: false, files: [], html: '', plain: 'text' })
  })

  it('tolerates a missing clipboard payload and throwing reads', () => {
    expect(readClipboard(null)).toEqual({ hasFiles: false, files: [], html: '', plain: '' })
    expect(readClipboard(undefined)).toEqual({ hasFiles: false, files: [], html: '', plain: '' })
    const hostile = {
      items: [{ kind: 'string' }],
      getData: () => { throw new Error('denied') },
    }
    expect(readClipboard(hostile)).toEqual({ hasFiles: false, files: [], html: '', plain: '' })
  })

  it('reads files from the FileList flavor first', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })
    const read = readClipboard({
      files: [file],
      items: [{ kind: 'file' }],
      getData: () => '',
    })
    expect(read.hasFiles).toBe(true)
    expect(read.files).toEqual([file])
  })

  it('extracts files from the item list when the FileList flavor is empty', () => {
    const file = new File(['x'], 'b.png', { type: 'image/png' })
    const read = readClipboard({
      files: [],
      items: [{ kind: 'file', getAsFile: () => file }],
      getData: () => '',
    })
    expect(read.hasFiles).toBe(true)
    expect(read.files).toEqual([file])
  })

  it('reports hasFiles even when the engine hides the extractable file', () => {
    const read = readClipboard({
      files: [],
      items: [{ kind: 'file' }],
      getData: () => '',
    })
    expect(read.hasFiles).toBe(true)
    expect(read.files).toEqual([])
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
