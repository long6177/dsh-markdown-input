/**
 * Seam: the typed-trigger completion popups as the user sees them (T10).
 * Pins the probe-driven open/close contract (the dismissed-memory settle,
 * the guard tiers), the two candidate groups (sectioned `+`-menu rows plus
 * the ranked skill roll for `/`; searched file candidates for `@` with
 * stale-while-revalidate), the combobox keyboard through the completion key
 * seam (↑/↓ cycle, Enter pick, Tab drill, pending consumption), the pick
 * dispatch (claim token / detached execute / chained popup / file intake /
 * skill token / file mention with drill), the aria wiring, and — over a
 * real CodeMirror view — the insertion→T9-decoration linkage the ticket
 * demands (insert → dictionary hit → chip).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { CompletionFace, completionFaceDefinition, type CompletionFaceProps } from '../src/client/CompletionFace.tsx'
import { resetCommandFace, setCommandSource } from '../src/client/command-face.ts'
import { resetFileReferenceFace, setFileReferenceSource } from '../src/client/file-reference-face.ts'
import { resetSkillFace, setSkillSource } from '../src/client/skill-face.ts'
import { createMarkdownEditor, type CompletionProbeListener, type MarkdownEditorHandle, type MenuKeyHandler } from '../src/client/markdown-editor.ts'
import type { CompletionProbe } from '../src/client/completion-core.ts'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'

function fakeT(locale: Record<string, string>): CompletionFaceProps['t'] {
  return ((key: string, params?: Record<string, string>) => {
    const template = locale[key] ?? key
    return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
  }) as CompletionFaceProps['t']
}
const tZh = fakeT(zh)

function probe(partial: Partial<CompletionProbe>): CompletionProbe {
  return { trigger: '/', query: '', quoted: false, position: 'leading', start: 0, end: 1, ...partial }
}

/** Build a recording editor stub; the captured seams drive the behavior tests. */
function stubEditor(leading = true) {
  let completionHandler: MenuKeyHandler | null = null
  let probeListener: CompletionProbeListener | null = null
  const dispatch = vi.fn()
  const editor = {
    focus: vi.fn(),
    isLeadingSelection: vi.fn(() => leading),
    claimSelection: vi.fn(),
    view: { dispatch },
    setMenuKeyHandler: vi.fn(),
    setCompletionKeyHandler: vi.fn((handler: MenuKeyHandler | null) => { completionHandler = handler }),
    setCompletionProbeListener: vi.fn((listener: CompletionProbeListener | null) => { probeListener = listener }),
  }
  return {
    editor,
    editorRef: { current: editor as unknown as MarkdownEditorHandle } as RefObject<MarkdownEditorHandle | null>,
    handler: () => completionHandler,
    emit: (next: CompletionProbe | null) => probeListener?.(next),
    dispatch,
  }
}

interface MountOptions {
  sessionId?: string | undefined
  leading?: boolean
  locale?: 'zh' | 'en'
  guard?: 'plain' | 'claimed' | 'frozen'
  fileResults?: readonly { path: string, kind: 'file' | 'directory' }[]
  fileSearch?: ReturnType<typeof vi.fn>
  executeResult?: unknown
  /** Landed skill roll; absent = the lexicon read stays pending (skeleton). */
  skills?: readonly { name: string, description?: string, modelInvocable?: boolean }[]
}

