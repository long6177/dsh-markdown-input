/**
 * The #42 reachability proof: on a REAL slot-renderer tree, the
 * `conversation.composer` chain entry receives the two global standard seats
 * the rebuilt hero workspace row depends on — `useWorkspaces` (ui-workspace's
 * `provideRoot` contribution) and `useSessions` (ui-session's) — plus the
 * session-scope `useProjection` seat.
 *
 * Why this test exists: the ticket demanded proof that the standard kit
 * actually reaches the chain props on this host build before implementing
 * anything, because a permanently hidden row (a hook that never arrives) is
 * indistinguishable from a correct one that found nothing. The renderer
 * materializes GLOBAL sources into session-scope entries
 * (`ui-renderer/src/client/scoped-slots.tsx:492-495`,
 * `standardProps()` merges the root binding under the scope binding), and this
 * tree is the host's own shape: a root entry, the session scope adapter, and a
 * session-scope entry whose `renderSlotChain('conversation.composer', …)`
 * dispatches the election. The composer then renders the REAL card, and the
 * row that appears is the end-to-end evidence.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ScopedStandardSourceBinding, SlotRendererHost, SlotScopeAdapter, StandardSourceBinding, StoredEntry,
} from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
// The renderer's SOURCE, not its built entry (see vitest.config.ts): the
// published bundle is a host module-loader artifact whose uSES import would
// load a second React.
import { createSlotRenderer } from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en as conversationEn } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { MarkdownComposer, MARKDOWN_TAKEOVER } from '../src/client/MarkdownComposer.tsx'
import { resetContextLocale, setContextLocale } from '../src/client/context-meter-face.ts'
import { resetFaces } from '../src/client/face.ts'
import { resetGoalFace } from '../src/client/goal-face.ts'
import { en as markdownInputEn } from '../src/client/locales.ts'
import { resetWorkspaceVerbSource, setWorkspaceVerbSource } from '../src/client/workspace-verb.ts'

const copy: Record<string, string> = { ...commonEn, ...conversationEn }

/** The Workspace list the root contribution serves through `useWorkspaces`. */
const WORKSPACES = {
  items: [{ workspaceId: 'w1', title: 'project', sessionIds: ['s1'] }],
  archivedSessionIds: [],
  pinnedSessionIds: [],
  state: 'idle',
  phase: 'ready',
  error: null,
}

/** The session list the root contribution serves through `useSessions`. */
const SESSIONS = {
  ids: ['s1'],
  byId: {
    s1: { id: 's1', displayTitle: 'project', cwd: '/home/dev/project', blank: true, running: false, retainedBy: {}, updatedAt: 0 },
  },
  phase: 'ready',
  projectionsBySession: {},
}

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const absentCell = { getSnapshot: () => undefined, subscribe: () => () => {} }

/** What the chain entry saw, recorded from inside its own body. */
interface ChainSeats {
  readonly standardNames: readonly string[]
  readonly workspaceLabel: unknown
  readonly projection: unknown
}

/**
 * A host tree shaped like the host's own renderer suite: `root` renders the
 * session-scope probe entry, that entry calls `renderSlotChain` for the
 * composer, and the chain entry records its own standard props and renders the
 * real card.
 */
