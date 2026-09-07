/**
 * Seam 1 (composer side): the taken-over card is tested through its public
 * faces — a `useInput` selector, `inputActions`, and `t` — asserting what a
 * user sees and what gets sent, never the editor internals. The attachment
 * and notice faces ride the conversation service gateway (the same runtime
 * face `ctx.conversation` publishes), bound here with a recording fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MarkdownComposer, MARKDOWN_TAKEOVER, MODE_STORAGE_KEY, DRAFT_SYNC_DEBOUNCE_MS, type MarkdownComposerProps } from '../src/client/MarkdownComposer.tsx'
import { setConversationSource } from '../src/client/conversation-face.ts'
import { en } from '../src/client/locales.ts'

interface FakeDraft {
  kind: 'file' | 'image'
  id: string
  file: File
}

function fakeConversation(options: {
  uploads?: Record<string, { status: string, loaded?: number }>
  notice?: { level: 'info' | 'error'; text: string; seq: number } | null
  drafts?: readonly FakeDraft[]
} = {}) {
  const drafts = options.drafts ?? []
  const created: FakeDraft[] = []
  // Store-contract parity: getSnapshot answers a stable reference between
  // updates, or useSyncExternalStore would loop.
  const uploadsSnapshot = options.uploads ?? {}
  const noticeSnapshot = options.notice ?? null
  return {
    createDrafts: vi.fn((_sessionId: string, files: readonly File[]): readonly FakeDraft[] => {
      const made = files.map((file, index) => ({ kind: 'file' as const, id: `d${index}`, file }))
      created.push(...made)
      return made
    }),
    resolveDraftAttachments: vi.fn(
      (ids: readonly string[]): readonly FakeDraft[] =>
        [...drafts, ...created].filter((draft) => ids.includes(draft.id)),
    ),
    releaseDraftAttachment: vi.fn(),
    releaseDraftAttachments: vi.fn(),
    retryFileUpload: vi.fn(),
    fileUploads: {
      subscribe: () => () => {},
      getSnapshot: () => uploadsSnapshot,
    },
    input: {
      shell: vi.fn(() => ({
        notices: { subscribe: () => () => {}, getSnapshot: () => noticeSnapshot },
      })),
    },
  }
}

type FakeConversation = ReturnType<typeof fakeConversation>

function chainProps(overrides: {
  draft?: string
  phase?: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  attachmentIds?: string[]
  session?: Record<string, unknown> | undefined
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
    sessionId: 's1',
    session: overrides.session,
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

/** Paste rich-text HTML into the editor surface (the conversion gesture). */
function pasteHtml(html: string): void {
  fireEvent.paste(content(), {
    clipboardData: { getData: (type: string) => type === 'text/html' ? html : '' },
  })
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  setConversationSource(() => undefined)
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
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('source')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    // The same instance keeps the mode across a host rerender (the F5 path —
    // a genuinely fresh mount reading localStorage — is tested below).
    rerender(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    fireEvent.click(getByText(en['composer.mode.render']))
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('render')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.render'])
  })

  it('a fresh mount restores the persisted mode and it acts on the editor (F5 path)', () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'source')
    const { getByText } = render(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    expect(getByText(en['composer.mode.render'])).toBeInTheDocument()
    // Source mode leaves typed markdown raw — no folding decorations.
    pasteHtml('<h2>标题</h2>')
    expect(document.querySelector('.cm-md-h2')).toBeNull()
    // Switching back acts on the editor immediately.
    fireEvent.click(getByText(en['composer.mode.render']))
    expect(document.querySelector('.cm-md-h2')).not.toBeNull()
  })

  it('sends the markdown source through setDraft then submit on Enter', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    render(<MarkdownComposer {...chainProps({ inputActions })} />)
    pasteHtml('<h2>标题</h2>')
    fireEvent.keyDown(content(), { key: 'Enter' })
    await waitFor(() => expect(inputActions.setDraft).toHaveBeenCalledWith('## 标题'))
    await waitFor(() => expect(inputActions.submit).toHaveBeenCalledTimes(1))
  })

  it('does not send while the input machine is busy', () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const { getByText } = render(<MarkdownComposer {...chainProps({ phase: 'adjudicating', inputActions })} />)
    pasteHtml('<p>text</p>')
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
    pasteHtml('<p>草稿内容</p>')
    view.unmount()
    expect(inputActions.setDraft).toHaveBeenCalledWith('草稿内容')
  })

  it('mirrors typed text into the machine draft while mounted (F5 persistence input)', async () => {
    vi.useFakeTimers()
    try {
      const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
      render(<MarkdownComposer {...chainProps({ inputActions })} />)
      // The host persists the draft by mirroring machine-draft changes into
      // its session store; F5 kills the page without a React unmount, so the
      // only way typing survives a reload is a live (debounced) sync.
      pasteHtml('<p>刷新前的一段话</p>')
      await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DEBOUNCE_MS)
      expect(inputActions.setDraft).toHaveBeenCalledWith('刷新前的一段话')
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending draft mirror on submit so the sent text cannot resurrect', async () => {
    vi.useFakeTimers()
    try {
      const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
      const view = render(<MarkdownComposer {...chainProps({ inputActions })} />)
      pasteHtml('<p>已发送的话</p>')
      fireEvent.keyDown(content(), { key: 'Enter' })
      await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DEBOUNCE_MS * 2)
      // One flush from the submit path itself; the debounced mirror behind it
      // must have been cancelled, not re-fill the cleared draft.
      expect(inputActions.setDraft).toHaveBeenCalledTimes(1)
      expect(inputActions.setDraft).toHaveBeenCalledWith('已发送的话')
      expect(inputActions.submit).toHaveBeenCalledTimes(1)
      view.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the current document when the submit button is clicked', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const view = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    pasteHtml('<ul><li>a</li></ul>')
    fireEvent.click(view.getByText(en['composer.action.submit']))
    await waitFor(() => expect(inputActions.setDraft).toHaveBeenCalledWith('- a'))
    await waitFor(() => expect(inputActions.submit).toHaveBeenCalledTimes(1))
  })
})