function mountFace(options: MountOptions = {}) {
  const onError = vi.fn()
  const onPickFiles = vi.fn()
  const registerClose = vi.fn()
  const onOpen = vi.fn()
  // The command catalog read stays pending: the popup shows the static
  // fallback rows deterministically.
  const commandExecute = vi.fn(() => Promise.resolve(options.executeResult ?? {
    ok: true, value: { commandId: 'c1', result: { kind: 'success' } },
  }))
  setCommandSource(() => ({
    commands: {
      list: vi.fn(() => new Promise(() => {})),
      execute: commandExecute,
    },
    remoteEvents: { $on: vi.fn(() => () => {}) },
  }))
  setSkillSource(() => ({
    skills: {
      list: options.skills === undefined
        ? vi.fn(() => new Promise(() => {}))
        : vi.fn(() => Promise.resolve({ ok: true, value: { skills: options.skills! } })),
    },
    remoteEvents: { $on: vi.fn(() => () => {}) },
  }))
  const fileSearch = options.fileSearch ?? vi.fn(() => Promise.resolve({
    ok: true,
    value: options.fileResults ?? [
      { path: 'src/index.ts', kind: 'file' },
      { path: 'src', kind: 'directory' },
    ],
  }))
  setFileReferenceSource(() => ({ fileReferences: { list: fileSearch } }))
  const { editor, editorRef, handler, emit, dispatch } = stubEditor(options.leading ?? true)
  const containerRef = { current: null as HTMLElement | null }
  const props = {
    sessionId: 'sessionId' in options ? options.sessionId : 's1',
    t: (options.locale ?? 'zh') === 'zh' ? tZh : fakeT(en),
    editor: editorRef.current,
    container: containerRef,
    guard: options.guard ?? 'plain',
    canPickFiles: true,
    onPickFiles,
    onError,
    registerClose,
    onOpen,
  } as unknown as CompletionFaceProps
  const view = render(
    <div ref={containerRef as never} data-composer-card>
      <FaceGate definition={completionFaceDefinition()}>
        <CompletionFace {...props} />
      </FaceGate>
    </div>,
  )
  return { view, onError, onPickFiles, registerClose, onOpen, handler, emit, dispatch, fileSearch, commandExecute, editor }
}

function listbox(): HTMLElement | null {
  return document.querySelector('[role="listbox"]')
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll('[role="option"]')] as HTMLElement[]
}

function sectionTitles(): string[] {
  return ([...document.querySelectorAll('[data-completion-section]')] as HTMLElement[]).map((el) => el.textContent ?? '')
}

function groupTitles(): string[] {
  return ([...document.querySelectorAll('[data-completion-group]')] as HTMLElement[]).map((el) => el.textContent ?? '')
}

/** A '/'-trigger probe emitting through the editor seam, opening the popup. */
async function openSlash(emit: (probe: CompletionProbe | null) => void, query = '', extra: Partial<CompletionProbe> = {}): Promise<void> {
  await act(async () => {
    emit(probe({ trigger: '/', query, start: 0, end: query.length + 1, ...extra }))
  })
  await waitFor(() => expect(listbox()).not.toBeNull())
}

async function openAt(emit: (probe: CompletionProbe | null) => void, query = 'src', extra: Partial<CompletionProbe> = {}): Promise<void> {
  await act(async () => {
    emit(probe({ trigger: '@', query, position: 'inline', start: 2, end: query.length + 2, ...extra }))
  })
  await waitFor(() => expect(listbox()).not.toBeNull())
}

afterEach(() => {
  cleanup()
  resetCommandFace()
  resetSkillFace()
  resetFileReferenceFace()
  resetFaces()
})

