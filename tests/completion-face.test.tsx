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
 * demands (insert → dictionary hit → chip) plus the #28 real-surface
 * dispatch regression: the claim guard reads the probe's token position
 * (mouse and key paths), a declined chain-open never silences the token,
 * and the model row chains into the real vendored ModelSelect face. The
 * chain settle (#36) is pinned end to end here too: a successful chained
 * pick consumes the typed trigger and refocuses the editor, while failures,
 * dismissals and direct pill picks leave the draft alone. The #35 feedback
 * decoration is pinned here too: while the host `feedbackUi` service is
 * alive the feedback row opens the session dialog with no insertion (and a
 * typed `/反馈 ` line still claims through the editor), while a host without
 * the service keeps the row's claim shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode, RefObject } from 'react'
import { CompletionFace, completionFaceDefinition, type CompletionFaceProps } from '../src/client/CompletionFace.tsx'
import { resetCommandFace, setCommandSource } from '../src/client/command-face.ts'
import { resetFeedbackSource, setFeedbackSource } from '../src/client/feedback-face.ts'
import { resetFileReferenceFace, setFileReferenceSource } from '../src/client/file-reference-face.ts'
import { resetSkillFace, setSkillSource } from '../src/client/skill-face.ts'
import { createMarkdownEditor, type CompletionProbeListener, type MarkdownEditorHandle, type MenuKeyHandler } from '../src/client/markdown-editor.ts'
import type { CompletionProbe } from '../src/client/completion-core.ts'
import { ModelSelectFace } from '../src/client/ModelSelectFace.tsx'
import { modelFaceDefinition, resetModelFace, setModelLocale, setModelSource, type ModelDirectoryState } from '../src/client/model-face.ts'
import {
  PermissionSelectFace, type PermissionSelectFaceProps,
} from '../src/client/PermissionSelectFace.tsx'
import {
  permissionFaceDefinition, resetPermissionFace, setPermissionSource,
} from '../src/client/permission-face.ts'
import { registerChainPopup, resetChainPopups } from '../src/client/chain-open.ts'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'
import { zh as modelZh } from '../src/client/ModelSelectFace.locales.ts'

// jsdom does not implement scrollIntoView; the chained model card's drilled
// pane scrolls its highlighted row on open (mirrors model-select-face.test).
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

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
function stubEditor() {
  let completionHandler: MenuKeyHandler | null = null
  let probeListener: CompletionProbeListener | null = null
  const dispatch = vi.fn()
  const editor = {
    focus: vi.fn(),
    claimSelection: vi.fn(),
    // An empty document double: the chain settle hook (#36) snapshots the
    // picked token through `view.state.doc` (a real editor always carries
    // one). The synthetic picks therefore settle as a benign CAS miss; the
    // real consume is driven end to end over a real editor below.
    view: { dispatch, state: { doc: { length: 0, sliceString: () => '' } } },
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

/** The six first-party host descriptors the real catalog carries (#76 AC3). */
const HOST_BUILTINS = [
  { definitionId: '@deepseek-ai/dsh-command-goal', name: 'goal', description: 'Set or view the goal', input: { hint: '[<objective>|clear]' } },
  { definitionId: '@deepseek-ai/dsh-plan-mode', name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]' } },
  { definitionId: '@deepseek-ai/dsh-command-feedback', name: 'feedback', description: 'Record feedback', input: { hint: '<text>' } },
  { definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact', description: 'Compact older conversation history' },
  { definitionId: '@deepseek-ai/dsh-permission-presets', name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
  { definitionId: '@deepseek-ai/dsh-session-log-export', name: 'export', description: 'Download this Session log as a ZIP archive' },
]

interface MountOptions {
  sessionId?: string | undefined
  locale?: 'zh' | 'en'
  guard?: 'plain' | 'claimed' | 'frozen'
  fileResults?: readonly { path: string, kind: 'file' | 'directory' }[]
  fileSearch?: ReturnType<typeof vi.fn>
  executeResult?: unknown
  /** Landed skill roll; absent = the lexicon read stays pending (skeleton). */
  skills?: readonly { name: string, description?: string, modelInvocable?: boolean }[]
  /** Reject the skills/list read (the failed-group-removal shape, #76 AC1). */
  skillsReject?: unknown
  /** Override the whole skills/list mock (deferred tests drive it by hand). */
  skillList?: ReturnType<typeof vi.fn>
  /** Landed command catalog; absent = the host built-ins land (#76 AC3). */
  catalog?: readonly Record<string, unknown>[]
  /** Keep the catalog read pending (the popup shows the pending group). */
  catalogPending?: boolean
  /** Reject the commands/list read (the failed-group-removal shape, #76 AC3). */
  catalogReject?: unknown
  /** The session snapshot's subagent share (native short-circuit, #76 AC4). */
  subagent?: unknown
}

function mountFace(options: MountOptions = {}) {
  const onError = vi.fn()
  const onPickFiles = vi.fn()
  const registerClose = vi.fn()
  const onOpen = vi.fn()
  // The forwarded-event listeners are captured so tests can fire the
  // invalidation events the faces subscribe to (#76 AC3).
  const eventListeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const $on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    const bucket = eventListeners.get(event) ?? []
    bucket.push(listener)
    eventListeners.set(event, bucket)
    return () => {
      const at = bucket.indexOf(listener)
      if (at >= 0) bucket.splice(at, 1)
    }
  })
  const commandExecute = vi.fn(() => Promise.resolve(options.executeResult ?? {
    ok: true, value: { commandId: 'c1', result: { kind: 'success' } },
  }))
  // The catalog read lands the host built-ins by default: the popup rows are
  // the real catalog's (the static fallback never serves the popup, #76 AC3).
  const commandList = vi.fn(() => {
    if (options.catalogReject !== undefined) return Promise.reject(options.catalogReject)
    if (options.catalogPending === true) return new Promise(() => {})
    return Promise.resolve({ ok: true, value: options.catalog ?? HOST_BUILTINS })
  })
  setCommandSource(() => ({
    commands: {
      list: commandList,
      execute: commandExecute,
    },
    remoteEvents: { $on },
  }))
  const skillList = options.skillList ?? vi.fn(() => {
    if (options.skillsReject !== undefined) return Promise.reject(options.skillsReject)
    if (options.skills === undefined) return new Promise(() => {})
    return Promise.resolve({ ok: true, value: { skills: options.skills } })
  })
  setSkillSource(() => ({
    skills: { list: skillList },
    remoteEvents: { $on },
  }))
  const fire = (event: string, ...args: unknown[]): void => {
    for (const listener of eventListeners.get(event) ?? []) listener(...args)
  }
  const fileSearch = options.fileSearch ?? vi.fn(() => Promise.resolve({
    ok: true,
    value: options.fileResults ?? [
      { path: 'src/index.ts', kind: 'file' },
      { path: 'src', kind: 'directory' },
    ],
  }))
  setFileReferenceSource(() => ({ fileReferences: { list: fileSearch } }))
  const { editor, editorRef, handler, emit, dispatch } = stubEditor()
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
    ...(options.subagent === undefined ? {} : { subagent: options.subagent }),
  } as unknown as CompletionFaceProps
  const view = render(
    <div ref={containerRef as never} data-composer-card>
      <FaceGate definition={completionFaceDefinition()}>
        <CompletionFace {...props} />
      </FaceGate>
    </div>,
  )
  return {
    view, onError, onPickFiles, registerClose, onOpen, handler, emit, dispatch, fileSearch,
    commandExecute, commandList, skillList, fire, editor,
  }
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
  resetFeedbackSource()
  resetSkillFace()
  resetFileReferenceFace()
  resetModelFace()
  resetPermissionFace()
  resetChainPopups()
  resetFaces()
})

/** Bind the host `feedbackUi` service a supported host exposes (#35). */
function withFeedbackUi(): ReturnType<typeof vi.fn> {
  const openSession = vi.fn()
  setFeedbackSource(() => ({ openSession }))
  return openSession
}

/** The feedback command option while the popup is open. */
function feedbackOption(): HTMLElement {
  return options().find((row) => row.getAttribute('data-completion-option') === 'feedback') as HTMLElement
}

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

  it('keeps no dismissed memory when the + menu interlock closes the popup', async () => {
    const { emit, registerClose } = mountFace()
    await openSlash(emit)
    const interlockClose = registerClose.mock.calls.at(-1)?.[0] as (() => void) | undefined
    expect(typeof interlockClose).toBe('function')
    await act(async () => { interlockClose?.() })
    expect(listbox()).toBeNull()
    // The same token re-tracks open: the interlock close never remembered
    // (native toggleSource's open path writes no dismissed memory, #76 AC6).
    await act(async () => { emit(probe({ trigger: '/', query: '', start: 0, end: 1 })) })
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
  it('shows the landed catalog rows and the pending skill skeleton at the empty query', async () => {
    const { emit } = mountFace()
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    expect(sectionTitles()).toEqual(['添加', '指令'])
    expect(groupTitles()).toEqual(['技能'])
    expect(document.querySelector('[data-completion-loading]')).not.toBeNull()
    const names = options().map((row) => row.getAttribute('data-completion-option'))
    expect(names.slice(0, 4)).toEqual(['file', 'goal', 'plan', 'feedback'])
  })

  it('shows a pending command group instead of static rows while the catalog read is in flight', async () => {
    const { emit } = mountFace({ catalogPending: true })
    await openSlash(emit)
    // The popup never falls back to the synthetic catalog (#76 AC3): both
    // reads pending → skeletons only, no candidate rows.
    expect(options()).toEqual([])
    expect(document.querySelectorAll('[data-completion-loading]')).toHaveLength(2)
  })

  it('removes the command group when the catalog read fails (no static fallback in the popup)', async () => {
    const { emit } = mountFace({ catalogReject: new Error('boom'), skills: [{ name: 'core-review' }] })
    await act(async () => { emit(probe({ trigger: '/', query: 'core', start: 0, end: 5 })) })
    // The failed command group is removed (native source-failed): no rows,
    // no skeleton, no static stand-in — the popup serves the surviving skill
    // group alone.
    await waitFor(() => expect(document.querySelector('[data-completion-loading]')).toBeNull())
    expect(options().map((row) => row.getAttribute('data-completion-option'))).toEqual(['core-review'])
    expect(groupTitles()).toEqual(['技能'])
  })

  it('keeps serving the landed catalog through a soft invalidation and swaps when the repull lands', async () => {
    const { emit, commandList, fire } = mountFace({ catalog: [{ name: 'custom', description: 'A custom command' }] })
    await openSlash(emit)
    await waitFor(() => expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('custom'))
    commandList.mockReturnValue(Promise.resolve({
      ok: true,
      value: [{ definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact', description: 'Compact' }],
    }))
    fire('commands/change')
    // In-place repull (native invalidateAll): the landed rows keep serving —
    // no synthetic fallback, no empty flash.
    expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('custom')
    await waitFor(() => expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('compact'))
    expect(options().map((row) => row.getAttribute('data-completion-option'))).not.toContain('custom')
  })

  it('drops to the pending group after a preset switch and recovers when the prewarm lands', async () => {
    const { emit, commandList, fire } = mountFace({ catalog: [{ name: 'custom', description: 'A custom command' }] })
    await openSlash(emit)
    await waitFor(() => expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('custom'))
    commandList.mockImplementationOnce(() => new Promise((resolve) => {
      // Resolved below: the prewarmed read lands the fresh catalog.
      resolve({ ok: true, value: [{ definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact', description: 'Compact' }] })
    }))
    fire('agent-preset/selected', 's1')
    // Hard invalidation (native resetSession): the snapshot drops, the popup
    // pends — never the synthetic catalog.
    await waitFor(() => { expect(options()).toEqual([]) })
    expect(document.querySelector('[data-completion-loading]')).not.toBeNull()
    await waitFor(() => expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('compact'))
  })

  it('removes the skill group when the lexicon read fails and keeps the keyboard live', async () => {
    const { emit, handler, onPickFiles } = mountFace({ skillsReject: new Error('boom') })
    await openSlash(emit)
    await waitFor(() => expect(document.querySelector('[data-completion-loading]')).toBeNull())
    // The failed group is removed (native source-failed): no title, no
    // skeleton — never a permanent pending (#76 AC1).
    expect(groupTitles()).toEqual([])
    // Enter picks the highlighted command row immediately.
    await act(async () => { handler()?.('pick') })
    expect(onPickFiles).toHaveBeenCalledTimes(1)
  })

  it('auto-closes when the lexicon failed and no command matches the query', async () => {
    let rejectSkills: ((reason: unknown) => void) | undefined
    const skillList = vi.fn(() => new Promise((_resolve, reject) => { rejectSkills = reject }))
    const { emit } = mountFace({ skillList })
    await openSlash(emit, 'zzz')
    // Command group ready-empty; the skill read still pending: the popup
    // holds (a pending group is not an empty surface).
    await waitFor(() => expect(document.querySelector('[data-completion-loading]')).not.toBeNull())
    await act(async () => { rejectSkills?.(new Error('boom')) })
    // Both groups settle empty → the popup closes (host all-ready-empty rule).
    await waitFor(() => expect(listbox()).toBeNull())
  })

  it('re-pulls the lexicon read on the next popup open after a failure', async () => {
    const { emit, skillList } = mountFace({ skillsReject: new Error('boom') })
    await openSlash(emit)
    await waitFor(() => expect(document.querySelector('[data-completion-loading]')).toBeNull())
    const afterFirst = skillList.mock.calls.length
    // Close and re-track the token: the failed read retries (never a
    // poisoned key, #76 AC1).
    await act(async () => { emit(null) })
    await openSlash(emit, 'x', { start: 0, end: 2 })
    await waitFor(() => expect(skillList.mock.calls.length).toBeGreaterThan(afterFirst))
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
      const names = options().map((row) => row.getAttribute('data-completion-option'))
      expect(names).toContain('core-review')
      expect(names).toContain('compact')
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
    const { emit } = mountFace()
    await act(async () => {
      emit(probe({ trigger: '/', query: '', position: 'inline', start: 4, end: 5 }))
    })
    await waitFor(() => expect(listbox()).not.toBeNull())
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const names = options().map((row) => row.getAttribute('data-completion-option'))
    expect(names).not.toContain('goal')
    expect(names).toContain('compact')
  })

  it('picks the highlighted row while another group is still pending (no double-Enter stall)', async () => {
    // Native arbitrate: readiness is judged on the highlighted row's OWN
    // group — a pending skill group must not consume the gesture (#76 AC2).
    const { emit, handler, onPickFiles } = mountFace()
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    await act(async () => { handler()?.('pick') })
    // The file row (highlight 0) picked at once: no first-Enter swallow.
    expect(onPickFiles).toHaveBeenCalledTimes(1)
  })

  it('short-circuits the catalog and lexicon for a subagent session (no rows, no RPC)', async () => {
    // Native subagent parity (#76 AC4): the command catalog and the skill
    // source short-circuit before any RPC; the empty candidate surface
    // auto-closes — the popup never floats and never leaks catalog rows.
    const { emit, commandList, skillList, onOpen } = mountFace({ subagent: { address: { mode: 'nested' } } })
    await act(async () => { emit(probe({ trigger: '/' })) })
    await new Promise((resolve) => { setTimeout(resolve, 20) })
    expect(listbox()).toBeNull()
    expect(document.querySelector('[data-completion-menu]')).toBeNull()
    expect(commandList).not.toHaveBeenCalled()
    expect(skillList).not.toHaveBeenCalled()
    // The open path ran (the interlock fired) — the close is the empty
    // surface's own answer, not a guard refusal.
    expect(onOpen).toHaveBeenCalledTimes(1)
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
    // catalog's export row; the skill roll is still pending here).
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
  it('picks a file row by inserting the wire mention with its separating space', async () => {
    const { emit, dispatch } = mountFace()
    await openAt(emit, 'sr')
    await waitFor(() => expect(options()).toHaveLength(2))
    const fileRow = options().find((row) => row.getAttribute('data-completion-option') === 'src/index.ts')!
    // mousedown is prevented (combobox: the editor keeps focus).
    expect(fireEvent.mouseDown(fileRow, { cancelable: true })).toBe(false)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const spec = dispatch.mock.calls[0]![0] as { changes: { from: number; to: number; insert: string } }
    // The tail rule (native runtime.ts): one separating space — the mention
    // never glues to the next keystroke (#76 AC7).
    expect(spec.changes).toEqual({ from: 2, to: 4, insert: '@src/index.ts ' })
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
    expect(spec.changes.insert).toBe('@"my docs/report.pdf" ')
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

  it('picks a claim row at the leading position; inline assemblies drop the rows', async () => {
    const leading = mountFace()
    await openSlash(leading.emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const goal = options().find((row) => row.getAttribute('data-completion-option') === 'goal')!
    fireEvent.mouseDown(goal)
    expect(leading.editor.claimSelection).toHaveBeenCalledWith('/目标 ')
    cleanup()
    const inline = mountFace()
    await openSlash(inline.emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    const compact = options().find((row) => row.getAttribute('data-completion-option') === 'compact')!
    fireEvent.mouseDown(compact)
    expect(inline.editor.claimSelection).not.toHaveBeenCalled()
  })

  it('executes bare commands detached and reports failures through the banner', async () => {
    const { emit, commandExecute, onError } = mountFace({
      executeResult: { ok: false, error: { code: 'session/writer-held', message: 'busy' } },
    })
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
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
      await waitFor(() => expect(options().some((row) => row.getAttribute('data-completion-option') === 'model')).toBe(true))
      const model = options().find((row) => row.getAttribute('data-completion-option') === 'model')!
      fireEvent.mouseDown(model)
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
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
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

describe('CompletionFace feedback decoration (#35)', () => {
  it('consumes the trigger token and opens the session dialog on a mouse pick', async () => {
    // The native decoration invoke (service.ts): consume the token via the
    // span CAS first, then run — the draft carries no /fee fragment after,
    // and the popup closes with the consumption (#76 AC5).
    const openSession = withFeedbackUi()
    stubSources([])
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('/fee') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => {
        expect(options().some((row) => row.getAttribute('data-completion-option') === 'feedback')).toBe(true)
      })
      fireEvent.mouseDown(options().find((row) => row.getAttribute('data-completion-option') === 'feedback')!)
      await waitFor(() => expect(openSession).toHaveBeenCalledWith('s1'))
      expect(handle.getText()).toBe('')
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })

  it('picks the action through the key seam as well', async () => {
    const openSession = withFeedbackUi()
    // A landed (empty) skill roll and catalog keep the view non-pending:
    // Enter then picks the highlighted row instead of being consumed by the
    // refinement.
    const { emit, handler, dispatch } = mountFace({ skills: [] })
    await openSlash(emit, 'fee')
    await waitFor(() => {
      expect(options().map((row) => row.getAttribute('data-completion-option'))).toEqual(['feedback'])
    })
    await act(async () => { handler()?.('pick') })
    expect(openSession).toHaveBeenCalledWith('s1')
    expect(dispatch).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
  })

  it('degrades to the claim row on a host without the feedbackUi service', async () => {
    const { emit, dispatch, editor } = mountFace()
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    fireEvent.mouseDown(feedbackOption())
    // Today's shape: the pick inserts the localized claim token over the span
    // (the claim path rides claimSelection, never a direct dispatch).
    expect(editor.claimSelection).toHaveBeenCalledWith('/反馈 ')
    expect(dispatch).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
  })

  it('survives a service that vanished between assembly and pick (no crash)', async () => {
    withFeedbackUi()
    const { emit, dispatch } = mountFace()
    await openSlash(emit)
    await waitFor(() => expect(options().length).toBeGreaterThan(0))
    setFeedbackSource(() => undefined)
    expect(() => { fireEvent.mouseDown(feedbackOption()) }).not.toThrow()
    expect(dispatch).not.toHaveBeenCalled()
    expect(listbox()).toBeNull()
  })
})

/** A real CM6 surface: the dispatch tests below ride the actual editor. */
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

/**
 * The three data planes behind the popup, with the catalog read landing the
 * host built-ins (#76 AC3: the popup never serves the static fallback) and
 * the skill lexicon pending unless a roll is given — a landed roll keeps the
 * view's pending flag down, which the key seam's Enter pick requires (a
 * pending refinement consumes Enter by design).
 */
function stubSources(skills?: readonly { name: string, description?: string, modelInvocable?: boolean }[]): void {
  setCommandSource(() => ({
    commands: {
      list: vi.fn(() => Promise.resolve({ ok: true, value: HOST_BUILTINS })),
      execute: vi.fn(),
    },
    remoteEvents: { $on: vi.fn(() => () => {}) },
  }))
  setSkillSource(() => ({
    skills: {
      list: skills === undefined
        ? vi.fn(() => new Promise(() => {}))
        : vi.fn(() => Promise.resolve({ ok: true, value: { skills } })),
    },
    remoteEvents: { $on: vi.fn(() => () => {}) },
  }))
  setFileReferenceSource(() => ({ fileReferences: { list: vi.fn() } }))
}

/** Mount the gated popup face over a real editor inside a card container. */
function mountOverRealEditor(handle: MarkdownEditorHandle, siblings?: ReactNode): void {
  const containerRef = { current: null as HTMLElement | null }
  render(
    <div ref={containerRef as never} data-composer-card>
      <FaceGate definition={completionFaceDefinition()}>
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
      </FaceGate>
      {siblings}
    </div>,
  )
}

describe('CompletionFace real-surface linkage (T9)', () => {

  it('decorates a picked skill the moment the text lands (insert → hit → chip)', async () => {
    stubSources([{ name: 'core-review', description: 'Review', modelInvocable: true }])
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
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
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('see @in') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      fireEvent.mouseDown(options()[0])
      await waitFor(() => {
        expect(handle.getText()).toBe('see @src/index.ts ')
        expect(document.querySelector('.cm-mdx-ref-file')).not.toBeNull()
      })
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })

  it('does not double the space when the draft already has one after the token', async () => {
    setCommandSource(() => undefined)
    setSkillSource(() => undefined)
    setFileReferenceSource(() => ({
      fileReferences: {
        list: vi.fn(() => Promise.resolve({ ok: true, value: [{ path: 'src/index.ts', kind: 'file' }] })),
      },
    }))
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('see @in tail') })
      // The caret rides to the token end (before the existing space).
      await act(async () => { handle.view.dispatch({ selection: { anchor: 7 } }) })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => expect(options()).toHaveLength(1))
      fireEvent.mouseDown(options()[0])
      // The tail rule: the span is already followed by a space — no second.
      await waitFor(() => expect(handle.getText()).toBe('see @src/index.ts tail'))
    } finally {
      handle.destroy()
    }
  })
})

describe('CompletionFace real-surface claim dispatch (#28)', () => {
  it('inserts the claim token over the typed trigger on a row click (mouse path)', async () => {
    stubSources()
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      // The typed trigger is document text: any caret-relative leading check
      // sees '/p' before the caret and would decline forever (the alpha.6
      // real-host defect). The guard must read the probe's token position.
      await act(async () => { handle.setText('/p') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => {
        expect(options().some((row) => row.getAttribute('data-completion-option') === 'plan')).toBe(true)
      })
      const plan = options().find((row) => row.getAttribute('data-completion-option') === 'plan')!
      fireEvent.mouseDown(plan)
      expect(handle.getText()).toBe('/计划 ')
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })

  it('picks the claim row through the key seam with the same result (keyboard path)', async () => {
    stubSources([{ name: 'core-review' }])
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('/') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => expect(options().length).toBeGreaterThan(1))
      const content = handle.view.contentDOM
      // Real-keystroke pacing: each keydown is its own task, so the highlight
      // commit (and its ref mirror) lands before Enter reads it.
      await act(async () => { fireEvent.keyDown(content, { key: 'ArrowDown' }) })
      await act(async () => { fireEvent.keyDown(content, { key: 'Enter' }) })
      expect(handle.getText()).toBe('/计划 ')
      // The settling pick closed the popup and armed the dismissed memory.
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })

  it('keeps the popup openable when a chained popup row fails to open (no dead settle)', async () => {
    stubSources()
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      // The model opener declines (a mid-life face death): the pick closes
      // the popup but must NOT write the dismissed memory — the token stays
      // alive for the user's next move instead of staying silenced.
      const off = registerChainPopup('model', () => false)
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => {
        expect(options().some((row) => row.getAttribute('data-completion-option') === 'model')).toBe(true)
      })
      const model = options().find((row) => row.getAttribute('data-completion-option') === 'model')!
      fireEvent.mouseDown(model)
      expect(listbox()).toBeNull()
      // The same token reopens after the text rounds-trips (no memory).
      await act(async () => { handle.setText('/mod') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      off()
    } finally {
      handle.destroy()
    }
  })

  it('never hijacks the settled typed /反馈 line (claim pipeline preserved)', async () => {
    // Acceptance 3 (#35): the typed remark keeps its own path. The dialog
    // action is armed by a ROW PICK only — tracking, ranking and the settled
    // token never call into it. A `/反馈 ` line is already settled (the
    // trailing space closes the token), so the popup stays shut, the draft is
    // byte-identical, and Enter reaches the card's submit untouched: the host
    // then claims it as the typed remark it is (service.ts matchEnter).
    const openSession = withFeedbackUi()
    stubSources([])
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('/反馈 ') })
      expect(handle.getText()).toBe('/反馈 ')
      expect(listbox()).toBeNull()
      expect(openSession).not.toHaveBeenCalled()
      // An argued remark stays a plain draft too (no token left to track).
      await act(async () => { handle.setText('/反馈 这句有点慢') })
      expect(handle.getText()).toBe('/反馈 这句有点慢')
      expect(listbox()).toBeNull()
      expect(openSession).not.toHaveBeenCalled()
    } finally {
      handle.destroy()
    }
  })

  it('claims through the editor when the dialog action is absent (today\'s shape)', async () => {
    // The same row with no feedbackUi service stays on the claim pipeline, so
    // the two host builds differ in exactly one place (command-rows.ts).
    stubSources([])
    const handle = mountRealEditor()
    mountOverRealEditor(handle)
    try {
      await act(async () => { handle.setText('/fee') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => {
        expect(options().some((row) => row.getAttribute('data-completion-option') === 'feedback')).toBe(true)
      })
      const feedback = options().find((row) => row.getAttribute('data-completion-option') === 'feedback')!
      fireEvent.mouseDown(feedback)
      expect(handle.getText()).toBe('/反馈 ')
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })
})

describe('CompletionFace model row chains into the real model face (#28)', () => {
  it('opens the vendored ModelSelect card on a popup row click', async () => {
    stubSources()
    const state: ModelDirectoryState = {
      current: { provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'high' },
      routable: true,
      groups: [{
        id: 'deepseek-account',
        name: 'DeepSeek 账号',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek-V41-Flash' }],
      }],
      failures: [],
      status: 'ready',
      pending: null,
      error: null,
    }
    const load = vi.fn(() => Promise.resolve(state))
    setModelSource(() => ({
      directoryFor: vi.fn(() => ({
        store: {
          subscribe: () => () => {},
          getSnapshot: () => state,
        },
        load,
        select: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
      })),
    }))
    setModelLocale(fakeT(modelZh) as never)

    const handle = mountRealEditor()
    try {
      mountOverRealEditor(
        handle,
        <FaceGate definition={modelFaceDefinition()}>
          <ModelSelectFace sessionId={'s1' as never} locked={false} subagent={null} />
        </FaceGate>,
      )
      await act(async () => { handle.setText('/') })
      await waitFor(() => {
        expect(options().map((row) => row.getAttribute('data-completion-option'))).toContain('model')
      })
      const model = options().find((row) => row.getAttribute('data-completion-option') === 'model')!
      // The full pointer sequence of a real click (pointerdown → mousedown →
      // mouseup → click); the pick happens on mousedown.
      fireEvent.pointerDown(model)
      fireEvent.mouseDown(model)
      fireEvent.mouseUp(model)
      fireEvent.click(model)
      await waitFor(() => {
        expect(document.body.querySelector('[role="menu"][aria-label]')).not.toBeNull()
      })
      expect(load).toHaveBeenCalled()
      expect(listbox()).toBeNull()
    } finally {
      handle.destroy()
    }
  })
})

/** The portaled second-layer card (the model card's root pane is a labeled menu). */
function chainCard(): HTMLElement | null {
  return document.body.querySelector('[role="menu"][aria-label]')
}

/** The tool-row model pill (the direct, token-free open). */
function modelPill(): HTMLElement {
  return document.querySelector('button[aria-haspopup="menu"]') as HTMLElement
}

describe('CompletionFace chain settle consumes the typed trigger (#36)', () => {
  /** The model directory the chain harness serves: two providers, one model each. */
  function chainState(): ModelDirectoryState {
    return {
      current: { provider: 'deepseek-account', model: 'deepseek-chat' },
      routable: true,
      groups: [
        {
          id: 'deepseek-account',
          name: 'DeepSeek 账号',
          models: [{ id: 'deepseek-chat', name: 'DeepSeek-V41-Flash' }],
        },
        { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt', name: 'GPT-5' }] },
      ],
      failures: [],
      status: 'ready',
      pending: null,
      error: null,
    }
  }

  /**
   * The #28 harness with a controllable selection result: the real vendored
   * model face mounted beside the popup face over a real editor, so the whole
   * chain (`/mo` → model row → model card → pick) runs on real surfaces.
   */
  function mountModelChain(
    select?: ReturnType<typeof vi.fn>,
  ): { handle: MarkdownEditorHandle; select: ReturnType<typeof vi.fn> } {
    stubSources()
    const state = chainState()
    const selectVerb = select ?? vi.fn(() => Promise.resolve({ ok: true, value: undefined }))
    setModelSource(() => ({
      directoryFor: vi.fn(() => ({
        store: { subscribe: () => () => {}, getSnapshot: () => state },
        load: vi.fn(() => Promise.resolve(state)),
        select: selectVerb,
      })),
    }))
    setModelLocale(fakeT(modelZh) as never)
    const handle = mountRealEditor()
    mountOverRealEditor(
      handle,
      <FaceGate definition={modelFaceDefinition()}>
        <ModelSelectFace sessionId={'s1' as never} locked={false} subagent={null} />
      </FaceGate>,
    )
    return { handle, select: selectVerb }
  }

  /** Pick the chainable model row through the full pointer sequence of a click. */
  async function chainIntoModelCard(): Promise<void> {
    await waitFor(() => {
      expect(options().some((row) => row.getAttribute('data-completion-option') === 'model')).toBe(true)
    })
    const model = options().find((row) => row.getAttribute('data-completion-option') === 'model')!
    fireEvent.pointerDown(model)
    fireEvent.mouseDown(model)
    fireEvent.mouseUp(model)
    fireEvent.click(model)
  }

  /** Drill the open model card into its model list and pick one row there. */
  async function pickModelInCard(title: string): Promise<void> {
    await waitFor(() => expect(chainCard()).not.toBeNull())
    // The drill switches the card's own role ('menu' → 'group'), so the rows
    // are reached through the pane, not through `chainCard()`'s selector.
    fireEvent.click(chainCard()!.querySelector('[role="menuitem"]') as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(2))
    const row = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((candidate) => candidate.textContent?.includes(title)) as HTMLElement
    fireEvent.click(row)
  }

  it('removes the typed trigger and refocuses the editor when the chained pick succeeds', async () => {
    const { handle, select } = mountModelChain()
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await waitFor(() => expect(chainCard()).not.toBeNull())
      // The card is open and the token is untouched: only a SUCCESSFUL
      // selection consumes it.
      expect(handle.getText()).toBe('/mo')
      await pickModelInCard('GPT-5')
      await waitFor(() => expect(select).toHaveBeenCalledOnce())
      await waitFor(() => expect(handle.getText()).toBe(''))
      expect(handle.view.hasFocus).toBe(true)
    } finally {
      handle.destroy()
    }
  })

  it('keeps the typed trigger when the chained selection is refused', async () => {
    const select = vi.fn(() => Promise.resolve({
      ok: false, error: { code: 'session/writer-held', message: 'held' },
    }))
    const { handle } = mountModelChain(select)
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await pickModelInCard('GPT-5')
      await waitFor(() => expect(select).toHaveBeenCalledOnce())
      await waitFor(() => expect(document.body.textContent).toContain(modelZh['error.sessionInUse']))
      expect(handle.getText()).toBe('/mo')
    } finally {
      handle.destroy()
    }
  })

  it('keeps the typed trigger when the chain is dismissed with Escape', async () => {
    const { handle } = mountModelChain()
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await waitFor(() => expect(chainCard()).not.toBeNull())
      fireEvent.keyDown(chainCard()!, { key: 'Escape' })
      await waitFor(() => expect(chainCard()).toBeNull())
      expect(handle.getText()).toBe('/mo')
    } finally {
      handle.destroy()
    }
  })

  it('keeps the typed trigger when the chain is dismissed by an outside press', async () => {
    const { handle } = mountModelChain()
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await waitFor(() => expect(chainCard()).not.toBeNull())
      fireEvent.pointerDown(document.body)
      await waitFor(() => expect(chainCard()).toBeNull())
      expect(handle.getText()).toBe('/mo')
    } finally {
      handle.destroy()
    }
  })

  it('a direct pill pick leaves the draft alone, even after a dismissed chain', async () => {
    const { handle, select } = mountModelChain()
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await waitFor(() => expect(chainCard()).not.toBeNull())
      // Dismiss the chain: its unused settle hook dies with the card, so the
      // later direct pick cannot consume the stale trigger token.
      fireEvent.pointerDown(document.body)
      await waitFor(() => expect(chainCard()).toBeNull())
      fireEvent.click(modelPill())
      await pickModelInCard('GPT-5')
      await waitFor(() => expect(select).toHaveBeenCalledOnce())
      await waitFor(() => expect(chainCard()).toBeNull())
      expect(handle.getText()).toBe('/mo')
    } finally {
      handle.destroy()
    }
  })

  it('a CAS miss is benign: a draft rewritten under the card is not re-deleted, focus still returns', async () => {
    const { handle } = mountModelChain()
    try {
      await act(async () => { handle.setText('/mo') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await chainIntoModelCard()
      await waitFor(() => expect(chainCard()).not.toBeNull())
      // The draft moved on while the card was open (a seeded draft, a session
      // switch): the pick-time span no longer carries the snapshot.
      await act(async () => { handle.setText('hello /mo') })
      await pickModelInCard('GPT-5')
      await waitFor(() => expect(handle.view.hasFocus).toBe(true))
      expect(handle.getText()).toBe('hello /mo')
    } finally {
      handle.destroy()
    }
  })

  it('the permission chain has the same semantics: an admitted preset write consumes /per', async () => {
    stubSources()
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } }))
    setPermissionSource(() => ({
      presets: {
        catalog: vi.fn(() => Promise.resolve({
          ok: true,
          value: {
            options: [
              { value: 'read-only', name: 'read-only' },
              { value: 'workspace-write', name: 'workspace-write' },
            ],
          },
        })),
      },
      remoteEvents: { $on: vi.fn(() => () => {}) },
      sessions: { binding: () => ({ session: { command } }) },
    }))
    const useProjection = (() => ({ currentValue: 'workspace-write' })) as unknown as
      PermissionSelectFaceProps['useProjection']
    const handle = mountRealEditor()
    mountOverRealEditor(
      handle,
      <FaceGate definition={permissionFaceDefinition(useProjection)}>
        <PermissionSelectFace
          useProjection={useProjection}
          sessionId={'s1' as never}
          t={tZh}
          locked={false}
          onError={() => {}}
        />
      </FaceGate>,
    )
    try {
      // The catalog read must land first: the face registers its chain opener
      // only while it is alive and rendering UI.
      await waitFor(() => expect(document.querySelector('button[data-permission-pill]')).not.toBeNull())
      await act(async () => { handle.setText('/per') })
      await waitFor(() => expect(listbox()).not.toBeNull())
      await waitFor(() => {
        expect(options().some((candidate) => candidate.getAttribute('data-completion-option') === 'permission')).toBe(true)
      })
      const row = options().find((candidate) => candidate.getAttribute('data-completion-option') === 'permission')!
      fireEvent.mouseDown(row)
      const menu = await waitFor(() => {
        const found = document.body.querySelector('[role="menu"]')
        expect(found).not.toBeNull()
        return found as HTMLElement
      })
      expect(handle.getText()).toBe('/per')
      fireEvent.click(menu.querySelector('[role="menuitem"]') as HTMLElement)
      await waitFor(() => expect(command).toHaveBeenCalledWith('/permission read-only'))
      await waitFor(() => expect(handle.getText()).toBe(''))
      expect(handle.view.hasFocus).toBe(true)
    } finally {
      handle.destroy()
    }
  })
})
