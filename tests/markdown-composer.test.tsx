/**
 * Seam 1 (composer side): the taken-over card is tested through its public
 * faces — a `useInput` selector, `inputActions`, and `t` — asserting what a
 * user sees and what gets sent, never the editor internals. The attachment
 * and notice faces ride the conversation service gateway (the same runtime
 * face `ctx.conversation` publishes), bound here with a recording fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MarkdownComposer, MARKDOWN_TAKEOVER, MODE_STORAGE_KEY, DRAFT_SYNC_DEBOUNCE_MS, shouldFocusEditorFromCard, type MarkdownComposerProps } from '../src/client/MarkdownComposer.tsx'
import { installConversationSource, setConversationSource } from '../src/client/conversation-face.ts'
import { resetCommandFace, setCommandSource } from '../src/client/command-face.ts'
import { resetGoalFace } from '../src/client/goal-face.ts'
import { onTakeoverDegrade, resetTakeoverDegradation, takeoverDegraded } from '../src/client/degrade.ts'
import { resetFaces } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'
import type { QueueRow } from '../src/client/queue-core.ts'
import { resetSkillFace, setSkillSource } from '../src/client/skill-face.ts'
import { resetAgentPresetsSource, setAgentPresetsSource } from '../src/client/agent-preset-face.ts'
import { resetContextLocale, setContextLocale } from '../src/client/context-meter-face.ts'
import { resetWorkspaceVerbSource, setWorkspaceVerbSource } from '../src/client/workspace-verb.ts'

interface FakeDraft {
  kind: 'file' | 'image'
  id: string
  file: File
}

function fakeConversation(options: {
  uploads?: Record<string, { status: string, loaded?: number }>
  notice?: { level: 'info' | 'error'; text: string; seq: number } | null
  drafts?: readonly FakeDraft[]
  block?: { reason: string }
} = {}) {
  const drafts = options.drafts ?? []
  const created: FakeDraft[] = []
  // Store-contract parity: getSnapshot answers a stable reference between
  // updates, or useSyncExternalStore would loop.
  const uploadsSnapshot = options.uploads ?? {}
  const noticeSnapshot = options.notice ?? null
  const blockSnapshot = options.block
  return {
    cancel: vi.fn(() => Promise.resolve()),
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
    updateQueue: vi.fn((_itemId: string, _action: unknown) => Promise.resolve()),
    fileUploads: {
      subscribe: () => () => {},
      getSnapshot: () => uploadsSnapshot,
    },
    input: {
      shell: vi.fn(() => ({
        notices: { subscribe: () => () => {}, getSnapshot: () => noticeSnapshot },
      })),
    },
    blocks: {
      storeFor: vi.fn(() => ({
        subscribe: () => () => {},
        getSnapshot: () => blockSnapshot,
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
  claim?: { readonly name: string; readonly token: string; readonly hint?: string }
  goal?: unknown
  plan?: unknown
  queue?: readonly QueueRow[]
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
    queue: overrides.queue ?? [],
    claim: overrides.claim,
  }
  const projectionValues: Record<string, unknown> = {
    goal: overrides.goal ?? null,
    plan: overrides.plan,
  }
  return {
    matched: MARKDOWN_TAKEOVER,
    sessionId: 's1',
    session: overrides.session,
    useInput: (selector: (state: typeof inputState) => unknown) => selector(inputState),
    inputActions: inputActions as unknown as MarkdownComposerProps['inputActions'],
    useProjection: ((key: string, selector?: (value: unknown) => unknown) => {
      const value = key in projectionValues ? projectionValues[key] : undefined
      return selector !== undefined ? selector(value) : value
    }) as MarkdownComposerProps['useProjection'],
    t: ((key: keyof typeof en, params?: Record<string, string>) =>
      en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
    ) as unknown as MarkdownComposerProps['t'],
  } as unknown as MarkdownComposerProps
}

function content(): HTMLElement {
  return document.querySelector('.cm-content') as HTMLElement
}

/**
 * The tool row's seats are icon-only (#39), so they are addressed by their
 * accessible name — the same localized copy their tooltip carries.
 */
function seatNamed(label: string): HTMLButtonElement {
  const all = [...document.querySelectorAll('button')]
    .filter((button) => button.getAttribute('aria-label') === label)
  return all[0] as HTMLButtonElement
}

