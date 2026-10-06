/**
 * Editor-surface tests: key semantics (Enter/Shift+Enter/fence/IME), paste
 * conversion, and the handle's mode/placeholder reconfiguration. These ride
 * a real CodeMirror view mounted in jsdom — the same surface the component
 * mounts — asserting observable document and callback effects only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { undo } from '@codemirror/commands'
import { createMarkdownEditor, type EditMode, type MarkdownEditorHandle } from '../src/client/markdown-editor.ts'

const mounted: MarkdownEditorHandle[] = []

function mount(mode: EditMode = 'render'): { handle: MarkdownEditorHandle, host: HTMLElement, onSubmit: () => void, onDocChange: (text: string) => void, onFiles: (files: readonly File[]) => boolean } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onSubmit = vi.fn()
  const onDocChange = vi.fn()
  const onFiles = vi.fn(() => true)
  const handle = createMarkdownEditor({ parent: host, placeholder: 'ph', mode, onSubmit, onDocChange, onFiles })
  mounted.push(handle)
  return { handle, host, onSubmit, onDocChange, onFiles }
}

afterEach(() => {
  for (const handle of mounted.splice(0)) handle.destroy()
  document.body.innerHTML = ''
})

/** The editor's contentDOM, the paste target the takeover surface exposes. */
function content(): HTMLElement {
  return document.querySelector('.cm-content') as HTMLElement
}

