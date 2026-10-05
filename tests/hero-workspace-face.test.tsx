/**
 * The card-top workspace row (issue #42, ADR-0006 option B) at the composer
 * seam: the row's blank-session rule, the chip label the host chain resolves,
 * the pick menu (current check, no add row), the reuse-or-create pick, and
 * the trigger posture the whole card switches to when no workspace resolves.
 *
 * The copy is the HOST's own dictionary (`conversation` + the shared
 * vocabulary `workspace` reads), so the assertions read the very words the
 * native hero chip renders rather than this plugin's paraphrase.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en as conversationEn } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import {
  MarkdownComposer, MARKDOWN_TAKEOVER,
  type MarkdownComposerProps,
} from '../src/client/MarkdownComposer.tsx'
import { resetContextLocale, setContextLocale } from '../src/client/context-meter-face.ts'
import { resetFaces } from '../src/client/face.ts'
import { resetGoalFace } from '../src/client/goal-face.ts'
import { en as markdownInputEn } from '../src/client/locales.ts'
import { resetAgentPresetsSource, setAgentPresetsSource } from '../src/client/agent-preset-face.ts'
import type { WorkspaceRowSnapshot } from '../src/client/workspace-row-core.ts'
import {
  resetWorkspaceVerbSource, setWorkspaceVerbSource, workspaceVerbFace,
  type UiWorkspaceVerbFace,
} from '../src/client/workspace-verb.ts'
import { MARKDOWN_INPUT_EN } from './copy.ts'

/** The host `conversation` namespace, with the shared vocabulary underneath. */
const copy: Record<string, string> = { ...commonEn, ...conversationEn }

/**
 * `workspace.defaultName` lives in the SHARED `common` vocabulary, not in
 * ui-conversation's own dictionary — the namespace-bound translate consults
 * common after its own lookup misses, which is exactly how the native chip
 * resolves it (`ConversationContent.tsx:108`).
 */
const DEFAULT_WORKSPACE_NAME = commonEn['workspace.defaultName']

/** The native picker's add row title — asserted ABSENT: no directory-flow hole exists in this card. */
const ADD_WORKSPACE_ROW = 'Add workspace…'

/** Install a verb for the duration of one test (the apply-time installer seam). */
function installVerb(verb: UiWorkspaceVerbFace | undefined): void {
  setWorkspaceVerbSource(() => verb)
}

/**
 * The three seats a real host renderer materializes into this chain entry:
 * the global `useWorkspaces` (ui-workspace's root standard source) and
 * `useSessions` (ui-session's), plus the client context the row's verbs come
 * from.
 */
function hostSeats(options: {
  workspaces?: WorkspaceRowSnapshot
  cwdBySession?: Record<string, string | undefined>
  verb?: { startSession: (workspaceId?: string) => void }
  withVerb?: boolean
} = {}): { props: Partial<MarkdownComposerProps> } {
  const workspaces = options.workspaces ?? { items: [], phase: 'ready' }
  const cwdBySession = options.cwdBySession ?? {}
  // By default the reuse-or-create verb is present (a real host with
  // ui-workspace loaded); `withVerb: false` models the build without it.
  installVerb(options.verb ?? (options.withVerb === false ? undefined : { startSession: () => {} }))
  return {
    props: {
      useWorkspaces: (selector: (state: WorkspaceRowSnapshot) => unknown) => selector(workspaces),
      useSessions: (selector: (state: { byId: Record<string, { cwd?: string } | undefined> }) => unknown) =>
        selector({ byId: cwdBySession }),
    } as Partial<MarkdownComposerProps>,
  }
}