/** The mode toggle's copy: `composer.mode.toggle` filled with the mode it switches TO. */
function modeToggleCopy(mode: 'render' | 'source'): string {
  return en['composer.mode.toggle']
    .replace('{mode}', mode === 'render' ? en['composer.mode.render'] : en['composer.mode.source'])
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
  resetSkillFace()
  resetCommandFace()
  resetGoalFace()
  window.localStorage.clear()
  resetFaces()
  resetTakeoverDegradation()
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
    const { rerender } = render(<MarkdownComposer {...chainProps()} />)
    // Action semantics: the icon-only seat's copy names the mode it switches TO.
    fireEvent.click(seatNamed(modeToggleCopy('source')))
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('source')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    // Icon-only since #39: no text node, one code glyph, copy in aria/title.
    const back = seatNamed(modeToggleCopy('render'))
    expect(back.textContent).toBe('')
    expect(back.querySelector('svg')).not.toBeNull()
    expect(back).toHaveAttribute('title', modeToggleCopy('render'))
    // The same instance keeps the mode across a host rerender (the F5 path —
    // a genuinely fresh mount reading localStorage — is tested below).
    rerender(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    fireEvent.click(seatNamed(modeToggleCopy('render')))
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('render')
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.render'])
  })

  it('a fresh mount restores the persisted mode and it acts on the editor (F5 path)', () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, 'source')
    render(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.source'])
    expect(seatNamed(modeToggleCopy('render'))).toBeInTheDocument()
    // Source mode leaves typed markdown raw — no folding decorations.
    pasteHtml('<h2>标题</h2>')
    expect(document.querySelector('.cm-md-h2')).toBeNull()
    // Switching back acts on the editor immediately.
    fireEvent.click(seatNamed(modeToggleCopy('render')))
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

  it('keeps the icon-only seats localized: the copy follows the active language', () => {
    const zhT = ((key: keyof typeof zh, params?: Record<string, string>) =>
      zh[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
    ) as unknown as MarkdownComposerProps['t']
    const { rerender } = render(<MarkdownComposer {...chainProps({ draft: '写点东西' })} t={zhT} />)
    const zhToggle = zh['composer.mode.toggle'].replace('{mode}', zh['composer.mode.source'])
    expect(seatNamed(zhToggle)).toBeInTheDocument()
    expect(seatNamed(zhToggle)).toHaveAttribute('title', zhToggle)
    expect(seatNamed(zh['composer.action.submit'])).toBeEnabled()
    // A language switch on the same instance relabels both seats, never the glyphs.
    rerender(<MarkdownComposer {...chainProps({ draft: '写点东西' })} />)
    expect(seatNamed(modeToggleCopy('source'))).toBeInTheDocument()
    expect(seatNamed(en['composer.action.submit'])).toBeEnabled()
    expect(document.querySelector(`button[aria-label="${zh['composer.action.submit']}"]`)).toBeNull()
  })

  it('does not send while the input machine is busy', () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    render(<MarkdownComposer {...chainProps({ phase: 'adjudicating', inputActions })} />)
    pasteHtml('<p>text</p>')
    fireEvent.keyDown(content(), { key: 'Enter' })
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.submit).not.toHaveBeenCalled()
    expect(seatNamed(en['composer.action.submit'])).toBeDisabled()
  })

  it('enables submit only with text or attachments', () => {
    const empty = render(<MarkdownComposer {...chainProps()} />)
    expect(seatNamed(en['composer.action.submit'])).toBeDisabled()
    empty.unmount()
    render(<MarkdownComposer {...chainProps({ attachmentIds: ['a1'] as never })} />)
    expect(seatNamed(en['composer.action.submit'])).toBeEnabled()
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
    render(<MarkdownComposer {...chainProps({ inputActions })} />)
    pasteHtml('<ul><li>a</li></ul>')
    fireEvent.click(seatNamed(en['composer.action.submit']))
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
    expect(seatNamed(en['composer.action.submit'])).toBeDisabled()
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

  it('intakes pasted files through the same attachment channel as drops', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    const inputActions = { addAttachments: vi.fn(() => true) }
    const { container } = render(<MarkdownComposer {...chainProps({ inputActions })} />)
    const content = container.querySelector('.cm-content') as HTMLElement
    const file = new File(['x'], 'c.txt')
    fireEvent.paste(content, {
      clipboardData: { items: [{ kind: 'file' }], files: [file], getData: () => '' },
    })
    expect(conversation.createDrafts).toHaveBeenCalledWith('s1', [file])
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

describe('MarkdownComposer editor face degradation (ADR-0005 hardening #2)', () => {
  // The face registry and the card latch are page-lifetime module state;
  // this describe runs its own fresh registration so a latched verdict from
  // the healthy describes above cannot mask the failure paths.
  beforeEach(() => {
    resetFaces()
    resetTakeoverDegradation()
  })

  function withoutSetDraft(): MarkdownComposerProps {
    const props = chainProps()
    // The alpha.0 failure shape: the host runtime boundary moved and one
    // verb the text face mirrors/submits through is gone.
    delete (props.inputActions as unknown as Record<string, unknown>).setDraft
    return props
  }

  it('an editor face probe failure falls back to the native input area', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events: string[] = []
    const unsubscribe = onTakeoverDegrade((event) => {
      events.push(event.reason)
    })
    const { container } = render(<MarkdownComposer {...withoutSetDraft()} />)
    unsubscribe()
    // The card renders nothing (the dispose unmounts it in production) and
    // the unified fallback reported the cause and latched the takeover off.
    expect(container).toBeEmptyDOMElement()
    expect(events).toEqual([expect.stringContaining('editor face probe failed')])
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('reverting to the native composer')))
      .toBe(true)
    expect(takeoverDegraded()).toBe(true)
  })

  it('a missing input hook is intercepted by the probe before the hook runs', () => {
    // The gate sits before the first hook call: a host build whose input
    // hook itself is gone (the alpha.0 failure class) degrades through the
    // editor-face path — it never reaches the hook, so no render exception
    // escapes and the reason names the face, not a generic crash.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const events: string[] = []
    const unsubscribe = onTakeoverDegrade((event) => {
      events.push(event.reason)
    })
    const props = chainProps()
    delete (props as unknown as Record<string, unknown>).useInput
    const { container } = render(<MarkdownComposer {...props} />)
    unsubscribe()
    expect(container).toBeEmptyDOMElement()
    expect(events).toEqual([expect.stringContaining('editor face probe failed')])
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('reverting to the native composer')))
      .toBe(true)
  })

  it('the latched verdict keeps a degraded takeover down across remounts', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first = render(<MarkdownComposer {...withoutSetDraft()} />)
    expect(first.container).toBeEmptyDOMElement()
    first.unmount()
    // A re-elected card with a healthy surface still cannot revive the
    // takeover: the editor face verdict latched for the page life.
    const second = render(<MarkdownComposer {...chainProps()} />)
    expect(second.container).toBeEmptyDOMElement()
  })

  it('a healthy surface keeps the editor face supported', () => {
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('.cm-content')).not.toBeNull()
    expect(takeoverDegraded()).toBe(false)
  })
})

