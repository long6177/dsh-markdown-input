/**
 * Seam 1 (composer side): the taken-over card is tested through its public
 * faces — a `useInput` selector, `inputActions`, and `t` — asserting what a
 * user sees and what gets sent, never the editor internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MarkdownComposer, MARKDOWN_TAKEOVER } from '../src/client/MarkdownComposer.tsx'
import type { MarkdownComposerProps } from '../src/client/MarkdownComposer.tsx'
import { en } from '../src/client/locales.ts'

const MODE_KEY = 'dsh-markdown-input.mode'

function chainProps(overrides: {
  draft?: string
  phase?: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  attachmentIds?: string[]
  inputActions?: Partial<Record<'setDraft' | 'submit', ReturnType<typeof vi.fn>>>
} = {}): MarkdownComposerProps {
  const inputActions = {
    setDraft: vi.fn(),
    submit: vi.fn(),
    addAttachments: vi.fn(),
    removeAttachment: vi.fn(),
    pruneAttachments: vi.fn(),
    ...overrides.inputActions,
  }
  const inputState = {
    draft: overrides.draft ?? '',
    phase: overrides.phase ?? 'plain',
    attachmentIds: overrides.attachmentIds ?? [],
    draftRev: 0,
    occurrences: [],
    queue: [],
  }
  return {
    matched: MARKDOWN_TAKEOVER,
    useInput: (selector: (state: typeof inputState) => unknown) => selector(inputState),
    inputActions: inputActions as unknown as MarkdownComposerProps['inputActions'],
    t: ((key: keyof typeof en, params?: Record<string, string>) =>
      en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
    ) as unknown as MarkdownComposerProps['t'],
  } as unknown as MarkdownComposerProps
}

function content(): HTMLElement {
  return document.querySelector('.cm-content') as HTMLElement
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('MarkdownComposer', () => {
  it('mounts the editor surface with the render-mode placeholder', () => {
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[data-markdown-composer]')).toBeInTheDocument()
    expect(container.querySelector('[data-markdown-surface]')?.querySelector('.cm-content')).not.toBeNull()
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.render'])
    expect(container.querySelector('.cm-md-h1')).toBeNull() // empty doc
  })

  it('seeds the editor from the persisted draft', () => {
    render(<MarkdownComposer {...chainProps({ draft: 'seeded draft' })} />)
    expect(content()).toHaveTextContent('seeded draft')
  })

  it('toggles render/source mode and persists the choice', () => {
    const { getByText, rerender } = render(<MarkdownComposer {...chainProps()} />)
    // Action semantics: the button names the mode it switches TO.
    fireEvent.click(getByText(en['composer.mode.source']))
    expect(window.localStorage.getItem(MODE_KEY)).toBe('source')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    // The same instance keeps the mode across a host rerender (the F5 path —
    // a genuinely fresh mount reading localStorage — is tested below).
    rerender(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    fireEvent.click(getByText(en['composer.mode.render']))
    expect(window.localStorage.getItem(MODE_KEY)).toBe('render')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.render'])
  })

  it('a fresh mount restores the persisted mode and it acts on the editor (F5 path)', () => {
    window.localStorage.setItem(MODE_KEY, 'source')
    const { getByText } = render(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    expect(getByText(en['composer.mode.render'])).toBeInTheDocument()
    // Source mode leaves typed markdown raw — no folding decorations.
    fireEvent.paste(content(), {
      clipboardData: { getData: (type: string) => type === 'text/html' ? '<h2>标题</h2>' : '' },
    })
    expect(document.querySelector('.cm-md-h2')).toBeNull()
    // Switching back acts on the editor immediately.
    fireEvent.click(getByText(en['composer.mode.render']))
    expect(document.querySelector('.cm-md-h2')).not.toBeNull()
  })

  it('sends the markdown source through setDraft then submit on Enter', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    render(<MarkdownComposer {...chainProps({ inputActions })} />)
    fireEvent.paste(content(), {
      clipboardData: { getData: (type: string) => type === 'text/html' ? '<h2>标题</h2>' : '' },
    })
    fireEvent.keyDown(content(), { key: 'Enter' })
    await waitFor(() => expect(inputActions.setDraft).toHaveBeenCalledWith('## 标题'))
    await waitFor(() => expect(inputActions.submit).toHaveBeenCalledTimes(1))
  })

  it('does not send while the input machine is busy', () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const { getByText } = render(<MarkdownComposer {...chainProps({ phase: 'adjudicating', inputActions })} />)
    fireEvent.paste(content(), {
      clipboardData: { getData: (type: string) => type === 'text/html' ? '<p>text</p>' : '' },
    })
    fireEvent.keyDown(content(), { key: 'Enter' })
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
    expect(getByText(en['composer.action.submit'])).toBeDisabled()
  })

  it('enables submit only with text or attachments', () => {
    const empty = render(<MarkdownComposer {...chainProps()} />)
    expect(empty.getByText(en['composer.action.submit'])).toBeDisabled()
    empty.unmount()
    const attached = render(<MarkdownComposer {...chainProps({ attachmentIds: ['a1'] as never })} />)
    expect(attached.getByText(en['composer.action.submit'])).toBeEnabled()
  })

  it('flushes the current text to the host draft when a takeover unmounts the card', () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const view = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    fireEvent.paste(content(), {
      clipboardData: { getData: (type: string) => type === 'text/html' ? '<p>草稿内容</p>' : '' },
    })
    view.unmount()
    expect(inputActions.setDraft).toHaveBeenCalledWith('草稿内容')
  })

  it('sends the current document when the submit button is clicked', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const view = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    fireEvent.paste(content(), {
      clipboardData: { getData: (type: string) => type === 'text/html' ? '<ul><li>a</li></ul>' : '' },
    })
    fireEvent.click(view.getByText(en['composer.action.submit']))
    await waitFor(() => expect(inputActions.setDraft).toHaveBeenCalledWith('- a'))
    await waitFor(() => expect(inputActions.submit).toHaveBeenCalledTimes(1))
  })
})
