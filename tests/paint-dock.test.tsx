/**
 * The PaintDock occupant: resolves the composer editor root (with bounded
 * retries for mount-order races) and runs the paint engine over it. The
 * assertions are user-visible behavior: inline styles appear on the native
 * editor without any DOM change, unsupported browsers and a missing editor
 * degrade with a log, and unmount clears everything.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaintDock, PAINT_ROOT_RETRIES, PAINT_ROOT_RETRY_MS } from '../src/client/PaintDock.tsx'
import { PAINT_HIGHLIGHT_NAMES, PAINT_STYLE_ID } from '../src/client/paint-layer.ts'
import { FakeRegistry, installHighlightShim, removeHighlightShim } from './highlight-shim.ts'

/** The five highlight names the engine owns. */
const PAINT_HIGHLIGHTS_COUNT = Object.values(PAINT_HIGHLIGHT_NAMES).length

/** The composer fixture: editor root inside the card, mount point in the dock. */
function composerFixture(): { editor: HTMLElement, card: HTMLElement, mount: HTMLElement } {
  const wrapper = document.createElement('div')
  const card = document.createElement('div')
  const editor = document.createElement('div')
  editor.setAttribute('data-lexical-editor', 'true')
  const paragraph = document.createElement('p')
  const span = document.createElement('span')
  span.setAttribute('data-lexical-text', 'true')
  span.textContent = '**bold** draft'
  paragraph.appendChild(span)
  editor.appendChild(paragraph)
  const dock = document.createElement('div')
  const mount = document.createElement('div')
  card.appendChild(editor)
  dock.appendChild(mount)
  wrapper.appendChild(card)
  wrapper.appendChild(dock)
  document.body.appendChild(wrapper)
  return { editor, card, mount }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (CSS as unknown as { highlights?: unknown }).highlights
  document.body.innerHTML = ''
  document.head.querySelectorAll(`style[data-plugin-css="${PAINT_STYLE_ID}"]`).forEach(el => el.remove())
})

describe('PaintDock', () => {
  it('paints the composer editor without touching its DOM', () => {
    const registry = installHighlightShim()
    const { editor, mount } = composerFixture()
    const domBefore = editor.innerHTML
    render(<PaintDock />, { container: mount })
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
    expect(editor.innerHTML).toBe(domBefore)
  })

  it('retries until the composer editor appears', async () => {
    vi.useFakeTimers()
    const registry = installHighlightShim()
    const { editor, card, mount } = composerFixture()
    editor.remove()
    render(<PaintDock />, { container: mount })
    expect(registry.map.size).toBe(0)
    // The editor mounts late — a few retry ticks in.
    await vi.advanceTimersByTimeAsync(PAINT_ROOT_RETRY_MS * 3)
    card.appendChild(editor)
    await vi.advanceTimersByTimeAsync(PAINT_ROOT_RETRY_MS * 2)
    expect(registry.textOf(PAINT_HIGHLIGHT_NAMES.bold)).toEqual(['bold'])
  })

  it('gives up with a log when the editor never appears', async () => {
    vi.useFakeTimers()
    installHighlightShim()
    const { editor, mount } = composerFixture()
    editor.remove()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      render(<PaintDock />, { container: mount })
      await vi.advanceTimersByTimeAsync(PAINT_ROOT_RETRY_MS * (PAINT_ROOT_RETRIES + 2))
      expect(info).toHaveBeenCalledWith(expect.stringContaining('composer editor not found'))
    } finally {
      info.mockRestore()
    }
  })

  it('disables itself when the Custom Highlight API is missing', () => {
    const registry = new FakeRegistry()
    Object.defineProperty(CSS, 'highlights', { value: registry, configurable: true })
    const { editor, mount } = composerFixture()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      render(<PaintDock />, { container: mount })
      expect(registry.map.size).toBe(0)
      expect(info).toHaveBeenCalledWith(expect.stringContaining('paint layer disabled'))
    } finally {
      info.mockRestore()
    }
  })

  it('stops the engine on unmount and clears the highlights', () => {
    const registry = installHighlightShim()
    const { mount } = composerFixture()
    const view = render(<PaintDock />, { container: mount })
    expect(registry.map.size).toBe(PAINT_HIGHLIGHTS_COUNT)
    view.unmount()
    expect(registry.map.size).toBe(0)
  })
})