describe('MarkdownComposer — chip decorations and claim ghost (T9)', () => {
  it('keeps slash tokens plain while the skill lexicon face is absent', () => {
    render(<MarkdownComposer {...chainProps({ draft: 'use /plan now' })} />)
    expect(document.querySelector('.cm-mdx-ref-skill')).toBeNull()
  })

  it('decorates a skill token once the lexicon face answers', async () => {
    setSkillSource(() => ({
      skills: {
        list: vi.fn(() => Promise.resolve({
          ok: true as const,
          value: { skills: [{ name: 'plan', description: '', modelInvocable: true }] },
        })),
      },
      remoteEvents: undefined,
    }))
    render(<MarkdownComposer {...chainProps({ draft: 'use /plan now' })} />)
    await waitFor(() => expect(document.querySelector('.cm-mdx-ref-skill')).not.toBeNull())
    expect(document.querySelector('.cm-mdx-ref-skill')?.textContent).toBe('/plan')
  })

  it('shows the goal ghost hint while a goal claim holds on a blank-args draft', () => {
    render(<MarkdownComposer {...chainProps({ draft: '/goal ', phase: 'claimed', claim: { name: 'goal', token: '/goal ', hint: 'machine hint' } })} />)
    expect(document.querySelector('.cm-mdx-claim-token')?.textContent).toBe('/goal')
    expect(document.querySelector('.cm-mdx-claim-hint')?.textContent)
      .toBe(en['composer.hint.goal'])
  })

  it('switches to the active-goal copy while the goal projection is set', () => {
    render(<MarkdownComposer {...chainProps({ draft: '/goal ', phase: 'claimed', claim: { name: 'goal', token: '/goal ' }, goal: { id: 'g1' } })} />)
    expect(document.querySelector('.cm-mdx-claim-hint')?.textContent)
      .toBe(en['composer.hint.goal.active'])
  })

  it('shows the plan copy for a plan claim and the machine hint for other claims', () => {
    const first = render(<MarkdownComposer {...chainProps({ draft: '/plan ', phase: 'claimed', claim: { name: 'plan', token: '/plan ' } })} />)
    expect(document.querySelector('.cm-mdx-claim-hint')?.textContent)
      .toBe(en['composer.hint.plan'])
    first.unmount()
    render(<MarkdownComposer {...chainProps({ draft: '/permission ', phase: 'claimed', claim: { name: 'permission', token: '/permission ', hint: 'choose a preset' } })} />)
    expect(document.querySelector('.cm-mdx-claim-hint')?.textContent).toBe('choose a preset')
  })

  it('drops the ghost hint once the args are typed and when the claim leaves', async () => {
    const props = chainProps({ draft: '/goal ', phase: 'claimed', claim: { name: 'goal', token: '/goal ' } })
    const { rerender } = render(<MarkdownComposer {...props} />)
    expect(document.querySelector('.cm-mdx-claim-hint')).not.toBeNull()
    // Typed args: the machine draft is blank no more — the editor hides the hint.
    rerender(<MarkdownComposer {...chainProps({ draft: '/goal ship it', phase: 'claimed', claim: { name: 'goal', token: '/goal ' } })} />)
    await waitFor(() => expect(document.querySelector('.cm-mdx-claim-hint')).toBeNull())
    expect(document.querySelector('.cm-mdx-claim-token')).not.toBeNull()
    // Claim left (phase plain): both clear.
    rerender(<MarkdownComposer {...chainProps({ draft: '/goal ship it', phase: 'plain' })} />)
    await waitFor(() => expect(document.querySelector('.cm-mdx-claim-token')).toBeNull())
  })
})

describe('MarkdownComposer — chip text round-trip (T9)', () => {
  it('mirrors chip-bearing drafts into the machine draft verbatim (host line format intact)', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const draft = 'see @"path with spaces" + @[Old chat](dsh-session:s-1) + /plan'
    render(<MarkdownComposer {...chainProps({ draft, inputActions })} />)
    // Submit (and the unmount/pagehide flushes) ride setDraft(getText());
    // the chip decorations never touch the text, so the host's own
    // setDraft/restoreDraft contract receives the exact draft.
    fireEvent.click(seatNamed(en['composer.action.submit']))
    await waitFor(() => expect(inputActions.setDraft).toHaveBeenCalledWith(draft))
    expect(inputActions.submit).toHaveBeenCalledTimes(1)
  })
})