/** A paste event with a duck-typed clipboard payload. */
function pasteEvent(clipboard: { html?: string, plain?: string, fileKinds?: readonly string[], files?: readonly File[] }): Event {
  const event = new MouseEvent('paste', { bubbles: true, cancelable: true })
  const items = [
    ...(clipboard.fileKinds ?? []),
    ...(clipboard.html === undefined ? [] : ['string']),
    ...(clipboard.plain === undefined ? [] : ['string']),
  ].map(kind => ({ kind }))
  const data = {
    items,
    files: clipboard.files ?? [],
    getData: (type: string): string =>
      type === 'text/html' ? clipboard.html ?? '' : type === 'text/plain' ? clipboard.plain ?? '' : '',
  }
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

describe('createMarkdownEditor', () => {
  it('mounts a contenteditable surface with the placeholder', () => {
    const { handle, host } = mount()
    expect(host.querySelector('.cm-content')).toBeInTheDocument()
    expect(host.querySelector('.cm-content')).toHaveAttribute('aria-placeholder', 'ph')
    expect(handle.getText()).toBe('')
  })

  it('sends on Enter outside a fence and does not insert a newline', () => {
    const { handle, onSubmit } = mount()
    handle.setText('hello')
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(handle.getText()).toBe('hello')
  })

  it('inserts a newline on Shift+Enter without sending', () => {
    const { handle, onSubmit } = mount()
    handle.setText('hello')
    handle.focus()
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('hello\n')
  })

  it('sends on Enter inside an open fence too (#46 strict send)', () => {
    const { handle, onSubmit } = mount()
    handle.setText('```\ncode')
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(handle.getText()).toBe('```\ncode')
  })

  it('never sends while IME composition is active (editor-level gating)', () => {
    const { handle, onSubmit } = mount()
    handle.setText('nihao')
    const content = document.querySelector('.cm-content') as HTMLElement
    // Real browsers drive this flag through compositionstart plus the
    // document change of the composition itself; CM6 then ignores every key
    // event, so the Enter that confirms candidates reaches nothing here.
    handle.view.inputState.composing = 1
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('nihao')
    handle.view.inputState.composing = -1
  })

  it('never sends while IME composition is active (command guard)', () => {
    const { handle, onSubmit } = mount()
    handle.setText('nihao')
    const content = document.querySelector('.cm-content') as HTMLElement
    // Defense in depth: even if a key event slips past the editor's
    // composition gating, the Enter command consumes it while composing.
    Object.defineProperty(handle.view, 'composing', { value: true })
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('nihao')
  })

  describe('paste (T6 migration of the dock-path semantics)', () => {
    it('converts a rich paste at the caret and one undo step reverts it', () => {
      const { handle } = mount()
      handle.setText('a')
      const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
      content().dispatchEvent(event)
      expect(handle.getText()).toBe('a**bold**')
      expect(event.defaultPrevented).toBe(true)
      expect(undo(handle.view)).toBe(true)
      expect(handle.getText()).toBe('a')
    })

    it('inserts the conversion at the caret, not the document end', () => {
      const { handle } = mount()
      handle.setText('ab')
      handle.view.dispatch({ selection: { anchor: 1 } })
      content().dispatchEvent(pasteEvent({ html: '<h2>标题</h2>', plain: '标题' }))
      expect(handle.getText()).toBe('a## 标题b')
    })

    it('leaves the Ctrl+Shift+V plain-text gesture to the default paste path', () => {
      const { handle } = mount()
      const event = new MouseEvent('paste', { bubbles: true, cancelable: true, ctrlKey: true, shiftKey: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => type === 'text/html' ? '<h2>noise</h2>' : 'raw text' },
      })
      content().dispatchEvent(event)
      // CM6's own paste handler takes over (and preventDefaults); the
      // observable contract is that the plain flavor lands raw, unconverted.
      expect(handle.getText()).toBe('raw text')
    })

    it('leaves the Cmd+Shift+V plain-text gesture to the default paste path', () => {
      const { handle } = mount()
      const event = new MouseEvent('paste', { bubbles: true, cancelable: true, metaKey: true, shiftKey: true })
      Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => type === 'text/html' ? '<h2>noise</h2>' : 'raw text' },
      })
      content().dispatchEvent(event)
      expect(handle.getText()).toBe('raw text')
    })

    it('honors the Ctrl+Shift+V keydown window even when the paste event omits modifiers', () => {
      const { handle } = mount()
      // The validated mechanism from the alpha.2/3 native path: the keydown
      // arms the window, the paste carries no modifier state at all.
      fireEvent.keyDown(content(), { key: 'v', ctrlKey: true, shiftKey: true })
      content().dispatchEvent(pasteEvent({ html: '<h2>noise</h2>', plain: 'raw text' }))
      expect(handle.getText()).toBe('raw text')
    })

    it('extracts files from the item list when the FileList flavor is empty', () => {
      const { handle, onFiles } = mount()
      handle.setText('draft')
      const file = new File(['bits'], 'shot.png', { type: 'image/png' })
      const event = new MouseEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', {
        value: {
          items: [{ kind: 'file', getAsFile: () => file }],
          files: [],
          getData: () => '',
        },
      })
      content().dispatchEvent(event)
      expect(onFiles).toHaveBeenCalledWith([file])
      expect(handle.getText()).toBe('draft')
    })

    it('converts a full web paste: heading, list, link, and bold together', () => {
      const { handle } = mount()
      content().dispatchEvent(pasteEvent({
        html: '<h3>计划</h3><ul><li>第一项</li><li>见<a href="https://example.com">文档</a></li></ul><p><strong>加粗</strong>收尾</p>',
        plain: '计划\n第一项\n见文档\n加粗收尾',
      }))
      expect(handle.getText()).toBe(
        '### 计划\n\n- 第一项\n- 见[文档](https://example.com)\n\n**加粗**收尾',
      )
    })

    it('routes file and image pastes to the host attachment intake', () => {
      const { handle, onFiles } = mount()
      handle.setText('draft')
      const file = new File(['bits'], 'shot.png', { type: 'image/png' })
      const event = pasteEvent({ fileKinds: ['file'], files: [file] })
      content().dispatchEvent(event)
      expect(onFiles).toHaveBeenCalledWith([file])
      expect(event.defaultPrevented).toBe(true)
      expect(handle.getText()).toBe('draft')
    })

    it('does not convert a file paste that also carries an HTML flavor', () => {
      const { handle, onFiles } = mount()
      handle.setText('draft')
      const file = new File(['bits'], 'pic.png', { type: 'image/png' })
      content().dispatchEvent(pasteEvent({ fileKinds: ['file'], files: [file], html: '<p>pic</p>', plain: 'pic' }))
      expect(onFiles).toHaveBeenCalled()
      expect(handle.getText()).toBe('draft')
    })

    it('falls through when the intake refuses the file paste', () => {
      const { handle, onFiles } = mount()
      onFiles.mockReturnValue(false)
      const event = pasteEvent({ fileKinds: ['file'], files: [new File(['x'], 'a.txt', { type: 'text/plain' })] })
      content().dispatchEvent(event)
      // Nothing lands in the text (CM6's default paste does nothing with
      // files either) — the refusal never surfaces as a conversion.
      expect(onFiles).toHaveBeenCalled()
      expect(handle.getText()).toBe('')
    })

    it('leaves plain-text-only pastes to the default paste path', () => {
      const { handle } = mount()
      content().dispatchEvent(pasteEvent({ plain: 'just text' }))
      expect(handle.getText()).toBe('just text')
    })

    it('leaves a conversion that adds nothing over the plain text native', () => {
      const { handle } = mount()
      content().dispatchEvent(pasteEvent({ html: '<p>hello</p>', plain: 'hello' }))
      // The plain paragraph converts to the same text, so the decision core
      // routes native and CM6's own paste lands the plain flavor.
      expect(handle.getText()).toBe('hello')
    })

    it('leaves an HTML-only image paste native instead of mangling it into text', () => {
      const { handle } = mount()
      content().dispatchEvent(pasteEvent({ html: '<p><img src="https://x/y.png"></p>', plain: '' }))
      // The converter drops images, so the conversion would add nothing —
      // the decision core routes native and the document stays empty.
      expect(handle.getText()).toBe('')
    })

    it('leaves a paste without a clipboard payload untouched', () => {
      const { handle } = mount()
      handle.setText('draft')
      const event = new MouseEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: null })
      content().dispatchEvent(event)
      expect(handle.getText()).toBe('draft')
    })
  })

  it('reports document changes through onDocChange', () => {
    const { handle, onDocChange } = mount()
    handle.setText('seeded')
    expect(onDocChange).toHaveBeenCalledWith('seeded')
  })

  it('setMode swaps the live-render decorations and placeholder', () => {
    const { handle, host } = mount()
    handle.setText('# Head')
    expect(host.querySelectorAll('.cm-md-h1').length).toBeGreaterThan(0)
    handle.setMode('source', 'source ph')
    expect(host.querySelectorAll('.cm-md-h1').length).toBe(0)
    expect(host.querySelector('.cm-content')).toHaveAttribute('aria-placeholder', 'source ph')
    handle.setMode('render', 'render ph')
    expect(host.querySelectorAll('.cm-md-h1').length).toBeGreaterThan(0)
    expect(handle.getText()).toBe('# Head')
  })
})

