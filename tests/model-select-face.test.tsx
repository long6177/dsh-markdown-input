/**
 * Seam: the tool-row model pill and its two-pane card as the user sees
 * them. The pill names the directory's current selection (`model · effort`),
 * the card is the vendored host ModelSelect — root pane with the model row
 * and the effort row (the latter only under reasoning metadata), drilling
 * into the provider-grouped model list and the effort list, all data
 * host-delivered through the model face. Selections ride the injected
 * `select` (model and effort in ONE action), a rejected selection toasts
 * the session-in-use copy, a failed catalog load shows the in-menu strip
 * with Retry, and absent surfaces hide the face without touching the rest
 * of the card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { openChainPopup, resetChainPopups } from '../src/client/chain-open.ts'
import {
  modelFaceDefinition, modelSeatFace, MODEL_NS, resetModelFace, setModelLocale,
  setModelSource, type ModelDirectoryState,
} from '../src/client/model-face.ts'
import { ModelSelectFace } from '../src/client/ModelSelectFace.tsx'
import { en as modelEn, zh as modelZh } from '../src/client/ModelSelectFace.locales.ts'

// jsdom does not implement scrollIntoView; the model pane's highlight
// sync calls it on open.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

const READY: ModelDirectoryState = {
  current: { provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'high' },
  routable: true,
  groups: [
    {
      id: 'deepseek-account',
      name: 'DeepSeek 账号',
      models: [
        {
          id: 'deepseek-chat',
          name: 'DeepSeek-V41-Flash',
          reasoning: {
            efforts: [
              { id: 'low', name: 'Low' },
              { id: 'high', name: 'High' },
            ],
            defaultEffort: 'low',
          },
        },
        { id: 'deepseek-reasoner', name: 'DeepSeek-V41-Reasoner' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      models: [{ id: 'gpt', name: 'GPT-5' }],
    },
  ],
  failures: [],
  status: 'ready',
  pending: null,
  error: null,
}

/**
 * Test translate: the vendored dictionary verbatim (zh is the source of
 * truth), the shared common vocabulary the lookup chain consults after a
 * namespace miss (`retry` lives there), and {name} template substitution.
 */