/** Chain props of the card, with the workspace seats on top. */
function chainProps(overrides: {
  session?: Record<string, unknown> | undefined
  sessionId?: string | undefined
  draft?: string
  projection?: Record<string, unknown>
  inputActions?: { setDraft: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> }
} = {}): MarkdownComposerProps {
  const inputState = {
    draft: overrides.draft ?? '',
    phase: 'plain' as const,
    attachmentIds: [],
    draftRev: 0,
    occurrences: [],
    queue: [],
    claim: undefined,
  }
  const projection = overrides.projection ?? {}
  return {
    matched: MARKDOWN_TAKEOVER,
    sessionId: overrides.sessionId === undefined ? 's1' : overrides.sessionId,
    session: overrides.session,
    useInput: (selector: (state: typeof inputState) => unknown) => selector(inputState),
    inputActions: {
      setDraft: vi.fn(), submit: vi.fn(), addAttachments: vi.fn(),
      removeAttachment: vi.fn(), pruneAttachments: vi.fn(),
      ...overrides.inputActions,
    },
    useProjection: ((key: string, selector?: (value: unknown) => unknown) => {
      const value = key in projection ? projection[key] : undefined
      return selector !== undefined ? selector(value) : value
    }),
    t: ((key: keyof typeof MARKDOWN_INPUT_EN, params?: Record<string, string>) =>
      MARKDOWN_INPUT_EN[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
    ),
  } as unknown as MarkdownComposerProps
}

function row(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-markdown-workspace-row]')
}

function chip(): HTMLButtonElement {
  const button = row()?.querySelector('button')
  if (button === null || button === undefined) throw new Error('workspace chip is not mounted')
  return button
}

function card(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-markdown-composer]')
  if (root === null) throw new Error('card is not mounted')
  return root
}

/** Menu rows from the portal list the primitive renders into document.body. */
function menuRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function menuRow(label: string): HTMLElement {
  const found = menuRows().find(item => item.textContent?.includes(label))
  if (found === undefined) throw new Error(`menu row "${label}" is not mounted`)
  return found
}

/** The blank-session chain: the native hero condition. */
function blankSession(): Record<string, unknown> {
  return { sessionId: 's1', blank: true, running: false, subagent: null, pendingSubmissions: [] }
}