describe('CompletionFace open/close contract', () => {
  it('renders nothing until a probe arrives, then opens on a / probe (interlock fires)', async () => {
    const { emit, onOpen } = mountFace()
    expect(listbox()).toBeNull()
    await act(async () => { emit(probe({ trigger: '/' })) })
    await waitFor(() => expect(listbox()).not.toBeNull())
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('stays hidden while the session is absent', async () => {
    const { emit } = mountFace({ sessionId: undefined })
    await act(async () => { emit(probe({ trigger: '/' })) })
    expect(listbox()).toBeNull()
  })

  it('closes when the token dies and clears the dismissed memory', async () => {
    const { emit } = mountFace()
    await openSlash(emit)
    await act(async () => { emit(null) })
    expect(listbox()).toBeNull()
    // The same token may reopen after a natural close.
    await openSlash(emit)
    expect(listbox()).not.toBeNull()
  })

  it('keeps the popup closed for a dismissed token (Escape memory) until the text changes', async () => {
    const { emit, handler } = mountFace()
    await openSlash(emit, 'co')
    await act(async () => { handler()?.('close') })
    expect(listbox()).toBeNull()
    // The identical probe re-emitted (a selection move, a re-track) stays closed.
    await act(async () => { emit(probe({ trigger: '/', query: 'co', start: 0, end: 3 })) })
    expect(listbox()).toBeNull()
    // A different token reopens.
    await act(async () => { emit(probe({ trigger: '/', query: 'co', start: 3, end: 6 })) })
    await waitFor(() => expect(listbox()).not.toBeNull())
  })

  it('applies the guard tiers (claimed suppresses /, frozen suppresses both)', async () => {
    const claimed = mountFace({ guard: 'claimed' })
    await act(async () => { claimed.emit(probe({ trigger: '/' })) })
    expect(listbox()).toBeNull()
    await openAt(claimed.emit)
    expect(listbox()).not.toBeNull()
    cleanup()
    const frozen = mountFace({ guard: 'frozen' })
    await act(async () => { frozen.emit(probe({ trigger: '@' })) })
    expect(listbox()).toBeNull()
  })
})

describe('CompletionFace / popup', () => {
  it('shows the sectioned fallback rows and the pending skill skeleton at the empty query', async () => {
    const { emit } = mountFace()
    await openSlash(emit)
    expect(sectionTitles()).toEqual(['添加', '指令'])
    expect(groupTitles()).toEqual(['技能'])
    expect(document.querySelector('[data-completion-loading]')).not.toBeNull()
    const names = options().map((row) => row.getAttribute('data-completion-option'))
    expect(names.slice(0, 4)).toEqual(['file', 'goal', 'plan', 'feedback'])
  })

  it('swaps in the landed skill roll under its group title', async () => {
    const { emit } = mountFace({ skills: [{ name: 'core-review', description: 'Review the core', modelInvocable: true }] })
    await openSlash(emit)
    await waitFor(() => {
      expect(options().some((row) => row.getAttribute('data-completion-option') === 'core-review')).toBe(true)
    })
    expect(document.querySelector('[data-completion-loading]')).toBeNull()
    const skillRow = options().find((row) => row.getAttribute('data-completion-option') === 'core-review')
    expect(skillRow?.getAttribute('id')).toMatch(/^dsh-mdx-option-skill-/)
    expect(skillRow?.textContent).toContain('Review the core')
  })

  it('ranks the groups by query with prefix hits first and source titles on', async () => {
    const { emit } = mountFace({ skills: [{ name: 'core-review', description: 'Review the core' }] })
    await openSlash(emit, 'co')
    await waitFor(() => {
      expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('core-review')
    })
    expect(sectionTitles()).toEqual([])
    expect(groupTitles()).toEqual(['指令', '技能'])
    // Prefix hit 'compact' outranks the subsequence hit 'custom'; claim rows
    // survive at the leading position ('goal' matches no 'co' — 'goal' has no
    // prefix; 'co' is not a subsequence of 'goal' either).
    const names = options().map((row) => row.getAttribute('data-completion-option'))
    expect(names[0]).toBe('compact')
  })

  it('drops the claim rows at an inline position', async () => {
    const { emit } = mountFace({ leading: false })
    await act(async () => {
      emit(probe({ trigger: '/', query: '', position: 'inline', start: 4, end: 5 }))
    })
    await waitFor(() => expect(listbox()).not.toBeNull())
    const names = options().map((row) => row.getAttribute('data-completion-option'))
    expect(names).not.toContain('goal')
    expect(names).toContain('compact')
  })
})

describe('CompletionFace @ popup', () => {
  it('searches per query and lists the candidates with their locations', async () => {
    const { emit, fileSearch } = mountFace({
      fileResults: [
        { path: 'src/index.ts', kind: 'file' },
        { path: 'src', kind: 'directory' },
        { path: 'README.md', kind: 'file' },
      ],
    })
    await openAt(emit)
    await waitFor(() => expect(fileSearch).toHaveBeenCalledWith('s1', 'src', expect.anything()))
    await waitFor(() => expect(options()).toHaveLength(3))
    expect(sectionTitles()).toEqual(['文件与文件夹'])
    expect(groupTitles()).toEqual([])
    const dirRow = options().find((row) => row.getAttribute('data-completion-option') === 'src')
    expect(dirRow?.textContent).toContain('src/')
    expect(dirRow?.textContent).toContain('进入目录')
    const fileRow = options().find((row) => row.getAttribute('data-completion-option') === 'src/index.ts')
    expect(fileRow?.textContent).toContain('src')
  })

  it('keeps the previous rows visible while refining (stale-while-revalidate) and consumes Enter', async () => {
    const first = [
      { path: 'src/index.ts', kind: 'file' as const },
    ]
    let resolveSecond: ((value: unknown) => void) | undefined
    const fileSearch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, value: first }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const { emit, handler, dispatch } = mountFace({ fileSearch })
    await openAt(emit, 'sr')
    await waitFor(() => expect(options()).toHaveLength(1))
    // Refine: the fresh fetch is pending, the stale row stays visible.
    await act(async () => {
      emit(probe({ trigger: '@', query: 'src', position: 'inline', start: 2, end: 5 }))
    })
    await waitFor(() => expect(fileSearch).toHaveBeenCalledTimes(2))
    expect(options()).toHaveLength(1)
    // Enter during refinement is consumed — no stale pick, no default send.
    await act(async () => { handler()?.('pick') })
    expect(dispatch).not.toHaveBeenCalled()
    // The landing replaces the group whole.
    await act(async () => {
      resolveSecond?.({ ok: true, value: [{ path: 'src/index.ts', kind: 'file' }, { path: 'src/other.ts', kind: 'file' }] })
    })
    await waitFor(() => expect(options()).toHaveLength(2))
  })

  it('auto-closes when every ready group lands empty (no empty shell)', async () => {
    let resolveSearch: (value: unknown) => void = () => {}
    const fileSearch = vi.fn(() => new Promise((resolve) => { resolveSearch = resolve }))
    const { emit } = mountFace({ fileSearch })
    // Pending: the skeleton shows.
    await act(async () => { emit(probe({ trigger: '@', query: 'zzz', position: 'inline', start: 2, end: 5 })) })
    await waitFor(() => expect(listbox()).not.toBeNull())
    // Landed empty: the popup closes (host all-ready-empty rule) — an empty
    // shell never floats, and no dismissed memory is written.
    await act(async () => { resolveSearch({ ok: true, value: [] }) })
    await waitFor(() => expect(listbox()).toBeNull())
    // A fresh query reopens (its fetch stays pending here: the skeleton).
    await openAt(emit, 'src')
  })
})

describe('CompletionFace keyboard', () => {
  it('cycles the flat highlight across groups with wraparound', async () => {
    const { emit, handler } = mountFace()
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(4))
    await act(async () => { handler()?.('down') })
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe('dsh-mdx-option-command-1')
    // ↑ from the head wraps to the tail — the flat space's last row (the
    // skill roll's single entry).
    const lastRow = options()[options().length - 1]!
    await act(async () => { handler()?.('up') })
    await act(async () => { handler()?.('up') })
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe(lastRow.id)
  })

  it('declines every key while closed (the editor carries on)', async () => {
    const { handler } = mountFace()
    expect(handler()?.('down')).toBe(false)
    expect(handler()?.('pick')).toBe(false)
    expect(handler()?.('close')).toBe(false)
  })

  it('moves the highlight under a resting pointer (last writer wins)', async () => {
    const { emit } = mountFace()
    await openSlash(emit)
    const rows = options()
    fireEvent.mouseMove(rows[3])
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe('dsh-mdx-option-command-3')
  })
})