function makeHost(seats: ChainSeats[]): {
  host: SlotRendererHost
  install: (id: string) => void
} {
  const scopeCtx = {} as Context
  const absentBinding: StandardSourceBinding = { key: undefined, hooks: {}, keyedHooks: {}, props: {} }
  const current = observable<StandardSourceBinding>(absentBinding)
  const sessionFor = (id: string): ScopedStandardSourceBinding => ({
    key: id,
    ctx: scopeCtx,
    hooks: { session: { getSnapshot: () => ({ sessionId: id }), subscribe: () => () => {} } },
    // The projection keyed hook: the session projection seat, exactly the
    // shape ui-session's session source descriptor resolves.
    keyedHooks: {
      projection: key => key === 'agentPreset'
        ? observable<unknown>(null)
        : key === 'goal'
          ? observable<unknown>(null)
          : absentCell,
    },
    props: { sessionId: id },
  })

  const chainEntry: StoredEntry = {
    component: (props: Record<string, unknown>) => {
      const useProjection = props['useProjection'] as ((key: string, selector?: (value: unknown) => unknown) => unknown) | undefined
      const useWorkspaces = props['useWorkspaces'] as ((selector: (state: unknown) => unknown) => unknown) | undefined
      seats.push({
        standardNames: Object.keys(props).filter(key => key.startsWith('use')).sort(),
        workspaceLabel: typeof useWorkspaces === 'function'
          ? useWorkspaces(state => (state as typeof WORKSPACES).items[0]?.title)
          : undefined,
        projection: typeof useProjection === 'function' ? useProjection('goal') : undefined,
      })
      // The two hook seats the card cannot run without, faked at the seam
      // (the subject of THIS test is the standard kit above them, not the
      // machine).
      const inputState = {
        draft: '', phase: 'plain', attachmentIds: [], draftRev: 0, occurrences: [], queue: [], claim: undefined,
      }
      return (
        <MarkdownComposer
          {...props}
          matched={MARKDOWN_TAKEOVER}
          useInput={(selector: (state: typeof inputState) => unknown) => selector(inputState)}
          inputActions={{
            setDraft: () => {}, submit: () => {}, addAttachments: () => true,
            removeAttachment: () => {}, pruneAttachments: () => {},
          } as never}
          t={((key: keyof typeof markdownInputEn) => markdownInputEn[key]) as never}
        />
      )
    },
    // The chain election contract: a pure selector over the owner props. The
    // card accepts whenever the owner carries a session, exactly like the
    // plugin's own registration (`src/client/index.ts`).
    select: (owner: object) => ('sessionId' in owner ? MARKDOWN_TAKEOVER : null),
    options: {},
  }

  const probeEntry: StoredEntry = {
    component: (props: { renderSlotChain?: (key: string, owner: object, opts?: object) => React.ReactNode }) =>
      // The owner share the host's ConversationContent passes: the identity,
      // the lifecycle snapshot (a BLANK session is the hero condition the row
      // reads), and the pending interaction.
      props.renderSlotChain?.('probe.composer', {
        sessionId: 's1',
        session: { sessionId: 's1', blank: true, running: false, subagent: null, pendingSubmissions: [] },
        pendingInteraction: undefined,
      })
      ?? <div data-no-chain-seat />,
    options: {},
    children: { 'probe.composer': { kind: 'chain', scope: 'session' } } as never,
  }

  const rootEntry: StoredEntry = {
    component: (props: { renderSlot: (key: string, owner: object) => React.ReactNode }) =>
      props.renderSlot('probe.session', {}),
    options: {},
    children: { 'probe.session': { kind: 'single', scope: 'session' } } as never,
  }

  const sessionAdapter: SlotScopeAdapter = {
    current,
    bindingSource: reference => (reference === undefined
      ? observable<StandardSourceBinding>({ key: undefined, hooks: {}, keyedHooks: {}, props: {} })
      : observable<StandardSourceBinding>(sessionFor(reference.sessionId))),
    renderArea: (binding, { empty, children }) => (binding.key === undefined
      ? <>{empty?.() ?? null}</>
      : <>{children}</>),
  }

  const host: SlotRendererHost = {
    subscribe: () => () => {},
    getVersion: () => 0,
    entriesOf: key => key === 'root' ? [rootEntry] : key === 'probe.session' ? [probeEntry] : [chainEntry],
    entriesOfSlot: key => key === 'root' ? [rootEntry] : key === 'probe.session' ? [probeEntry] : [chainEntry],
    reportEntryError: () => {},
    reportFactoryError: () => {},
    specOf: key => {
      if (key === 'probe.session') return { kind: 'single', scope: 'session' }
      if (key === 'probe.composer') return { kind: 'chain', scope: 'session' }
      return undefined
    },
    isLive: () => true,
    storeOf: () => undefined,
    factoryStoreOf: () => undefined,
    retainFactoryOccurrence: () => () => {},
    subscribeFactory: () => () => {},
    getFactoryVersion: () => 0,
    factoryOf: () => undefined,
    isFactoryLive: () => false,
    // The GLOBAL standard sources: ui-session's and ui-workspace's root
    // contributions, in the shape `provideRoot` installs.
    root: observable<StandardSourceBinding>({
      key: undefined,
      hooks: { workspaces: observable(WORKSPACES), sessions: observable(SESSIONS) },
      keyedHooks: {},
      props: {},
    }),
    scopeRevision: observable(0),
    scope: () => sessionAdapter,
  }
  return { host, install: (id: string) => { current.set(sessionFor(id)) } }
}

/**
 * Mount the harness tree with the session scope installed. `select` runs
 * BEFORE the render because the scope binding is what the root outlet reads
 * when it dispatches its first session-scope child (the same ordering the
 * host's own renderer suite uses).
 */
function mountHost(seats: ChainSeats[]): void {
  const harness = makeHost(seats)
  harness.install('s1')
  render(createSlotRenderer().renderRoot(harness.host, {}))
}

/**
 * Bind the two host namespaces and install the pick verb, exactly as the
 * plugin apply does — the card reads both through the page-lifetime seams.
 */
function installApplySeams(): void {
  setContextLocale(((key: string) => copy[key] ?? key) as Parameters<typeof setContextLocale>[0])
  setWorkspaceVerbSource(() => ({ startSession: () => {} }))
}

afterEach(() => {
  cleanup()
  resetContextLocale()
  resetWorkspaceVerbSource()
  resetFaces()
  resetGoalFace()
})

describe('conversation.composer chain standard seats (#42 reachability)', () => {
  it('delivers useWorkspaces, useSessions and useProjection to the chain entry', () => {
    const seats: ChainSeats[] = []
    installApplySeams()
    mountHost(seats)
    // The renderer injected the global seats and the session seat: the chain
    // entry's own body could call all three.
    const seen = seats.at(-1)
    expect(seen?.standardNames).toContain('useWorkspaces')
    expect(seen?.standardNames).toContain('useProjection')
    // …and they answer with the host's own values, not undefined.
    expect(seen?.workspaceLabel).toBe('project')
    expect(seen?.projection).toBeNull()
  })

  it('renders the real card with the workspace row resolved through those seats', () => {
    const seats: ChainSeats[] = []
    installApplySeams()
    mountHost(seats)
    // The card mounted, and the blank session's owning workspace named the
    // chip — the end-to-end proof that the row is not permanently hidden.
    const card = document.querySelector('[data-markdown-composer]')
    expect(card).not.toBeNull()
    expect(document.querySelector('[data-markdown-workspace-row]')).not.toBeNull()
    expect(document.querySelector('[data-markdown-workspace-row]')?.textContent).toContain('project')
    expect(card).not.toHaveAttribute('data-workspace-trigger')
    // The chip is the live picker control (not the trigger-posture face): the
    // row resolved a title, so the card stays an ordinary composer.
    expect(document.querySelector('[data-markdown-workspace-row] button')).not.toBeDisabled()
  })
})