describe('list keys (issue #46, render mode)', () => {
  it('Tab indents the list row by two spaces at the line start', () => {
    const { handle } = mount()
    handle.setText('- item')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Tab' })
    expect(handle.getText()).toBe('  - item')
    // The caret (parked at the end by setText) rides the insert.
    expect(handle.view.state.selection.main.head).toBe('  - item'.length)
  })

  it('Tab falls through outside a list and inside a fence', () => {
    const { handle } = mount()
    handle.setText('hello')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Tab' })
    expect(handle.getText()).toBe('hello')
    handle.setText('```\n- code')
    fireEvent.keyDown(content(), { key: 'Tab' })
    expect(handle.getText()).toBe('```\n- code')
  })

  it('Shift+Tab outdents up to two leading spaces and consumes the key at the margin', () => {
    const { handle } = mount()
    handle.setText('  - deep')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Tab', shiftKey: true })
    expect(handle.getText()).toBe('- deep')
    fireEvent.keyDown(content(), { key: 'Tab', shiftKey: true })
    expect(handle.getText()).toBe('- deep')
  })

  it('a declining menu chain hands Tab to the list indent binding', () => {
    const { handle } = mount()
    handle.setMenuKeyHandler(() => false)
    handle.setText('- x')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Tab' })
    expect(handle.getText()).toBe('  - x')
  })

  it('Shift+Enter exits an empty list item line without inserting a newline', () => {
    const { handle, onSubmit } = mount()
    handle.setText('- ')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('')
    expect(handle.view.state.selection.main.head).toBe(0)
  })

  it('exiting the second item leaves the first intact and parks the caret at the line start', () => {
    const { handle } = mount()
    handle.setText('- a\n- ')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('- a\n')
    expect(handle.view.state.selection.main.head).toBe(4)
  })

  it('exits an empty ordered item and an empty quote line the same way', () => {
    const { handle } = mount()
    handle.setText('1. ')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('')
    handle.setText('> ')
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('')
  })

  it('exits an empty markup line from any caret position on it, line start included (#46)', () => {
    const { handle } = mount()
    handle.setText('- ')
    handle.focus()
    handle.view.dispatch({ selection: { anchor: 0 } })
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('')
    handle.setText('> ')
    handle.view.dispatch({ selection: { anchor: 0 } })
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('')
  })

  it('an empty item inside a quote exits the item only, while one inside a fence keeps the generic newline', () => {
    const { handle } = mount()
    handle.setText('> - ')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('> ')
    handle.setText('```\n- ')
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(handle.getText()).toBe('```\n- \n')
  })

  it('Shift+Enter continues list and quote rows with the next marker', () => {
    const { handle } = mount()
    const cases: readonly [string, string][] = [
      ['- x', '- x\n- '],
      ['* x', '* x\n* '],
      ['1. x', '1. x\n2. '],
      ['1) x', '1) x\n2) '],
      ['> q', '> q\n> '],
      ['- top\n  - inner', '- top\n  - inner\n  - '],
    ]
    for (const [before, after] of cases) {
      handle.setText(before)
      handle.focus()
      fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
      expect(handle.getText()).toBe(after)
      expect(handle.view.state.selection.main.head).toBe(after.length)
    }
  })

  it('Shift+Enter keeps the generic newline inside a fence', () => {
    const { handle, onSubmit } = mount()
    handle.setText('```\ncode')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('```\ncode\n')
  })

  it('folds list markers into dot and computed-number widgets and keeps the source markdown intact', () => {
    const { handle } = mount()
    handle.setText('- a\n1. b\n1. c\nplain tail')
    const marks = [...document.querySelectorAll('.cm-md-listmark')]
    expect(marks.map(el => el.textContent)).toEqual(['•', '1.', '2.'])
    expect(handle.getText()).toBe('- a\n1. b\n1. c\nplain tail')
  })
})