describe('CompletionFace picks', () => {
  it('picks a file row by inserting the wire mention over the token span', async () => {
    const { emit, dispatch } = mountFace()
    await openAt(emit, 'sr')
    await waitFor(() => expect(options()).toHaveLength(2))
    const fileRow = options().find((row) => row.getAttribute('data-completion-option') === 'src/index.ts')!
    // mousedown is prevented (combobox: the editor keeps focus).
    expect(fireEvent.mouseDown(fileRow, { cancelable: true })).toBe(false)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const spec = dispatch.mock.calls[0]![0] as { changes: { from: number; to: number; insert: string } }
    expect(spec.changes).toEqual({ from: 2, to: 4, insert: '@src/index.ts' })
    expect(listbox()).toBeNull()
  })

  it('keeps the popup closed for the settled token even though the mention is live', async () => {
    const { emit, dispatch } = mountFace()
    await openAt(emit, 'sr')
    await waitFor(() => expect(options()).toHaveLength(2))
    fireEvent.mouseDown(options().find((row) => row.getAttribute('data-completion-option') === 'src/index.ts')!)
    expect(dispatch).toHaveBeenCalledTimes(1)
    // The post-insert probe: the full path is a live bare token now.
    await act(async () => { emit(probe({ trigger: '@', query: 'src/index.ts', position: 'inline', start: 2, end: 14 })) })
    expect(listbox()).toBeNull()
    // Extending the query reopens.
    await act(async () => { emit(probe({ trigger: '@', query: 'src/index.tsx', position: 'inline', start: 2, end: 15 })) })
    await waitFor(() => expect(listbox()).not.toBeNull())
  })

  it('drills into a directory on Tab and lets the descended listing reopen', async () => {
    const { emit, handler, dispatch } = mountFace({
      fileResults: [{ path: 'src', kind: 'directory' }],
    })
    await openAt(emit, 'sr')
    await waitFor(() => expect(options()).toHaveLength(1))
    await act(async () => { handler()?.('tab') })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const spec = dispatch.mock.calls[0]![0] as { changes: { insert: string } }
    expect(spec.changes.insert).toBe('@src/')
    // The open token re-tracks: the descended listing opens (no dismissal).
    await act(async () => {
      emit(probe({ trigger: '@', query: 'src/', position: 'inline', start: 2, end: 7 }))
    })
    await waitFor(() => expect(listbox()).not.toBeNull())
  })

  it('inserts a quoted open mention for a quoted token and closes the quote on files', async () => {
    const { emit, dispatch } = mountFace({
      fileResults: [{ path: 'my docs/report.pdf', kind: 'file' }],
    })
    await openAt(emit, 'my do', { quoted: true, start: 0, end: 7 })
    await waitFor(() => expect(options()).toHaveLength(1))
    fireEvent.mouseDown(options()[0])
    const spec = dispatch.mock.calls[0]![0] as { changes: { insert: string } }
    expect(spec.changes.insert).toBe('@"my docs/report.pdf"')
  })

  it('inserts a skill token with its trailing space', async () => {
    const { emit, handler, dispatch } = mountFace({ skills: [{ name: 'core-review', description: 'Review the core' }] })
    await openSlash(emit, 'core')
    await waitFor(() => expect(options().some((row) => row.getAttribute('data-completion-option') === 'core-review')))
    await act(async () => { handler()?.('pick') })
    const spec = dispatch.mock.calls[0]![0] as { changes: { insert: string } }
    expect(spec.changes.insert).toBe('/core-review ')
    expect(listbox()).toBeNull()
  })

  it('picks a claim row through the leading guard, and declines it inline', async () => {
    const leading = mountFace({ leading: true })
    await openSlash(leading.emit)
    const goal = options().find((row) => row.getAttribute('data-completion-option') === 'goal')!
    fireEvent.mouseDown(goal)
    expect(leading.editor.claimSelection).toHaveBeenCalledWith('/目标 ')
    cleanup()
    const inline = mountFace({ leading: false })
    await openSlash(inline.emit)
    const compact = options().find((row) => row.getAttribute('data-completion-option') === 'compact')!
    fireEvent.mouseDown(compact)
    expect(inline.editor.claimSelection).not.toHaveBeenCalled()
  })

  it('executes bare commands detached and reports failures through the banner', async () => {
    const { emit, commandExecute, onError } = mountFace({
      executeResult: { ok: false, error: { code: 'session/writer-held', message: 'busy' } },
    })
    await openSlash(emit)
    const compact = options().find((row) => row.getAttribute('data-completion-option') === 'compact')!
    fireEvent.mouseDown(compact)
    await waitFor(() => expect(commandExecute).toHaveBeenCalledWith('s1', '/compact', []))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('命令执行失败：session/writer-held: busy'))
    expect(listbox()).toBeNull()
  })

  it('chains the popup rows into their popup faces', async () => {
    const opened: string[] = []
    const chain = await import('../src/client/chain-open.ts')
    const offPermission = chain.registerChainPopup('permission', () => { opened.push('permission'); return true })
    const offModel = chain.registerChainPopup('model', () => { opened.push('model'); return true })
    try {
      // The popup faces are alive at assembly: the chainable rows render.
      const { emit } = mountFace()
      await openSlash(emit)
      const model = options().find((row) => row.getAttribute('data-completion-option') === 'model')
      expect(model).not.toBeNull()
      fireEvent.mouseDown(model!)
      expect(opened).toEqual(['model'])
      expect(listbox()).toBeNull()
    } finally {
      offPermission()
      offModel()
    }
  })

  it('rides the hidden file input for the file action row', async () => {
    const { emit, onPickFiles } = mountFace()
    await openSlash(emit)
    const fileRow = options().find((row) => row.getAttribute('data-completion-option') === 'file')!
    fireEvent.mouseDown(fileRow)
    expect(onPickFiles).toHaveBeenCalledTimes(1)
    expect(listbox()).toBeNull()
  })

  it('closes on pointerdown outside the card and stays for card-internal presses', async () => {
    const { emit } = mountFace()
    await openSlash(emit)
    fireEvent.pointerDown(document.body)
    expect(listbox()).toBeNull()
    await openSlash(emit, 'x', { start: 0, end: 2 })
    fireEvent.pointerDown(document.querySelector('[data-composer-card]')!)
    expect(listbox()).not.toBeNull()
  })
})

