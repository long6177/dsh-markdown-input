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
