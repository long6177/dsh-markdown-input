/**
 * Editor-surface tests: key semantics (Enter/Shift+Enter/fence/IME), paste
 * conversion, and the handle's mode/placeholder reconfiguration. These ride
 * a real CodeMirror view mounted in jsdom — the same surface the component
 * mounts — asserting observable document and callback effects only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { createMarkdownEditor, insideOpenFence, type MarkdownEditorHandle } from '../src/client/markdown-editor.ts'

const mounted: MarkdownEditorHandle[] = []

function mount(): { handle: MarkdownEditorHandle, host: HTMLElement, onSubmit: () => void, onDocChange: (text: string) => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const onSubmit = vi.fn()
  const onDocChange = vi.fn()
  const handle = createMarkdownEditor({ parent: host, placeholder: 'ph', mode: 'render', onSubmit, onDocChange })
  mounted.push(handle)
  return { handle, host, onSubmit, onDocChange }
}

afterEach(() => {
  for (const handle of mounted.splice(0)) handle.destroy()
  document.body.innerHTML = ''
})

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

  it('converts pasted HTML into clean Markdown', () => {
    const { handle } = mount()
    const content = document.querySelector('.cm-content') as HTMLElement
    fireEvent.paste(content, {
      clipboardData: {
        getData: (type: string) => type === 'text/html' ? '<h2>标题</h2><p><b>bold</b></p>' : '',
      },
    })
    expect(handle.getText()).toBe('## 标题\n\n**bold**')
  })

  it('leaves the Ctrl+Shift+V plain-text gesture to the default paste path', () => {
    const { handle } = mount()
    const content = document.querySelector('.cm-content') as HTMLElement
    const event = new MouseEvent('paste', { bubbles: true, cancelable: true, ctrlKey: true, shiftKey: true })
    Object.defineProperty(event, 'clipboardData', {
      value: { getData: (type: string) => type === 'text/html' ? '<h2>noise</h2>' : 'raw text' },
    })
    content.dispatchEvent(event)
    // CM6's own paste handler takes over (and preventDefaults); the
    // observable contract is that the plain flavor lands raw, unconverted.
    expect(handle.getText()).toBe('raw text')
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