describe('MarkdownComposer — queue strip (issue #30)', () => {
  /** A running-session snapshot; `session` is plain data for the card. */
  function queueSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { running: true, subagent: null, pendingSubmissions: [], ...overrides }
  }

  /** chainProps with one durable queued row (rpcId r1). */
  function queuedProps(session: Record<string, unknown> = queueSession()): MarkdownComposerProps {
    return chainProps({
      session,
      queue: [{ id: 'm1', content: [{ type: 'text', text: '排队补充' }], source: { kind: 'user', rpcId: 'r1' } }],
    })
  }

  /** Bind a fake root context whose session scope resolves `conversation` (the queueUpdateOf walk). */
  function installScope(conversation: FakeConversation | undefined): void {
    installConversationSource({
      get: (name: string) => name === 'sessions'
        ? { scope: () => ({ get: (n: string) => n === 'conversation' ? conversation : undefined }) }
        : undefined,
    } as never)
  }

  it('renders nothing while the queue and echoes are empty', () => {
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(container.querySelector('[data-markdown-queue]')).toBeNull()
  })

  it('shows the queued row with its retract path and retracts through updateQueue', async () => {
    const conversation = fakeConversation()
    installScope(conversation)
    const { getByText, getByRole } = render(<MarkdownComposer {...queuedProps()} />)
    const strip = document.querySelector('[data-markdown-queue]')
    expect(strip).not.toBeNull()
    expect(strip).toHaveTextContent('排队补充')
    fireEvent.click(getByRole('button', { name: en['queue.remove'] }))
    await waitFor(() => expect(conversation.updateQueue).toHaveBeenCalledWith('m1', { kind: 'remove' }))
    expect(getByText('排队补充')).toBeInTheDocument()
  })

  it('gates steering on the running state', async () => {
    const idle = render(<MarkdownComposer {...queuedProps(queueSession({ running: false }))} />)
    expect(idle.getByRole('button', { name: en['queue.steer'] })).toBeDisabled()
    idle.unmount()
    const conversation = fakeConversation()
    installScope(conversation)
    const running = render(<MarkdownComposer {...queuedProps()} />)
    const steer = running.getByRole('button', { name: en['queue.steer'] })
    expect(steer).toBeEnabled()
    fireEvent.click(steer)
    await waitFor(() => expect(conversation.updateQueue).toHaveBeenCalledWith('m1', { kind: 'steer' }))
  })

  it('edits a text-only row in place and saves the replacement through updateQueue', async () => {
    const conversation = fakeConversation()
    installScope(conversation)
    const { getByRole } = render(<MarkdownComposer {...queuedProps()} />)
    fireEvent.click(getByRole('button', { name: en['queue.edit'] }))
    const editor = getByRole('textbox', { name: en['queue.edit'] }) as HTMLTextAreaElement
    expect(editor.value).toBe('排队补充')
    fireEvent.change(editor, { target: { value: '排队补充（改）' } })
    fireEvent.keyDown(editor, { key: 'Enter' })
    await waitFor(() => expect(conversation.updateQueue).toHaveBeenCalledWith('m1', {
      kind: 'edit',
      content: [{ type: 'text', text: '排队补充（改）' }],
    }))
  })

  it('marks attachment-bearing rows uneditable and Escape cancels an open edit', () => {
    const conversation = fakeConversation()
    installScope(conversation)
    const attached = render(<MarkdownComposer {...chainProps({
      session: queueSession(),
      queue: [{ id: 'm1', content: [{ type: 'text', text: '带图' }, { type: 'image' }] }],
    })} />)
    expect(attached.getByRole('button', { name: en['queue.edit'] })).toBeDisabled()
    attached.unmount()
    const editable = render(<MarkdownComposer {...queuedProps()} />)
    fireEvent.click(editable.getByRole('button', { name: en['queue.edit'] }))
    const editor = editable.getByRole('textbox', { name: en['queue.edit'] })
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(editable.queryByRole('textbox', { name: en['queue.edit'] })).toBeNull()
    expect(editable.getByText('排队补充')).toBeInTheDocument()
    expect(conversation.updateQueue).not.toHaveBeenCalled()
  })

  it('shows unadmitted queued submissions as sending echoes with disabled actions', () => {
    const conversation = fakeConversation()
    installScope(conversation)
    const { getByText, getByRole } = render(<MarkdownComposer {...chainProps({
      session: queueSession({ pendingSubmissions: [{
        requestId: 'r9', placement: 'queued', time: 0, text: '还在路上', attachments: [],
      }] }),
    })} />)
    expect(getByText('还在路上')).toBeInTheDocument()
    expect(getByText(en['queue.sending'])).toBeInTheDocument()
    expect(getByRole('button', { name: en['queue.remove'] })).toBeDisabled()
    expect(conversation.updateQueue).not.toHaveBeenCalled()
  })

  it('collapses multiple rows behind a count header until expanded', () => {
    const conversation = fakeConversation()
    installScope(conversation)
    const { getByRole, getAllByRole } = render(<MarkdownComposer {...chainProps({
      session: queueSession(),
      queue: [
        { id: 'm1', content: [{ type: 'text', text: '第一条' }] },
        { id: 'm2', content: [{ type: 'text', text: '第二条' }] },
      ],
    })} />)
    const header = getByRole('button', { name: en['queue.count'].replace('{n}', '2') })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-markdown-queue-list]')).toHaveAttribute('hidden')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(document.querySelector('[data-markdown-queue-list]')).not.toHaveAttribute('hidden')
    for (const remove of getAllByRole('button', { name: en['queue.remove'] })) {
      expect(remove).toBeEnabled()
    }
  })

  it('reports a failed mutation on the card banner', async () => {
    const conversation = fakeConversation()
    conversation.updateQueue = vi.fn(() => Promise.reject(new Error('gone')))
    installScope(conversation)
    const { getByRole, findByText } = render(<MarkdownComposer {...queuedProps()} />)
    fireEvent.click(getByRole('button', { name: en['queue.remove'] }))
    expect(await findByText(en['queue.removeFailed'])).toBeInTheDocument()
  })

  it('keeps the edit open for a retry when a save fails', async () => {
    const conversation = fakeConversation()
    conversation.updateQueue = vi.fn(() => Promise.reject(new Error('gone')))
    installScope(conversation)
    const { getByRole, findByText } = render(<MarkdownComposer {...queuedProps()} />)
    fireEvent.click(getByRole('button', { name: en['queue.edit'] }))
    fireEvent.keyDown(getByRole('textbox', { name: en['queue.edit'] }), { key: 'Enter' })
    expect(await findByText(en['queue.editFailed'])).toBeInTheDocument()
    expect(getByRole('textbox', { name: en['queue.edit'] })).toBeInTheDocument()
    expect(conversation.updateQueue).toHaveBeenCalledWith('m1', {
      kind: 'edit',
      content: [{ type: 'text', text: '排队补充' }],
    })
  })

  it('keeps the rows visible without actions when the queue verb is absent', () => {
    installScope(undefined)
    const { getByText, queryByRole } = render(<MarkdownComposer {...queuedProps()} />)
    expect(getByText('排队补充')).toBeInTheDocument()
    expect(queryByRole('button', { name: en['queue.remove'] })).toBeNull()
  })
})