describe('CompletionFace real-surface linkage (T9)', () => {
  function mountRealEditor(): MarkdownEditorHandle {
    const host = document.createElement('div')
    document.body.appendChild(host)
    return createMarkdownEditor({
      parent: host,
      placeholder: 'ph',
      mode: 'render',
      onSubmit: () => {},
      onDocChange: () => {},
      onFiles: () => true,
    })
  }

  it('decorates a picked skill the moment the text lands (insert → hit → chip)', async () => {
    setCommandSource(() => ({
      commands: { list: vi.fn(() => new Promise(() => {})), execute: vi.fn() },
      remoteEvents: { $on: vi.fn(() => () => {}) },
    }))
    setSkillSource(() => ({
      skills: {
        list: vi.fn(() => Promise.resolve({
          ok: true,
          value: { skills: [{ name: 'core-review', description: 'Review', modelInvocable: true }] },
        })),
      },
      remoteEvents: { $on: vi.fn(() => () => {}) },
    }))
    setFileReferenceSource(() => ({ fileReferences: { list: vi.fn() } }))
    const handle = mountRealEditor()
    const containerRef = { current: null as HTMLElement | null }
    render(
      <div ref={containerRef as never} data-composer-card>
        <CompletionFace
          sessionId="s1"
          t={tZh}
          editor={handle}
          container={containerRef}
          guard="plain"
          canPickFiles={false}
          onPickFiles={() => {}}
          onError={() => {}}
          registerClose={() => {}}
          onOpen={() => {}}
        />
      </div>,
    )
    try {
      // The raw editor's hot dictionary is the caller's to feed (the card
      // does it in production): a chip needs the lexicon, not just the popup.
      handle.setSkillLexicon(['core-review'])
      await act(async () => { handle.setText('/core') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      // The lexicon read lands while the popup is open; the skill row joins.
      await waitFor(() => {
        expect(options().some((el) => el.getAttribute('data-completion-option') === 'core-review')).toBe(true)
      })
      const row = options().find((el) => el.getAttribute('data-completion-option') === 'core-review')
      fireEvent.mouseDown(row!)
      await waitFor(() => {
        expect(handle.getText()).toBe('/core-review ')
        expect(document.querySelector('.cm-mdx-ref-skill')).not.toBeNull()
      })
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })

  it('decorates a picked file chip and stays closed for the settled token', async () => {
    setCommandSource(() => undefined)
    setSkillSource(() => undefined)
    setFileReferenceSource(() => ({
      fileReferences: {
        list: vi.fn(() => Promise.resolve({ ok: true, value: [{ path: 'src/index.ts', kind: 'file' }] })),
      },
    }))
    const handle = mountRealEditor()
    const containerRef = { current: null as HTMLElement | null }
    render(
      <div ref={containerRef as never} data-composer-card>
        <CompletionFace
          sessionId="s1"
          t={tZh}
          editor={handle}
          container={containerRef}
          guard="plain"
          canPickFiles={false}
          onPickFiles={() => {}}
          onError={() => {}}
          registerClose={() => {}}
          onOpen={() => {}}
        />
      </div>,
    )
    try {
      await act(async () => { handle.setText('see @in') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      fireEvent.mouseDown(options()[0])
      await waitFor(() => {
        expect(handle.getText()).toBe('see @src/index.ts')
        expect(document.querySelector('.cm-mdx-ref-file')).not.toBeNull()
      })
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })
})