describe('list keys stay out of source mode (#46)', () => {
  it('source mode keeps the plain Shift+Enter newline and no Tab indent', () => {
    const { handle, onSubmit } = mount('source')
    handle.setText('- x')
    handle.focus()
    fireEvent.keyDown(content(), { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('- x\n')
    fireEvent.keyDown(content(), { key: 'Tab' })
    expect(handle.getText()).toBe('- x\n')
  })

  it('Enter still sends in source mode, fence or not', () => {
    const { handle, onSubmit } = mount('source')
    handle.setText('```\ncode')
    fireEvent.keyDown(content(), { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(handle.getText()).toBe('```\ncode')
  })
})

describe('menu key seam', () => {
  it('routes the six menu keys to a registered handler and consumes them', () => {
    const { handle, onSubmit } = mount()
    handle.setText('draft')
    const seen: string[] = []
    handle.setMenuKeyHandler((intent) => {
      seen.push(intent)
      return true
    })
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'ArrowUp' })
    fireEvent.keyDown(content, { key: 'ArrowDown' })
    fireEvent.keyDown(content, { key: 'Enter' })
    fireEvent.keyDown(content, { key: 'Tab' })
    fireEvent.keyDown(content, { key: 'Tab', shiftKey: true })
    fireEvent.keyDown(content, { key: 'Escape' })
    // Tab delivers the drill-or-pick verb (the completion popups' T10
    // semantics); the `+` menu answers it as an ordinary pick.
    expect(seen).toEqual(['up', 'down', 'pick', 'tab', 'close', 'close'])
    // A consumed Enter never sends, and a consumed Tab never indents.
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('draft')
  })

  it('falls through to the editor when the handler declines or is absent', () => {
    const { handle, onSubmit } = mount()
    const content = document.querySelector('.cm-content') as HTMLElement
    // No handler: Enter sends as usual.
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    // A handler returning false leaves the key to the editor's own commands.
    handle.setMenuKeyHandler(() => false)
    handle.setText('second')
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(2)
    handle.setMenuKeyHandler(null)
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(3)
  })

  it('consumes menu keys without acting while IME composition is active', () => {
    const { handle } = mount()
    const seen: string[] = []
    handle.setMenuKeyHandler((intent) => {
      seen.push(intent)
      return true
    })
    const content = document.querySelector('.cm-content') as HTMLElement
    // Defense in depth against a key slipping past the editor's composition
    // gating: the menu keystroke is consumed, the handler never sees it.
    Object.defineProperty(handle.view, 'composing', { value: true })
    fireEvent.keyDown(content, { key: 'ArrowDown' })
    expect(seen).toEqual([])
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(seen).toEqual([])
  })

  it('consults the completion key handler ahead of the + menu handler', () => {
    const { handle } = mount()
    const seen: string[] = []
    handle.setMenuKeyHandler((intent) => { seen.push(`menu:${intent}`); return true })
    handle.setCompletionKeyHandler((intent) => {
      if (intent === 'close') return false // a declined verb falls through
      seen.push(`completion:${intent}`)
      return true
    })
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'ArrowDown' })
    fireEvent.keyDown(content, { key: 'Tab' })
    // The completion handler owns the keys while it accepts them.
    expect(seen).toEqual(['completion:down', 'completion:tab'])
    // A declining completion verb reaches the + menu handler next.
    fireEvent.keyDown(content, { key: 'Escape' })
    expect(seen).toEqual(['completion:down', 'completion:tab', 'menu:close'])
  })
})