describe('MarkdownComposer — stop actions (issue #32)', () => {
  /** A running-session snapshot; `session` is plain data for the card. */
  function stopSession(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { running: true, subagent: null, pendingSubmissions: [], ...overrides }
  }

  /**
   * Bind the fake conversation the way production resolves it: the root
   * face (blocks registry, notices, attachments) and the session-scope walk
   * (the stopOf/queueUpdateOf verbs). Order matters — the install's root
   * thunk wins otherwise.
   */
  function installStopScope(conversation: FakeConversation | undefined): void {
    installConversationSource({
      get: (name: string) => name === 'sessions'
        ? { scope: () => ({ get: (n: string) => n === 'conversation' ? conversation : undefined }) }
        : undefined,
    } as never)
    setConversationSource(() => conversation)
  }

  it('turns the primary into stop on a running session with an empty composer', async () => {
    const conversation = fakeConversation()
    installStopScope(conversation)
    render(<MarkdownComposer {...chainProps({ session: stopSession() })} />)
    const stop = seatNamed(en['composer.action.stop'])
    expect(stop).toBeEnabled()
    // Icon-only seat (#39): the native square glyph, no text — the copy that
    // used to be the button's label now rides aria and the tooltip.
    expect(stop.textContent).toBe('')
    expect(stop.querySelector('svg rect')).not.toBeNull()
    expect(stop.querySelector('svg path')).toBeNull()
    fireEvent.click(stop)
    await waitFor(() => expect(conversation.cancel).toHaveBeenCalledTimes(1))
  })

  it('reverts the primary to send when the session stops running', () => {
    const view = render(<MarkdownComposer {...chainProps({ session: stopSession() })} />)
    expect(seatNamed(en['composer.action.stop'])).toBeInTheDocument()
    view.rerender(<MarkdownComposer {...chainProps({ session: stopSession({ running: false }) })} />)
    expect(document.querySelector(`button[aria-label="${en['composer.action.stop']}"]`)).toBeNull()
    const send = seatNamed(en['composer.action.submit'])
    expect(send).toBeInTheDocument()
    // The send arm keeps the native arrow glyph (host `InputBar.tsx:490`).
    expect(send.textContent).toBe('')
    expect(send.querySelector('svg path')).not.toBeNull()
    expect(send.querySelector('svg rect')).toBeNull()
  })

  it('keeps the send gesture while an actionable draft is typed on a running session', () => {
    installStopScope(fakeConversation())
    render(<MarkdownComposer {...chainProps({ draft: '排队的话', session: stopSession() })} />)
    const send = seatNamed(en['composer.action.submit'])
    expect(send).toBeInTheDocument()
    expect(send).toBeEnabled()
    expect(seatNamed(en['composer.action.stop'])).toBeUndefined()
  })

  it('renders the stop arm disabled when the cancel verb is absent', () => {
    // Native parity: the stop button sheds its click, never its seat
    // (`disabled: stop === undefined`).
    installStopScope(undefined)
    const { getByRole } = render(<MarkdownComposer {...chainProps({ session: stopSession() })} />)
    expect(getByRole('button', { name: en['composer.action.stop'] })).toBeDisabled()
  })

  it('exposes the dedicated stop on a running continuable child with Send primary', async () => {
    const conversation = fakeConversation()
    installStopScope(conversation)
    const { getByRole } = render(<MarkdownComposer {...chainProps({
      draft: '子会话里的话',
      session: stopSession({ subagent: { address: { mode: 'continuable' } } }),
    })} />)
    const dedicated = getByRole('button', { name: en['composer.action.stop'] })
    expect(dedicated).toBeEnabled()
    // Native dedicated stop: the inline square glyph, the primary stays Send.
    expect(dedicated.querySelector('svg rect')).not.toBeNull()
    expect(seatNamed(en['composer.action.submit'])).toBeInTheDocument()
    fireEvent.click(dedicated)
    await waitFor(() => expect(conversation.cancel).toHaveBeenCalledTimes(1))
  })

  it('keeps nothing dedicated on other subagent address modes', () => {
    installStopScope(fakeConversation())
    const { queryByRole } = render(<MarkdownComposer {...chainProps({
      session: stopSession({ subagent: { address: { mode: 'supervised' } } }),
    })} />)
    expect(queryByRole('button', { name: en['composer.action.stop'] })).toBeNull()
    expect(seatNamed(en['composer.action.submit'])).toBeInTheDocument()
  })

  it('substitutes a raised owner block for the empty composer', async () => {
    const conversation = fakeConversation({ block: { reason: '等待审批' } })
    installStopScope(conversation)
    const { getByRole } = render(<MarkdownComposer {...chainProps({
      draft: '被阻塞时也停',
      session: stopSession(),
    })} />)
    const stop = getByRole('button', { name: en['composer.action.stop'] })
    fireEvent.click(stop)
    await waitFor(() => expect(conversation.cancel).toHaveBeenCalledTimes(1))
  })

  it('reads an absent blocks plane as unblocked', () => {
    const conversation = fakeConversation() as Record<string, unknown>
    delete conversation.blocks
    installStopScope(conversation as never)
    render(<MarkdownComposer {...chainProps({
      draft: '无阻塞面时保持发送',
      session: stopSession(),
    })} />)
    expect(seatNamed(en['composer.action.submit'])).toBeInTheDocument()
  })

  it('swallows a failed cancel without degrading the card', async () => {
    const conversation = fakeConversation()
    conversation.cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    installStopScope(conversation)
    const { getByRole, findByRole } = render(<MarkdownComposer {...chainProps({ session: stopSession() })} />)
    fireEvent.click(getByRole('button', { name: en['composer.action.stop'] }))
    // The rejection rides the Session promptError surface, not the click —
    // the card stays mounted either way (native stop swallows too).
    await findByRole('button', { name: en['composer.action.stop'] })
    expect(document.querySelector('[data-markdown-composer]')).not.toBeNull()
    expect(takeoverDegraded()).toBe(false)
  })

  it('announces a failed stop through the Session promptError', () => {
    setConversationSource(() => fakeConversation())
    const session = stopSession({
      promptError: { op: 'stop', error: { code: 'session/cancel-failed', message: '停止失败' } },
    })
    const { container } = render(<MarkdownComposer {...chainProps({ session })} />)
    const banner = container.querySelector('[data-markdown-banner]')
    expect(banner?.textContent).toContain('停止失败')
    expect(banner?.textContent).toContain('session/cancel-failed')
  })

  it('seats the primary as the native pure-icon circle without a wrapper element', () => {
    render(<MarkdownComposer {...chainProps({ draft: '要发的话' })} />)
    const send = seatNamed(en['composer.action.submit'])
    expect(send.className).toContain('submitButton')
    // The host Tooltip clones its anchor, so the seat stays a direct child of
    // the row: the icon-only box is exactly the flex item the row measures.
    expect(send.parentElement?.className).toContain('toolRow')
    expect(send.textContent).toBe('')
    expect(send.querySelectorAll('svg')).toHaveLength(1)
    expect(send.querySelectorAll('svg path')).toHaveLength(1)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })

  it('opens the same localized copy as a tooltip on the icon-only primary', async () => {
    /** jsdom lacks ResizeObserver; the host Tooltip sizes its bubble through one. */
    class StaticResizeObserver {
      constructor(private readonly callback: (entries: unknown[]) => void) {}
      observe(target: Element): void {
        this.callback([{ target, borderBoxSize: [{ inlineSize: 120, blockSize: 30 }] }])
      }
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', StaticResizeObserver)
    try {
      const view = render(<MarkdownComposer {...chainProps({ draft: '要发的话' })} />)
      fireEvent.mouseOver(seatNamed(en['composer.action.submit']))
      await vi.waitFor(() => {
        expect(document.querySelector('[role="tooltip"]')?.textContent)
          .toBe(en['composer.action.submit'])
      })
      view.unmount()

      installStopScope(fakeConversation())
      render(<MarkdownComposer {...chainProps({ session: stopSession() })} />)
      fireEvent.mouseOver(seatNamed(en['composer.action.stop']))
      await vi.waitFor(() => {
        expect(document.querySelector('[role="tooltip"]')?.textContent)
          .toBe(en['composer.action.stop'])
      })
    } finally {
      vi.stubGlobal('ResizeObserver', undefined)
    }
  })
})

describe('MarkdownComposer — plan chip, goal strip, runtime placeholders (issue #34)', () => {
  const PLAN_ON = { active: true, pending: false }
  const GOAL_SET = {
    goal: { id: 'g1', revision: 1, objective: 'ship the release', phase: 'active', maxGoalRounds: 8 },
  }

  function planChip(): HTMLButtonElement | null {
    return document.querySelector('button[data-markdown-plan-chip]')
  }

  function goalStrip(): HTMLElement | null {
    return document.querySelector('[data-markdown-goal]')
  }

  function bindPlanCommands(execute: ReturnType<typeof vi.fn>): void {
    setCommandSource(() => ({
      commands: { list: vi.fn(), execute }, remoteEvents: undefined,
    }) as never)
  }

  it('mounts the plan chip in the tool row ahead of the mode toggle', () => {
    bindPlanCommands(vi.fn())
    const { container } = render(<MarkdownComposer {...chainProps({ plan: PLAN_ON })} />)
    expect(planChip()).not.toBeNull()
    expect(planChip()!.textContent).toContain(en['plan.chip.label'])
    // Native row order: the plan chip sits in the leading modes cluster,
    // ahead of the trailing controls (here: the icon-only mode toggle stands
    // in — the permission pill's data plane is unbound and its face hides
    // alone).
    const modeButton = seatNamed(modeToggleCopy('source'))
    const row = planChip()!.closest('[class*="toolRow"]')
    expect(row).not.toBeNull()
    expect(container.querySelector('[data-markdown-surface]')).not.toBeNull()
    const rowChildren = [...row!.children]
    expect(rowChildren.indexOf(planChip()!.closest('[class*="planChipWrap"]') as HTMLElement))
      .toBeLessThan(rowChildren.indexOf(modeButton))
  })

  it('renders no plan chip while plan mode is off or absent', () => {
    bindPlanCommands(vi.fn())
    const { unmount } = render(<MarkdownComposer {...chainProps()} />)
    expect(planChip()).toBeNull()
    unmount()
    render(<MarkdownComposer {...chainProps({ plan: { active: false, pending: false } })} />)
    expect(planChip()).toBeNull()
  })

  it('exits plan mode through the native detached line on chip click', async () => {
    const execute = vi.fn(() => Promise.resolve({
      ok: true, value: { result: { kind: 'success' } },
    }))
    bindPlanCommands(execute)
    const { getByRole } = render(<MarkdownComposer {...chainProps({ plan: PLAN_ON })} />)
    fireEvent.click(planChip()!)
    await vi.waitFor(() => {
      expect(execute).toHaveBeenCalledWith('s1', '/plan off', [])
    })
    // The card never degrades over a chip click.
    expect(getByRole('button', { name: en['plan.chip.on.aria'] })).toBeInTheDocument()
  })

  it('renders the goal strip above the queue strip while a goal is set', () => {
    const queue: readonly QueueRow[] = [
      { id: 'q1', content: [{ type: 'text', text: 'queued' }] },
    ]
    const { container } = render(<MarkdownComposer {...chainProps({ goal: GOAL_SET, queue })} />)
    const goal = goalStrip()
    expect(goal).not.toBeNull()
    expect(document.querySelector('[data-markdown-goal-objective]')?.textContent).toBe('ship the release')
    // Native dock order: the goal bar precedes the queue strip in the card.
    const queueStrip = container.querySelector('[data-markdown-queue]')
    expect(queueStrip).not.toBeNull()
    const position = goal!.compareDocumentPosition(queueStrip as Node)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders no goal strip without a goal', () => {
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    expect(goalStrip()).toBeNull()
    expect(container.querySelector('[data-markdown-queue]')).toBeNull()
  })

  it('swaps the placeholder to the plan copy while plan mode is on', () => {
    bindPlanCommands(vi.fn())
    render(<MarkdownComposer {...chainProps({ plan: PLAN_ON })} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.plan'])
  })

  it('swaps the placeholder to the steer-queue copy while running with queued rows', () => {
    const session = { running: true, subagent: null }
    const queue: readonly QueueRow[] = [
      { id: 'q1', content: [{ type: 'text', text: 'queued' }], placement: 'queued' },
    ]
    render(<MarkdownComposer {...chainProps({ session, queue, plan: PLAN_ON })} />)
    // Native ladder: steering a queue outranks plan mode.
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.steerQueue'])
  })

  it('keeps the plan placeholder when the queued rows carry no queued placement (native wire test)', () => {
    const session = { running: true, subagent: null }
    const queue: readonly QueueRow[] = [
      { id: 'q1', content: [{ type: 'text', text: 'queued' }] },
    ]
    render(<MarkdownComposer {...chainProps({ session, queue, plan: PLAN_ON })} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.plan'])
  })

  it('keeps the render-mode copy in the default arm', () => {
    render(<MarkdownComposer {...chainProps()} />)
    expect(content()).toHaveAttribute('aria-placeholder', en['composer.placeholder.render'])
  })
})

describe('MarkdownComposer — hit area (issue #41)', () => {
  const card = (): HTMLElement => document.querySelector('[data-markdown-composer]') as HTMLElement

  /**
   * The editor's focus path, spied at its DOM end: `handle.focus()` →
   * `view.focus()` → `contentDOM.focus()`, so a focus call is the observable
   * "the card focused the editor" event. jsdom has no layout, so this cannot
   * observe the CSS stretch itself (the dead-band click) — that stays a
   * real-device item.
   */
  function spyOnFocus(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(HTMLElement.prototype, 'focus')
  }

  afterEach(() => {
    // The focus spy patches a prototype; put it back so no later test in this
    // file observes a recording focus method.
    vi.restoreAllMocks()
  })

  it('focuses the editor on a mousedown on the card blank area (padding and strip gaps)', () => {
    render(<MarkdownComposer {...chainProps()} />)
    const focus = spyOnFocus()
    // The card root is what the pointer hits on the card's own padding and in
    // the gaps between the strips — the surface the stretch fix cannot cover.
    fireEvent.mouseDown(card())
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus.mock.instances[0]).toBe(content())
    expect(document.activeElement).toBe(content())
  })

  it('does not steal focus from a tool-row button on mousedown', () => {
    render(<MarkdownComposer {...chainProps()} />)
    const before = document.activeElement
    const submit = seatNamed(en['composer.action.submit'])
    const focus = spyOnFocus()
    fireEvent.mouseDown(submit)
    expect(focus).not.toHaveBeenCalled()
    // jsdom does not focus a button on mousedown; what matters is that the
    // card did not move focus to the editor behind the button's back.
    expect(document.activeElement).toBe(before)
    expect(document.activeElement).not.toBe(content())
  })

  it('excludes interactive-element targets, and the button click still fires', async () => {
    // The exclusion walks ancestors: the tool row's mousedowns always land on
    // an interactive element nested in the card, so no arm of the handler may
    // claim them. The click that follows is untouched — the guard never
    // preventDefaults.
    const inputActions = { submit: vi.fn() }
    render(<MarkdownComposer {...chainProps({ draft: 'text', inputActions })} />)
    const submit = seatNamed(en['composer.action.submit'])
    const focus = spyOnFocus()
    // A real event object (not the testing-library return value) so
    // `defaultPrevented` can be read back: the guard must not cancel the
    // native gesture.
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    submit.dispatchEvent(press)
    fireEvent.click(submit)
    expect(focus).not.toHaveBeenCalled()
    expect(press.defaultPrevented).toBe(false)
    // Submit rides a 0ms window after setDraft (submit reads the host's
    // projection), so the click's landing is observed on the timer.
    await waitFor(() => expect(inputActions.submit).toHaveBeenCalledTimes(1))
  })

  it('excludes the editor and its contentDOM, and buttons, from the card focus arm', () => {
    // The unit-level proof of the exclusion rules, with the real mounted
    // editor: a mousedown inside contentDOM belongs to CodeMirror's own
    // caret/selection handling (the card handler staying out of it is what
    // keeps text selection uninstrumented), an interactive element belongs to
    // itself, and only the card's own blank surface gets the focus arm.
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    const surface = content()
    expect(shouldFocusEditorFromCard(surface, surface)).toBe(false)
    expect(shouldFocusEditorFromCard(container.querySelector('.cm-placeholder'), surface)).toBe(false)
    expect(shouldFocusEditorFromCard(seatNamed(en['composer.action.submit']), surface)).toBe(false)
    expect(shouldFocusEditorFromCard(card(), surface)).toBe(true)
    expect(shouldFocusEditorFromCard(null, surface)).toBe(false)
  })

  it('leaves the hidden file input to the native picker, not the editor', () => {
    const conversation = fakeConversation()
    setConversationSource(() => conversation)
    render(<MarkdownComposer {...chainProps()} />)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const focus = spyOnFocus()
    fireEvent.mouseDown(fileInput)
    expect(focus).not.toHaveBeenCalled()
  })

  it('excludes popup items, popup containers and nested button content', () => {
    // The `+` menu and the completion popups portal INTO the card root, so
    // their mousedowns bubble to this handler. Item roles and container roles
    // both have to stand the card down — a mousedown on a popup's own padding
    // must not dismiss it by pulling focus back to the editor — and a glyph
    // inside a button has to walk up to its button.
    const { container } = render(<MarkdownComposer {...chainProps()} />)
    const surface = content()
    const option = document.createElement('div')
    option.setAttribute('role', 'option')
    const listbox = document.createElement('div')
    listbox.setAttribute('role', 'listbox')
    const glyph = document.createElement('span')
    const button = document.createElement('button')
    button.appendChild(glyph)
    container.appendChild(option)
    container.appendChild(listbox)
    container.appendChild(button)
    try {
      expect(shouldFocusEditorFromCard(option, surface)).toBe(false)
      expect(shouldFocusEditorFromCard(listbox, surface)).toBe(false)
      expect(shouldFocusEditorFromCard(glyph, surface)).toBe(false)
    } finally {
      option.remove()
      listbox.remove()
      button.remove()
    }
  })
})

describe('MarkdownComposer — hero row, one line for both seats (issue #42 alpha.12 feedback)', () => {
  // The three `conversation` keys the row reads, the words the host
  // ui-conversation dictionary carries.
  const conversationCopy: Record<string, string> = {
    'hero.chooseWorkspace': 'Choose workspace',
    'placeholder.workspace': 'Choose a workspace to start',
    'workspace.defaultName': 'Workspace',
  }
  const roster = {
    list: () => Promise.resolve({
      ok: true as const,
      value: { presets: [{ id: 'standard', isDefault: true }] },
    }),
    select: () => Promise.resolve({ ok: true as const, value: undefined }),
  }

  it('mounts the workspace row and the agent-preset seat as children of ONE hero line', async () => {
    // The hero line's capability verdict needs the host `conversation` copy
    // and the reuse-or-create verb bound, exactly as apply does.
    setContextLocale(((key: string) => conversationCopy[key] ?? key) as Parameters<typeof setContextLocale>[0])
    setWorkspaceVerbSource(() => ({ startSession: () => {} }))
    setAgentPresetsSource(() => roster)
    const seats = {
      useWorkspaces: (selector: (state: { items: unknown[]; phase: 'ready' }) => unknown) =>
        selector({ items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' }),
      useSessions: (selector: (state: { byId: Record<string, { cwd?: string }> }) => unknown) =>
        selector({ byId: { s1: { cwd: '/home/dev/project' } } }),
    }
    try {
      render(
        <MarkdownComposer
          {...chainProps({
            session: { sessionId: 's1', blank: true, running: false, subagent: null, pendingSubmissions: [] },
          })}
          {...seats}
          // A live `agentPreset` projection key: the preset seat's one hard
          // read (the file's shared chainProps carries no projection table
          // for it).
          useProjection={((key: string, selector?: (value: unknown) => unknown) => {
            const value = key === 'agentPreset' ? null : undefined
            return selector !== undefined ? selector(value) : value
          }) as MarkdownComposerProps['useProjection']}
        />,
      )
      // The native `heroWorkspaceRow` shape: both seats are children of the
      // same flex line container, which is the card's first child — not two
      // stacked card children (the alpha.12 real-device finding).
      const heroRow = document.querySelector('[data-markdown-hero-row]')
      expect(heroRow).not.toBeNull()
      expect(heroRow).toContainElement(document.querySelector('[data-markdown-workspace-row]'))
      await waitFor(() => {
        expect(document.querySelector('[data-markdown-agent-preset]')).not.toBeNull()
      })
      expect(heroRow).toContainElement(document.querySelector('[data-markdown-agent-preset]'))
      expect(document.querySelector('[data-markdown-composer]')?.firstElementChild).toBe(heroRow)
    } finally {
      resetContextLocale()
      resetWorkspaceVerbSource()
      resetAgentPresetsSource()
    }
  })
})