describe('MarkdownComposer attachments', () => {
  it('hides the attach entry while the conversation face is absent', () => {
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[aria-label="' + en['composer.attach'] + '"]')).toBeNull()
  })

  it('registers picked files as drafts and admits them through addAttachments', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const inputActions = { addAttachments: vi.fn(() => true) }
    const { container } = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    fireEvent.click(container.querySelector('[aria-label="' + en['composer.attach'] + '"]') as HTMLElement)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt')] } })
    expect(conversation.createDrafts).toHaveBeenCalledWith('s1', [expect.any(File)])
    expect(inputActions.addAttachments).toHaveBeenCalledWith(['d0'])
    expect(conversation.releaseDraftAttachments).not.toHaveBeenCalled()
  })

  it('releases created drafts when the machine refuses the admission', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const inputActions = { addAttachments: vi.fn(() => false) }
    const { container } = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt')] } })
    expect(conversation.releaseDraftAttachments).toHaveBeenCalledTimes(1)
  })

  it('shows the attachment rail in input order with a remove control', () => {
    const conversation = fakeConversation({
      drafts: [{ kind: 'image', id: 'd0', file: new File(['x'], 'pic.png') }],
    })
    setConversationSource(() => conversation)
    const { container } = render(
      <MarkdownComposer {...chainProps({ attachmentIds: ['d0'] })} />,
    )
    const rail = container.querySelector('[data-markdown-attachments]')
    expect(rail).not.toBeNull()
    expect(rail?.querySelector('img')).not.toBeNull()
    expect(rail?.textContent).toContain('pic.png')
  })

  it('removes an attachment through removeAttachment and releases the descriptor', () => {
    const conversation = fakeConversation({
      drafts: [{ kind: 'file', id: 'd0', file: new File(['x'], 'a.txt') }],
    })
    setConversationSource(() => conversation)
    const inputActions = { removeAttachment: vi.fn() }
    const { container, getByTitle } = render(
      <MarkdownComposer {...chainProps({ attachmentIds: ['d0'], inputActions })} />,
    )
    fireEvent.click(getByTitle(en['composer.attachment.remove']))
    expect(inputActions.removeAttachment).toHaveBeenCalledWith('d0')
    expect(conversation.releaseDraftAttachment).toHaveBeenCalledWith('d0')
    expect(container.querySelector('[data-markdown-attachments]')).not.toBeNull()
  })

  it('disables removal while a busy phase refuses it', () => {
    const conversation = fakeConversation({
      drafts: [{ kind: 'file', id: 'd0', file: new File(['x'], 'a.txt') }],
    })
    setConversationSource(() => conversation)
    const inputActions = { removeAttachment: vi.fn() }
    const { getByTitle } = render(
      <MarkdownComposer {...chainProps({ attachmentIds: ['d0'], phase: 'submitting', inputActions })} />,
    )
    expect(getByTitle(en['composer.attachment.remove'])).toBeDisabled()
  })

  it('prunes ids whose descriptors are gone', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const inputActions = { pruneAttachments: vi.fn() }
    render(<MarkdownComposer {...chainProps({ attachmentIds: ['ghost'], inputActions })} />)
    expect(inputActions.pruneAttachments).toHaveBeenCalledWith([])
  })

  it('holds the submit gate while a file upload is in flight', () => {
    const conversation = fakeConversation({
      drafts: [{ kind: 'file', id: 'd0', file: new File(['x'], 'a.txt') }],
      uploads: { d0: { status: 'uploading', loaded: 4 } },
    })
    setConversationSource(() => conversation)
    const { getByText } = render(
      <MarkdownComposer {...chainProps({ attachmentIds: ['d0'] })} />,
    )
    expect(getByText(en['composer.file.uploading'])).toBeInTheDocument()
    expect(getByText(en['composer.action.submit'])).toBeDisabled()
  })

  it('offers the retry control for a failed upload', () => {
    const conversation = fakeConversation({
      drafts: [{ kind: 'file', id: 'd0', file: new File(['x'], 'a.txt') }],
      uploads: { d0: { status: 'error', loaded: 0 } },
    })
    setConversationSource(() => conversation)
    const { getByText } = render(
      <MarkdownComposer {...chainProps({ attachmentIds: ['d0'] })} />,
    )
    expect(getByText(en['composer.file.uploadFailed'])).toBeInTheDocument()
    fireEvent.click(getByText(en['composer.file.retry']))
    expect(conversation.retryFileUpload).toHaveBeenCalledWith('s1', 'd0')
  })

  it('intakes dropped files and shows the drop placeholder while dragging', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const inputActions = { addAttachments: vi.fn(() => true) }
    const { container } = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    const card = container.querySelector('[data-markdown-composer]') as HTMLElement
    fireEvent.dragOver(card)
    expect(container.querySelector('[data-markdown-dropzone]')).not.toBeNull()
    fireEvent.drop(card, { dataTransfer: { files: [new File(['x'], 'b.txt')] } })
    expect(container.querySelector('[data-markdown-dropzone]')).toBeNull()
    expect(conversation.createDrafts).toHaveBeenCalledWith('s1', [expect.any(File)])
    expect(inputActions.addAttachments).toHaveBeenCalledWith(['d0'])
  })

  it('refuses intake while busy: the drop placeholder never appears', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const { container } = render(<MarkdownComposer {...chainProps({ phase: 'adjudicating' })} />)
    const card = container.querySelector('[data-markdown-composer]') as HTMLElement
    fireEvent.dragOver(card)
    expect(container.querySelector('[data-markdown-dropzone]')).toBeNull()
    fireEvent.drop(card, { dataTransfer: { files: [new File(['x'], 'b.txt')] } })
    expect(conversation.createDrafts).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="' + en['composer.attach'] + '"]')).toBeDisabled()
  })

  it('read-onlys the editor surface during busy phases like the built-in bar', () => {
    const { container } = render(<MarkdownComposer {...chainProps({ phase: 'submitting' })} />)
    expect(container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('false')
    const plain = render(<MarkdownComposer {...chainProps()} />)
    expect(plain.container.querySelector('.cm-content')?.getAttribute('contenteditable')).toBe('true')
  })
})