describe('completion probe seam', () => {
  it('delivers the live trigger token on document changes, identity-deduped', () => {
    const { handle } = mount()
    const seen: (string | null)[] = []
    handle.setCompletionProbeListener((probe) => { seen.push(probe === null ? null : `${probe.trigger}:${probe.query}`) })
    // Binding delivers the current probe (none on an empty draft).
    expect(seen).toEqual([null])
    handle.setText('/')
    expect(seen).toEqual([null, '/:'])
    // Typing refines the query per keystroke (the caret rides the insert).
    handle.view.dispatch({ changes: { from: 1, insert: 'co' }, selection: { anchor: 3 } })
    expect(seen).toEqual([null, '/:', '/:co'])
    // A selection move that changes nothing emits nothing; leaving the
    // token clears it.
    handle.view.dispatch({ selection: { anchor: 0 } })
    expect(seen).toEqual([null, '/:', '/:co', null])
  })

/** One macrotask later: every pending microtask (CM6's flush, the seam's
 * re-emit, jsdom mutation callbacks) has settled. */
function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

describe('composition-end probe re-emit (#45)', () => {
  it('freezes the probe while IME composition runs and re-emits when the composition ends', async () => {
    const { handle } = mount()
    const seen: (string | null)[] = []
    handle.setCompletionProbeListener((probe) => { seen.push(probe === null ? null : `${probe.trigger}:${probe.query}`) })
    handle.setText('/')
    expect(seen).toEqual([null, '/:'])
    // The real-machine model (Windows Chrome, #45): the IME's composition
    // text enters the DOCUMENT during the composition — CM6 reads each
    // mutation as an input.type.compose transaction, which the composing
    // gate freezes — so at compositionend the DOM and the document already
    // agree and CM6 schedules no flush: no transaction, no updateListener
    // emission. The committed text lands exactly so here.
    handle.view.inputState.composing = 1
    handle.view.dispatch({ changes: { from: 1, insert: 'mo' }, selection: { anchor: 3 } })
    expect(handle.getText()).toBe('/mo')
    expect(seen).toEqual([null, '/:'])
    // The end of the composition is the DOM event alone — no transaction is
    // dispatched around it. CM6's own compositionend observer flips the
    // flag back, and the seam re-emits the committed token one microtask
    // later.
    fireEvent.compositionEnd(content())
    await tick()
    expect(seen).toEqual([null, '/:', '/:mo'])
  })

  it('repeated compositionend events re-emit nothing (identity-deduped)', async () => {
    const { handle } = mount()
    const seen: (string | null)[] = []
    handle.setCompletionProbeListener((probe) => { seen.push(probe === null ? null : `${probe.trigger}:${probe.query}`) })
    handle.setText('@se')
    handle.view.inputState.composing = 1
    handle.view.dispatch({ changes: { from: 3, insert: 'arch' }, selection: { anchor: 7 } })
    // Some IMEs fire compositionend twice in a row; both before the
    // microtask drains, and again long after — each must stay silent.
    fireEvent.compositionEnd(content())
    fireEvent.compositionEnd(content())
    await tick()
    expect(seen).toEqual([null, '@:se', '@:search'])
    fireEvent.compositionEnd(content())
    await tick()
    expect(seen).toEqual([null, '@:se', '@:search'])
  })

  it('a compositionend reaching a destroyed editor stays silent', async () => {
    const { handle } = mount()
    const listener = vi.fn()
    handle.setCompletionProbeListener(listener)
    const el = content()
    handle.destroy()
    // The detached contentDOM keeps its listeners; the event must not
    // produce an emission through the seam.
    fireEvent.compositionEnd(el)
    await tick()
    // The bind-time delivery was the only emission.
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

  it('emits nothing while no listener is bound, then delivers the current probe on bind', () => {
    const { handle } = mount()
    handle.setText('rest @to')
    const listener = vi.fn()
    handle.setCompletionProbeListener(listener)
    // Exactly one bind-time delivery of the live token; further updates
    // re-detect but the identity dedupe holds the line.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      trigger: '@', query: 'to', quoted: false, start: 5, end: 8,
    }))
  })
})

describe('claim helpers', () => {
  it('isLeadingSelection: only whitespace before the caret answers true', () => {
    const { handle } = mount()
    handle.setText('')
    expect(handle.isLeadingSelection()).toBe(true)
    handle.setText('   ')
    expect(handle.isLeadingSelection()).toBe(true)
    handle.setText('hello')
    expect(handle.isLeadingSelection()).toBe(false)
    // A whitespace head before a later caret still leads.
    handle.setText('  tail')
    handle.view.dispatch({ selection: { anchor: 2 } })
    expect(handle.isLeadingSelection()).toBe(true)
  })

  it('claimSelection replaces the document head through the selection end and parks the caret after the token', () => {
    const { handle, onDocChange } = mount()
    handle.setText('hello')
    handle.claimSelection('/goal ')
    expect(handle.getText()).toBe('/goal ')
    expect(handle.view.state.selection.main.head).toBe('/goal '.length)
    expect(onDocChange).toHaveBeenCalledWith('/goal ')
  })

  it('claimSelection keeps text after the selection end (inline spans survive)', () => {
    const { handle } = mount()
    handle.setText('  tail')
    handle.view.dispatch({ selection: { anchor: 2 } })
    handle.claimSelection('/目标 ')
    expect(handle.getText()).toBe('/目标 tail')
    expect(handle.view.state.selection.main.head).toBe('/目标 '.length)
  })
})