beforeEach(() => {
  setContextLocale(
    ((key: string, params?: Record<string, unknown>) => {
      const template = copy[key] ?? key
      return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`))
    }) as Parameters<typeof setContextLocale>[0],
  )
})

afterEach(() => {
  cleanup()
  resetContextLocale()
  resetWorkspaceVerbSource()
  resetAgentPresetsSource()
  resetFaces()
  resetGoalFace()
})

describe('workspace row presence', () => {
  it('shows the row on a blank session with the five-level label resolved', () => {
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(row()).not.toBeNull()
    expect(chip()).toHaveTextContent('project')
    expect(chip()).toHaveAttribute('aria-haspopup', 'menu')
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
    // The chip's accessible name is the host key, never invented copy.
    expect(chip()).toHaveAttribute('aria-label', conversationEn['hero.chooseWorkspace'])
    // No trigger posture while a title resolves: the card is an ordinary
    // editable composer.
    expect(card()).not.toHaveAttribute('data-workspace-trigger')
  })

  it('shows no row on an older (non-blank) session', () => {
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(
      <MarkdownComposer
        {...chainProps({ session: { ...blankSession(), blank: false } })}
        {...seats.props}
      />,
    )
    expect(row()).toBeNull()
    expect(document.querySelector('[data-markdown-agent-preset]')).toBeNull()
  })

  it('hides the row when the workspace list hook never reached the chain', () => {
    const seats = hostSeats()
    delete (seats.props as { useWorkspaces?: unknown }).useWorkspaces
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(row()).toBeNull()
    expect(card()).not.toHaveAttribute('data-workspace-trigger')
  })

  it('hides the row when the reuse-or-create verb is absent', () => {
    // `withVerb: false` models a host build without ui-workspace: the installer
    // probed nothing and the source answers undefined.
    const seats = hostSeats({ withVerb: false })
    render(
      <MarkdownComposer
        {...chainProps({ session: blankSession() })}
        {...seats.props}
      />,
    )
    expect(row()).toBeNull()
    expect(workspaceVerbFace()).toBeUndefined()
  })

  it('hides both faces while the host copy is unbound', () => {
    resetContextLocale()
    const seats = hostSeats()
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(row()).toBeNull()
  })

  it('mounts the hero line at the TOP of the card, above the text surface', () => {
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    const children = [...card().children].map(child =>
      child.getAttribute('data-markdown-hero-row') !== null
        ? 'hero-row'
        : (child as HTMLElement).dataset.markdownSurface !== undefined ? 'surface' : 'other')
    expect(children[0]).toBe('hero-row')
    // The workspace chip rides that line (the one-line shape both seats share).
    expect(card().querySelector('[data-markdown-hero-row]')).toContainElement(row())
    expect(children.indexOf('surface')).toBeGreaterThan(0)
  })

  it('still sends the first message from inside the takeover card with the row present', async () => {
    const inputActions = { setDraft: vi.fn(), submit: vi.fn() }
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(
      <MarkdownComposer
        {...chainProps({ session: blankSession(), draft: '# hello', inputActions })}
        {...seats.props}
      />,
    )
    expect(row()).not.toBeNull()
    // The live Markdown pipeline still runs inside the card (the seeded
    // heading is rendered by the CM6 live-render layer)…
    expect(document.querySelector('.cm-md-h1')).not.toBeNull()
    // …and Enter still mirrors the draft and submits through the machine.
    fireEvent.keyDown(document.querySelector('.cm-content') as HTMLElement, { key: 'Enter' })
    await waitFor(() => { expect(inputActions.submit).toHaveBeenCalledTimes(1) })
    expect(inputActions.setDraft).toHaveBeenCalled()
  })
})

describe('workspace pick menu', () => {
  it('lists the workspaces, checks the owning one, and offers no add row', () => {
    const seats = hostSeats({
      workspaces: {
        items: [
          { workspaceId: 'w1', title: 'default-workspace', sessionIds: ['s1'] },
          { workspaceId: 'w2', title: 'project', sessionIds: [] },
        ],
        phase: 'ready',
      },
    })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    // The owning workspace labels the chip through the host's own default name.
    expect(chip()).toHaveTextContent(DEFAULT_WORKSPACE_NAME)
    fireEvent.click(chip())
    const rows = menuRows()
    expect(rows).toHaveLength(2)
    expect(rows.map(item => item.textContent)).toEqual([
      DEFAULT_WORKSPACE_NAME,
      'project',
    ])
    // The current workspace carries the trailing check (native `selectedId`).
    expect(rows[0]?.querySelector('svg')).not.toBeNull()
    // The native add row exists only when the surface's directory-flow hole is
    // occupied, which cannot happen inside this card.
    expect(document.body.textContent).not.toContain(ADD_WORKSPACE_ROW)
    expect(chip()).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the menu on Escape', () => {
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    fireEvent.click(chip())
    expect(menuRows()).toHaveLength(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menuRows()).toHaveLength(0)
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
  })

  it('picks through the native reuse-or-create verb and switches', () => {
    const startSession = vi.fn()
    const seats = hostSeats({
      workspaces: {
        items: [
          { workspaceId: 'w1', title: 'project', sessionIds: ['s1'] },
          { workspaceId: 'w2', title: 'other', sessionIds: [] },
        ],
        phase: 'ready',
      },
      verb: { startSession },
    })
    const view = render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    fireEvent.click(chip())
    fireEvent.click(menuRow('other'))
    expect(startSession).toHaveBeenCalledWith('w2')
    // The pending pick names the clicked workspace immediately (native
    // `pendingWorkspaceId`), and the menu is closed.
    expect(menuRows()).toHaveLength(0)
    expect(chip()).toHaveTextContent('other')
    // Once the session lands in it, the pending pick clears and the list's own
    // truth takes over again.
    const moved = hostSeats({
      workspaces: {
        items: [
          { workspaceId: 'w1', title: 'project', sessionIds: [] },
          { workspaceId: 'w2', title: 'other', sessionIds: ['s1'] },
        ],
        phase: 'ready',
      },
      verb: { startSession },
    })
    view.rerender(<MarkdownComposer {...chainProps({ session: blankSession() })} {...moved.props} />)
    expect(chip()).toHaveTextContent('other')
  })
})

describe('workspace trigger posture', () => {
  it('turns the whole card into the picker when no workspace resolves', () => {
    const seats = hostSeats({ workspaces: { items: [], phase: 'ready' } })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(card()).toHaveAttribute('data-workspace-trigger')
    // The chip is present but inert: the card is the pick target.
    expect(chip()).toBeDisabled()
    const content = document.querySelector('.cm-content')
    expect(content).toHaveAttribute('contenteditable', 'false')
    // The native placeholder arm wins over the render/source copy.
    expect(content).toHaveAttribute('aria-placeholder', conversationEn['placeholder.workspace'])
  })

  it('opens the same pick menu from a whole-card click and restores the editor after a pick', () => {
    const startSession = vi.fn()
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: [] }], phase: 'ready' },
      verb: { startSession },
    })
    const view = render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(card()).toHaveAttribute('data-workspace-trigger')
    fireEvent.click(card())
    expect(menuRows()).toHaveLength(1)
    fireEvent.click(menuRow('project'))
    expect(startSession).toHaveBeenCalledWith('w1')
    // The pick resolved a workspace: the card is an ordinary composer again
    // (the pending pick supplies the label until the session lands).
    expect(card()).not.toHaveAttribute('data-workspace-trigger')
    expect(chip()).not.toBeDisabled()
    expect(document.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true')
    void view
  })

  it('does not focus the editor from a card mousedown while in the trigger posture', () => {
    const seats = hostSeats({ workspaces: { items: [], phase: 'ready' } })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    const content = document.querySelector('.cm-content')
    fireEvent.mouseDown(card())
    expect(document.activeElement).not.toBe(content)
  })

  it('keeps the card editable and posture-free when the verb is missing (today\'s behavior)', () => {
    const seats = hostSeats({ workspaces: { items: [], phase: 'ready' }, withVerb: false })
    render(
      <MarkdownComposer
        {...chainProps({ session: blankSession() })}
        {...seats.props}
      />,
    )
    expect(card()).not.toHaveAttribute('data-workspace-trigger')
    expect(document.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true')
    expect(document.querySelector('.cm-content'))
      .toHaveAttribute('aria-placeholder', markdownInputEn['composer.placeholder.render'])
  })
})

describe('workspace verb installer', () => {
  it('installs the native startSession verb lazily and degrades to undefined', () => {
    installVerb({ startSession: () => {} })
    expect(typeof workspaceVerbFace()?.startSession).toBe('function')
    resetWorkspaceVerbSource()
    expect(workspaceVerbFace()).toBeUndefined()
    // A throwing resolver reads as absent, never as a card crash.
    setWorkspaceVerbSource(() => { throw new Error('sealed') })
    expect(workspaceVerbFace()).toBeUndefined()
  })
})

describe('hero line — one row for both seats (issue #42 alpha.12 feedback)', () => {
  const roster = {
    list: () => Promise.resolve({
      ok: true as const,
      value: { presets: [{ id: 'standard', isDefault: true }] },
    }),
    select: () => Promise.resolve({ ok: true as const, value: undefined }),
  }

  it('puts the workspace chip and the agent-preset seat on the same hero line', async () => {
    setAgentPresetsSource(() => roster)
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(
      <MarkdownComposer
        {...chainProps({ session: blankSession(), projection: { agentPreset: null } })}
        {...seats.props}
      />,
    )
    const heroRow = document.querySelector('[data-markdown-hero-row]')
    expect(heroRow).not.toBeNull()
    expect(heroRow).toContainElement(row())
    await waitFor(() => {
      expect(document.querySelector('[data-markdown-agent-preset]')).not.toBeNull()
    })
    expect(heroRow).toContainElement(document.querySelector('[data-markdown-agent-preset]'))
    // Both seats share ONE parent — the native `heroWorkspaceRow` shape —
    // instead of stacking as two `.card` children (the real-device finding).
    const workspaceRow = row() as HTMLElement
    const presetSeat = document.querySelector('[data-markdown-agent-preset]') as HTMLElement
    expect(workspaceRow.parentElement).toBe(heroRow)
    expect(presetSeat.parentElement).toBe(heroRow)
  })

  it('keeps the workspace chip on the line when the preset face is absent (no dangling)', () => {
    // No roster source installed: the preset gate stays off and the line
    // stays with the chip — one absent face never leaves the other floating.
    const seats = hostSeats({
      workspaces: { items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }], phase: 'ready' },
    })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    const heroRow = document.querySelector('[data-markdown-hero-row]')
    expect(heroRow).not.toBeNull()
    expect(heroRow).toContainElement(row())
    expect(document.querySelector('[data-markdown-agent-preset]')).toBeNull()
  })

  it('mounts no hero line at all when the workspace row capability is missing', () => {
    const seats = hostSeats({ withVerb: false })
    render(<MarkdownComposer {...chainProps({ session: blankSession() })} {...seats.props} />)
    expect(document.querySelector('[data-markdown-hero-row]')).toBeNull()
    expect(row()).toBeNull()
  })
})