describe('MarkdownComposer notices', () => {
  it('surfaces a machine error notice as a banner on the card', () => {
    const conversation = fakeConversation({ notice: { level: 'error', text: '裁决失败', seq: 3 } })
    setConversationSource(() => conversation)
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    const banner = container.querySelector('[data-markdown-banner]')
    expect(banner).not.toBeNull()
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner?.textContent).toContain('裁决失败')
  })

  it('renders degraded when the per-session notice shell is not materialized yet', () => {
    // New-session boot: the composer chain can render before the session
    // binding exists, and the host's InputHub.shell throws then. A render-
    // time throw would take the whole composer seat down.
    const conversation = fakeConversation()
    conversation.input.shell = vi.fn(() => { throw new Error('conversation.input: session "s1" resolved no binding') })
    setConversationSource(() => conversation)
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[data-markdown-composer]')).toBeInTheDocument()
    expect(container.querySelector('[data-markdown-notice]')).toBeNull()
  })

  it('renders the text face only when the service lacks the draft-attachment operations', () => {
    // Host builds where the draft-attachment face moved off the conversation
    // service (upstream 0.1.3 service-boundary work): capability-detect and
    // degrade — the composer seat must never go down over a missing method.
    const conversation = fakeConversation() as Record<string, unknown>
    delete conversation.resolveDraftAttachments
    delete conversation.createDrafts
    setConversationSource(() => conversation as never)
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[data-markdown-composer]')).toBeInTheDocument()
    expect(container.querySelector('[aria-label="' + en['composer.attach'] + '"]')).toBeNull()
  })

  it('renders an information notice inline as a status line', () => {
    const conversation = fakeConversation({ notice: { level: 'info', text: '命令完成', seq: 4 } })
    setConversationSource(() => conversation)
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[data-markdown-banner]')).toBeNull()
    expect(container.querySelector('[data-markdown-notice]')).toHaveAttribute('role', 'status')
    expect(container.querySelector('[data-markdown-notice]')?.textContent).toContain('命令完成')
  })

  it('announces a prompt failure through the Session snapshot', () => {
    setConversationSource(() => fakeConversation())
    const session = {
      promptError: { op: 'send', error: { code: 'session/prompt-failed', message: '发送失败' } },
    }
    const { container } = render(<MarkdownComposer {...chainProps({ session })} />)
    const banner = container.querySelector('[data-markdown-banner]')
    expect(banner?.textContent).toContain('发送失败')
    expect(banner?.textContent).toContain('session/prompt-failed')
  })

  it('announces an attachment-admission prompt failure with the product copy', () => {
    setConversationSource(() => fakeConversation())
    const session = {
      promptError: {
        op: 'send',
        error: { code: 'session/attachment-invalid', message: 'raw', details: { reason: 'tooMany' } },
      },
    }
    const { container } = render(<MarkdownComposer {...chainProps({ session })} />)
    expect(container.querySelector('[data-markdown-banner]')?.textContent).toContain(en['composer.file.rejected'])
  })
})