const COMMON: Record<string, string> = { retry: '重试' }
const t = vi.fn((key: string, params?: Record<string, unknown>): string => {
  const template = (modelZh as Record<string, string>)[key] ?? COMMON[key] ?? key
  return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`))
})

interface TestDirectory {
  readonly store: {
    subscribe(listener: () => void): () => void
    getSnapshot(): ModelDirectoryState
  }
  load: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
}

/** A store the test mutates directly to push host-side frames. */
function fakeDirectory(state: ModelDirectoryState) {
  const listeners = new Set<() => void>()
  const store = {
    listeners,
    get snapshot(): ModelDirectoryState {
      return state
    },
    set snapshot(next: ModelDirectoryState) {
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => state,
  }
  const directory: TestDirectory & { store: typeof store } = {
    store,
    load: vi.fn(() => Promise.resolve(state)),
    select: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  }
  return directory
}

/**
 * Bind the resolver under test and mount the gated face. `directoryState`
 * seeds the shared store; `select` replaces the verb when a test wants a
 * failing selection.
 */
function mountFace(options: {
  directoryState?: ModelDirectoryState
  sessionId?: string | undefined
  subagent?: { readonly address: unknown } | null
  select?: TestDirectory['select']
  withDirectory?: boolean
} = {}) {
  const directory = fakeDirectory(options.directoryState ?? READY)
  if (options.select !== undefined) directory.select = options.select
  const source = {
    directoryFor: vi.fn(() => directory),
  }
  if (options.withDirectory !== false) setModelSource(() => source)
  setModelLocale(t as never)
  // `'sessionId' in options` keeps an explicit undefined (no session) distinct
  // from the default s1.
  const sessionId = 'sessionId' in options ? options.sessionId : 's1'
  const view = render(createElement(FaceGate, { definition: modelFaceDefinition() },
    createElement(ModelSelectFace, {
      sessionId: sessionId as never,
      locked: sessionId === undefined,
      subagent: options.subagent ?? null,
    })))
  return { view, directory, source }
}

function trigger(): HTMLElement {
  return document.querySelector('button[aria-haspopup="menu"]') as HTMLElement
}

function openCard(): HTMLElement {
  return document.body.querySelector('[role="menu"][aria-label], [role="group"][aria-label]') as HTMLElement
}

function menuRows(scope: ParentNode = document.body): HTMLElement[] {
  return [...scope.querySelectorAll('[role="menuitem"]')] as HTMLElement[]
}

afterEach(() => {
  cleanup()
  resetModelFace()
  resetFaces()
  resetChainPopups()
  t.mockClear()
})

describe('absent surfaces hide the face alone', () => {
  it('renders nothing when the host has no modelDirectories service', () => {
    const { view } = mountFace({ withDirectory: false })
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
    // The gate's probe miss — the face framework recorded the verdict.
    expect(modelSeatFace('s1', null)).toBeUndefined()
  })

  it('renders nothing while the session binding has not materialized', () => {
    setModelSource(() => ({
      directoryFor: () => { throw new Error('session "s1" resolved no binding') },
    }))
    setModelLocale(t as never)
    const view = render(createElement(FaceGate, { definition: modelFaceDefinition() },
      createElement(ModelSelectFace, { sessionId: 's1' as never, locked: false, subagent: null })))
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
  })

  it('renders nothing for an addressed subagent session', () => {
    const { view } = mountFace({ subagent: { address: { mode: 'addressed' } } })
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
  })
})

describe('the pill', () => {
  it('names the current model and effort', () => {
    const { view } = mountFace()
    const pill = view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement
    expect(pill).not.toBeNull()
    expect(pill.textContent).toContain('DeepSeek-V41-Flash')
    expect(pill.textContent).toContain('High')
    expect(pill.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows the loading copy while the directory has no selection yet', () => {
    const { view } = mountFace({
      directoryState: { ...READY, current: null, status: 'loading' },
    })
    const pill = view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement
    expect(pill.textContent).toContain(modelZh['trigger.loading'])
  })

  it('retains the effort caption when the selected model left the catalog', () => {
    const { view } = mountFace({
      directoryState: {
        ...READY,
        current: { provider: 'gone', model: 'gone', reasoningEffort: 'high' },
        retainedEffort: 'High',
        routable: false,
      },
    })
    const pill = view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement
    expect(pill.textContent).toContain('High')
  })

  it('renders nothing without a session (the owner lock has nothing to write against)', () => {
    // The busy phases never reach the face: the composer passes only the
    // session-owner lock. This asserts the lock wiring; the busy-phase
    // freedom is the composer's contract (locked = sessionId undefined).
    const { view } = mountFace({ sessionId: undefined })
    expect(view.container.querySelector('button[aria-haspopup="menu"]')).toBeNull()
  })
})

describe('the two-pane card', () => {
  it('opens the root pane with the model and effort rows above the trigger', async () => {
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    const card = openCard()
    const rows = menuRows(card)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain(modelZh['menu.model'])
    expect(rows[0]?.textContent).toContain('DeepSeek-V41-Flash')
    expect(rows[1]?.textContent).toContain(modelZh['menu.effort'])
    expect(rows[1]?.textContent).toContain('High')
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('omits the effort row when the current model carries no reasoning metadata', async () => {
    const { view } = mountFace({
      directoryState: {
        ...READY,
        current: { provider: 'deepseek-account', model: 'deepseek-reasoner' },
      },
    })
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    const rows = menuRows(openCard())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.textContent).toContain(modelZh['menu.model'])
    // The pill still names the plain model.
    expect(trigger().textContent).toContain('DeepSeek-V41-Reasoner')
  })

  it('drills into the provider-grouped model list and selects there', async () => {
    const { view, directory } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    // The model pane: group heading in host copy, rows across groups.
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    const radios = [...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]
    const checked = radios.find((row) => row.getAttribute('aria-checked') === 'true')
    expect(checked?.textContent).toContain('DeepSeek-V41-Flash')

    fireEvent.click(radios.find((row) => row.textContent?.includes('GPT-5')) as HTMLElement)
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    expect(directory.select).toHaveBeenCalledWith({ provider: 'openai', model: 'gpt' })
    // A settled selection closes the card.
    await waitFor(() => expect(openCard()).toBeNull())
  })

  it('keeps the same-route pick a plain close (no re-submit)', async () => {
    const { view, directory } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    const checked = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((row) => row.getAttribute('aria-checked') === 'true') as HTMLElement
    fireEvent.click(checked)
    await waitFor(() => expect(openCard()).toBeNull())
    expect(directory.select).not.toHaveBeenCalled()
  })

  it('drills into the effort pane and switches effort in ONE selection action', async () => {
    const { view, directory } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[1] as HTMLElement)
    await waitFor(() => {
      const labels = [...document.body.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent)
      expect(labels.some((label) => label?.includes('Low'))).toBe(true)
    })
    // The current effort (High) is checked; pick Low.
    const low = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('Low')) as HTMLElement
    fireEvent.click(low)
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    // Same provider/model, only the effort changed — one action.
    expect(directory.select).toHaveBeenCalledWith({
      provider: 'deepseek-account', model: 'deepseek-chat', reasoningEffort: 'low',
    })
  })

  it('shows the provider-default effort row only when the model declares no default', async () => {
    // Current model declares defaultEffort 'low' → no provider-default row.
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[1] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(2))
  })

  it('lists the in-flight selection with a spinner posture', async () => {
    const { view, directory } = mountFace({
      directoryState: {
        ...READY,
        status: 'selecting',
        pending: { provider: 'openai', model: 'gpt' },
      },
    })
    const pill = view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement
    expect(pill.getAttribute('aria-busy')).toBe('true')
    // The model row for the pending selection shows the ongoing dot, not a check.
    fireEvent.click(pill)
    await waitFor(() => expect(openCard()).not.toBeNull())
    // The card carries the busy posture while a selection is unsettled.
    expect(openCard().getAttribute('aria-busy')).toBe('true')
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    const pendingRow = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('GPT-5')) as HTMLElement
    expect(pendingRow.getAttribute('aria-checked')).toBe('false')
    expect(pendingRow.disabled).toBe(true)
    void directory
  })
})

describe('keyboard and dismissal (native parity)', () => {
  it('Escape backs out of a drilled pane before closing', async () => {
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    // Drill to the model pane.
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    fireEvent.keyDown(openCard(), { key: 'Escape' })
    // Back at the root: the two rows are back.
    await waitFor(() => expect(menuRows().length).toBe(2))
    fireEvent.keyDown(openCard(), { key: 'Escape' })
    await waitFor(() => expect(openCard()).toBeNull())
  })

  it('closes on an outside pointerdown and reopens cleanly', async () => {
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(openCard()).toBeNull())
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
  })

  it('survives an outside mousedown (the chain-open gesture, #28)', async () => {
    // The `+` menu and the typed-trigger popups open this card from a row's
    // mousedown; in a real browser the dismiss listener attaches mid-dispatch
    // and the still-bubbling opening press must not close the card (jsdom
    // cannot reproduce that race, so the signal is pinned by the event type:
    // mousedown alone never dismisses — pointerdown above does).
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.mouseDown(document.body)
    expect(openCard()).not.toBeNull()
  })

  it('moves row focus with the arrow keys inside the root pane', async () => {
    const { view } = mountFace()
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    const rows = menuRows(openCard())
    fireEvent.keyDown(openCard(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(openCard(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
  })
})

describe('failure surfaces', () => {
  it('toasts the session-in-use copy when the host refuses the write', async () => {
    const { view, directory } = mountFace({
      select: vi.fn(() => Promise.resolve({
        ok: false,
        error: { code: 'session/writer-held', message: 'held' },
      })),
    })
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    const other = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((row) => row.textContent?.includes('GPT-5')) as HTMLElement
    fireEvent.click(other)
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    await waitFor(() => expect(document.body.textContent).toContain(modelZh['error.sessionInUse']))
  })

  it('shows the in-menu error strip with Retry after a failed catalog load', async () => {
    const load = vi.fn(() => Promise.reject(new Error('rpc down')))
    const { view, directory } = mountFace({
      directoryState: {
        ...READY,
        status: 'error',
        error: 'llm/catalog: rpc down',
      },
    })
    directory.load = load
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    const retry = await waitFor(() => {
      const button = [...document.body.querySelectorAll('button')].find((candidate) => candidate.textContent === COMMON.retry)
      expect(button).toBeDefined()
      return button as HTMLElement
    })
    // The strip names the failure through the localized error copy.
    expect(document.body.textContent).toContain('模型操作失败：llm/catalog: rpc down')
    // show() loaded once on open; Retry re-runs the load.
    const loadsBefore = directory.load.mock.calls.length
    fireEvent.click(retry)
    expect(directory.load.mock.calls.length).toBe(loadsBefore + 1)
    void directory
  })

  it('names a failed provider group without dropping the usable groups', async () => {
    const { view } = mountFace({
      directoryState: {
        ...READY,
        failures: [{ id: 'anthropic', name: 'Anthropic', message: 'no credentials' }],
      },
    })
    fireEvent.click(view.container.querySelector('button[aria-haspopup="menu"]') as HTMLElement)
    await waitFor(() => expect(openCard()).not.toBeNull())
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.textContent).toContain('Anthropic'))
    // Usable groups still list their models.
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
  })
})

describe('chain settle (#36)', () => {
  /**
   * Open the card the way a chain does: through the registry the seat
   * registered, handing over the settle hook a typed trigger token built
   * (`/mo` → model row). The `+` menu's `query: ''` chain passes none.
   */
  async function chainOpenCard(settle?: () => void): Promise<void> {
    await act(async () => { expect(openChainPopup('model', settle)).toBe(true) })
    await waitFor(() => expect(openCard()).not.toBeNull())
  }

  function radioRow(title: string): HTMLElement {
    const row = ([...document.body.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[])
      .find((candidate) => candidate.textContent?.includes(title))
    if (row === undefined) throw new Error(`no model row titled ${title}`)
    return row
  }

  /** Drill from the root pane into the provider-grouped model list and pick there. */
  async function pickModel(title: string): Promise<void> {
    fireEvent.click(menuRows(openCard())[0] as HTMLElement)
    await waitFor(() => expect(document.body.querySelectorAll('[role="menuitemradio"]').length).toBe(3))
    fireEvent.click(radioRow(title))
  }

  it('a successful chain pick settles the hook and still closes the card', async () => {
    const settle = vi.fn()
    const { directory } = mountFace()
    await chainOpenCard(settle)
    await pickModel('GPT-5')
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    await waitFor(() => expect(settle).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(openCard()).toBeNull())
  })

  it('picking the value in use is a settled pick too: the hook fires without a write', async () => {
    const settle = vi.fn()
    const { directory } = mountFace()
    await chainOpenCard(settle)
    // The checked row is the current provider/model pair; the same-route pick
    // writes nothing but still settles the chain.
    await pickModel('DeepSeek-V41-Flash')
    await waitFor(() => expect(settle).toHaveBeenCalledTimes(1))
    expect(directory.select).not.toHaveBeenCalled()
    await waitFor(() => expect(openCard()).toBeNull())
  })

  it('a rejected selection keeps the token (no settle) and re-arms the hook for the retry', async () => {
    const settle = vi.fn()
    const select = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'session/writer-held', message: 'held' } })
      .mockResolvedValueOnce({ ok: true, value: undefined })
    mountFace({ select })
    await chainOpenCard(settle)
    await pickModel('GPT-5')
    await waitFor(() => expect(document.body.textContent).toContain(modelZh['error.sessionInUse']))
    // Failure: the token stays in the draft and the card stays open to retry.
    expect(settle).not.toHaveBeenCalled()
    expect(openCard()).not.toBeNull()
    fireEvent.click(radioRow('GPT-5'))
    await waitFor(() => expect(settle).toHaveBeenCalledTimes(1))
  })

  it('Escape drops the unused hook: a later pill pick never settles a stale token', async () => {
    const settle = vi.fn()
    mountFace()
    await chainOpenCard(settle)
    fireEvent.keyDown(openCard(), { key: 'Escape' })
    await waitFor(() => expect(openCard()).toBeNull())
    // The user opens the card directly (the pill) and picks: no chain, no
    // consumption — the stale hook died with the dismissed chain.
    fireEvent.click(trigger())
    await waitFor(() => expect(openCard()).not.toBeNull())
    await pickModel('GPT-5')
    await waitFor(() => expect(openCard()).toBeNull())
    expect(settle).not.toHaveBeenCalled()
  })

  it('an outside pointerdown drops the hook the same way', async () => {
    const settle = vi.fn()
    mountFace()
    await chainOpenCard(settle)
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(openCard()).toBeNull())
    fireEvent.click(trigger())
    await waitFor(() => expect(openCard()).not.toBeNull())
    await pickModel('GPT-5')
    await waitFor(() => expect(openCard()).toBeNull())
    expect(settle).not.toHaveBeenCalled()
  })

  it('a dismissal racing the write revokes the settle (no consume on late success)', async () => {
    let releaseSelect: ((value: unknown) => void) | undefined
    const select = vi.fn(() => new Promise((resolve) => { releaseSelect = resolve }))
    const settle = vi.fn()
    mountFace({ select })
    await chainOpenCard(settle)
    await pickModel('GPT-5')
    await waitFor(() => expect(select).toHaveBeenCalledOnce())
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(openCard()).toBeNull())
    await act(async () => { releaseSelect?.({ ok: true, value: undefined }) })
    expect(settle).not.toHaveBeenCalled()
  })

  it('a chain with no token (the `+` menu) closes on success with nothing to settle', async () => {
    const { directory } = mountFace()
    await chainOpenCard()
    await pickModel('GPT-5')
    await waitFor(() => expect(directory.select).toHaveBeenCalledOnce())
    await waitFor(() => expect(openCard()).toBeNull())
  })
})

describe('locale', () => {
  it('serves the vendored dictionary through the plugin namespace', () => {
    expect(MODEL_NS).toBe('markdown-input.model')
    expect(modelEn['menu.effort']).toBe('Effort')
    expect(modelZh['menu.effort']).toBe('推理等级')
  })
})
