/**
 * Editor-surface tests: key semantics (Enter/Shift+Enter/fence/IME), paste
 * conversion, and the handle's mode/placeholder reconfiguration. These ride
 * a real CodeMirror view mounted in jsdom — the same surface the component
 * mounts — asserting observable document and callback effects only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { undo } from '@codemirror/commands'
import { createMarkdownEditor, insideOpenFence, type MarkdownEditorHandle } from '../src/client/markdown-editor.ts'

const mounted: MarkdownEditorHandle[] = []

function mount(): { handle: MarkdownEditorHandle, host: HTMLElement, onSubmit: () => void, onDocChange: (text: string) => void, onFiles: (files: readonly File[]) => boolean } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onSubmit = vi.fn()
  const onDocChange = vi.fn()
  const onFiles = vi.fn(() => true)
  const handle = createMarkdownEditor({ parent: host, placeholder: 'ph', mode: 'render', onSubmit, onDocChange, onFiles })
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

/** A paste event with a duck-typed clipboard payload (PasteDock's fixture shape). */
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

describe('insideOpenFence', () => {
  it('answers false without any fence', () => {
    expect(insideOpenFence('plain text', 0)).toBe(false)
  })

  it('answers true while the fence is open', () => {
    expect(insideOpenFence('```\ncode', 1)).toBe(true)
    expect(insideOpenFence('text\n```ts\nconst a', 2)).toBe(true)
    expect(insideOpenFence('~~~\nx', 1)).toBe(true)
  })

  it('answers false after the fence closes', () => {
    expect(insideOpenFence('```\ncode\n```\nafter', 3)).toBe(false)
  })

  it('treats a caret on a fence line as inside the block', () => {
    expect(insideOpenFence('```\ncode\n```', 2)).toBe(true)
    expect(insideOpenFence('```', 0)).toBe(true)
  })

  it('ignores inline triple backticks mid-line', () => {
    expect(insideOpenFence('run ```a``` now', 0)).toBe(false)
  })
})

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

  it('inserts a newline on Enter inside an open fence', () => {
    const { handle, onSubmit } = mount()
    handle.setText('```\ncode')
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.keyDown(content, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(handle.getText()).toBe('```\ncode\n')
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

  describe('paste (T6 migration of the PasteDock semantics)', () => {
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
      // PasteDock's validated mechanism: the keydown arms the window, the
      // paste carries no modifier state at all.
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
    expect(seen).toEqual(['up', 'down', 'pick', 'pick', 'close', 'close'])
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
