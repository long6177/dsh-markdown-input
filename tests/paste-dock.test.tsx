/**
 * Seam 1 (composer side): the PasteDock occupant — the DOM wiring that
 * turns composer paste events into guarded Markdown insertions. The
 * assertions are user-visible behavior: a rich paste converts and inserts
 * in one step and cancels the native route; plain, file, gesture, refused,
 * and out-of-place pastes all keep the host's own behavior.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PasteDock } from '../src/client/PasteDock.tsx'
import type { InsertionFace } from '../src/client/paste-layer.ts'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

/** The composer fixture: editor root inside the card, mount point in the dock. */
function composerFixture(): { editor: HTMLElement, mount: HTMLElement } {
  const wrapper = document.createElement('div')
  const card = document.createElement('div')
  const editor = document.createElement('div')
  editor.setAttribute('data-lexical-editor', 'true')
  const dock = document.createElement('div')
  const mount = document.createElement('div')
  card.appendChild(editor)
  dock.appendChild(mount)
  wrapper.appendChild(card)
  wrapper.appendChild(dock)
  document.body.appendChild(wrapper)
  return { editor, mount }
}

/** A scripted insertion face recording its calls. */
function faceMock(insert: (text: string) => boolean = () => true): {
  face: InsertionFace
  inserts: string[]
} {
  const inserts: string[] = []
  const face: InsertionFace = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 3 }),
    insertText: (text, _span) => {
      inserts.push(text)
      return insert(text)
    },
  }
  return { face, inserts }
}

/** A paste event with a duck-typed clipboard payload. */
function pasteEvent(clipboard: { html?: string, plain?: string, fileKinds?: readonly string[] }): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  const items = [
    ...(clipboard.fileKinds ?? []),
    ...(clipboard.html === undefined ? [] : ['string']),
    ...(clipboard.plain === undefined ? [] : ['string']),
  ].map(kind => ({ kind }))
  const data = {
    items,
    getData: (type: string): string =>
      type === 'text/html' ? clipboard.html ?? '' : type === 'text/plain' ? clipboard.plain ?? '' : '',
  }
  Object.defineProperty(event, 'clipboardData', { value: data })
  return event
}

describe('PasteDock', () => {
  it('converts a rich paste and inserts it through the guarded face', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    editor.dispatchEvent(event)
    expect(inserts).toEqual(['**bold**'])
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves the Ctrl/Cmd+Shift+V gesture to the native plain paste', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'v', ctrlKey: true, shiftKey: true, bubbles: true,
    }))
    const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    editor.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves file and image pastes to the host intake', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    const event = pasteEvent({ html: '<p>pic</p>', plain: 'pic', fileKinds: ['file'] })
    editor.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves plain-text-only pastes native', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    const event = pasteEvent({ plain: 'just text' })
    editor.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves pastes outside the composer editor native', () => {
    const { mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    const stray = document.createElement('div')
    document.body.appendChild(stray)
    const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    stray.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('degrades to the native paste when the guarded insertion refuses', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock(() => false)
    render(<PasteDock inputActions={face} />, { container: mount })
    const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    editor.dispatchEvent(event)
    expect(inserts).toEqual(['**bold**', '**bold**'])
    expect(event.defaultPrevented).toBe(false)
  })

  it('stays native with a keyboard-only clipboard payload', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    render(<PasteDock inputActions={face} />, { container: mount })
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: null })
    editor.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('disables itself when the face lacks the guarded verbs', () => {
    const { editor, mount } = composerFixture()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const { face, inserts } = faceMock()
      render(<PasteDock inputActions={{ nope: face }} />, { container: mount })
      const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
      editor.dispatchEvent(event)
      expect(inserts).toEqual([])
      expect(event.defaultPrevented).toBe(false)
      expect(info).toHaveBeenCalledWith(expect.stringContaining('paste layer disabled'))
    } finally {
      info.mockRestore()
    }
  })

  it('removes its listeners on unmount', () => {
    const { editor, mount } = composerFixture()
    const { face, inserts } = faceMock()
    const view = render(<PasteDock inputActions={face} />, { container: mount })
    view.unmount()
    const event = pasteEvent({ html: '<p><strong>bold</strong></p>', plain: 'bold' })
    editor.dispatchEvent(event)
    expect(inserts).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })
})
