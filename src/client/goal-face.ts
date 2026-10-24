/**
 * Data plane of the goal strip face (issue #34, the native GoalDock the
 * takeover structurally hides): the mutation verbs ride the host's
 * `remote.goals` namespace — `get` for the live activation read, `edit`/
 * `pause`/`resume`/`clear` as CAS mutations over the projected ref — and
 * the process-local activation edges arrive through the forwarded
 * `goal/activation-changed` event with `connection/reset` re-reads, the
 * same composition the native dock's inject face makes over the durable
 * `goal` projection (which the card reads directly through useProjection).
 *
 * The host's GoalBar is not exported, so the strip is rebuilt
 * (GoalStripFace.tsx); this module is the narrow, capability-detected door
 * to the DATA surface, mirroring command-face.ts: the remote namespace is
 * consumed through a local structural type, a missing surface degrades the
 * face to `undefined` (the strip then sheds its action buttons, never its
 * visibility), and never throws into the card. The `remote.goals` service
 * is deliberately NOT a declared `inject` dependency of the plugin: a host
 * build without it would hold the whole plugin pending — a lazy per-call
 * probe degrades this face alone.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from './conversation-face.ts'
import type {
  GoalActivationEdge, GoalActionResult, GoalRefView,
} from './goal-core.ts'

/** One live goal view the activation read and the events deliver (host GoalView / GoalActivationChanged['goal'] shape). */
export interface GoalLiveActivation {
  readonly id: string
  readonly revision: number
  readonly activation: GoalActivationEdge['activation']
}

/** Narrow face of the host `remote.goals` namespace service. */
export interface GoalsRemoteFace {
  get(sessionId: SessionId): Promise<
    { readonly ok: true; readonly value: GoalLiveActivation | undefined }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
  edit(
    sessionId: SessionId,
    ref: GoalRefView,
    patch: { readonly objective: string },
  ): Promise<GoalActionResult>
  pause(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
  resume(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
  clear(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
}

/** Narrow face of the host `remote` service's forwarded-event subscription. */
interface RemoteEventFace {
  $on(event: 'goal/activation-changed' | 'connection/reset', listener: (...args: unknown[]) => void): () => void
}

/** The snapshot fields the open wait reads (host SessionSnapshot subset). */
interface SessionOpenState {
  readonly openState?: unknown
  readonly openError?: unknown
}

/** One session binding's snapshot store as the open wait reads it. */
interface SessionOpenStore {
  getSnapshot?(): SessionOpenState | undefined
  subscribe?(listener: () => void): () => void
}

/** One held session reference (`sessions.using` hands this to the operation). */
interface GoalSessionReference {
  readonly binding?: { readonly session?: SessionOpenStore } | undefined
}

/**
 * Narrow face of the host `sessions` service (the native goal read's
 * session-open wait): `using` retains the session, awaits its open promise,
 * then runs the operation; `binding` is the fallback when `using` is absent.
 */
interface GoalSessionsFace {
  binding(sessionId: SessionId): GoalSessionReference | undefined
  using?<T>(
    sessionId: SessionId,
    options: { readonly source: string },
    operation: (reference: GoalSessionReference) => Promise<T>,
  ): Promise<T>
}

/** The goal face the strip consumes. */
export interface GoalFace {
  /**
   * The live process-local activation for one session: one authoritative
   * read (the wire view's `activation`), undefined when the read answers
   * no goal or fails — the edge the strip already holds stays.
   */
  readActivation(sessionId: SessionId): Promise<GoalActivationEdge | undefined>
  /**
   * Subscribe to the session's live activation edges; an absent goal
   * delivers `undefined`. No-op (a bare dispose) without the event face.
   */
  subscribeActivation(
    sessionId: SessionId,
    listener: (goal: GoalLiveActivation | undefined) => void,
  ): () => void
  /** Subscribe to transport resets (the read trigger); no-op likewise. */
  subscribeReset(listener: () => void): () => void
  /** Replace the objective (CAS on the ref). Resolves, never throws. */
  edit(sessionId: SessionId, ref: GoalRefView, objective: string): Promise<GoalActionResult>
  /** Pause an active goal. Resolves, never throws. */
  pause(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
  /** Resume a paused goal. Resolves, never throws. */
  resume(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
  /** Clear the current goal (tombstone). Resolves, never throws. */
  clear(sessionId: SessionId, ref: GoalRefView): Promise<GoalActionResult>
}

/** The host service surfaces the face needs, resolved per call. */
export interface GoalSurfaces {
  readonly goals: GoalsRemoteFace
  /** Present when the `remote` service exposes forwarded events; live edges shed without it. */
  readonly remoteEvents: RemoteEventFace | undefined
  /**
   * Present when the host `sessions` service exposes `binding`; the
   * activation read then waits for the session to finish opening (issue #80)
   * instead of failing early on a slow session.
   */
  readonly sessions: GoalSessionsFace | undefined
}

export type GoalSource = () => GoalSurfaces | undefined

let source: GoalSource = () => undefined
let face: GoalFace | undefined

/**
 * Bind the goal source (the client apply does this once; the thunk resolves
 * per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setGoalSource(resolve: GoalSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). Each service read is its own capability check — a host
 * build without the goals namespace degrades this face alone. The
 * namespace resolves by the traced dotted service key, the same shape the
 * command face learned from the real host (#29).
 * @param ctx - client root context.
 */
export function installGoalSource(ctx: ClientContext): void {
  setGoalSource(() => {
    try {
      const goals = ctx.get('remote.goals') as Partial<GoalsRemoteFace> | undefined
      if (goals === undefined || typeof goals.get !== 'function'
        || typeof goals.edit !== 'function' || typeof goals.pause !== 'function'
        || typeof goals.resume !== 'function' || typeof goals.clear !== 'function') {
        return undefined
      }
      const remote = ctx.get('remote') as Partial<RemoteEventFace> | undefined
      const remoteEvents = typeof remote?.$on === 'function' ? (remote as RemoteEventFace) : undefined
      // The session-open wait (issue #80) is optional: without `using` the
      // read keeps the immediate behavior (or the binding-store fallback),
      // and without the service at all it is skipped.
      const sessions = ctx.get('sessions') as Partial<GoalSessionsFace> | undefined
      const sessionsFace = typeof sessions?.binding === 'function'
        ? sessions as GoalSessionsFace
        : undefined
      return { goals: goals as GoalsRemoteFace, remoteEvents, sessions: sessionsFace }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the goal face: are the host service surfaces
 * present? Pure — safe to call from a FaceGate probe.
 */
export function goalFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The goal face, or undefined while the host surfaces are absent. One
 * process-wide instance (page lifetime), like the command face.
 */
export function goalFace(): GoalFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: GoalSurfaces): GoalFace {
  /** Settle one wire verb: the value stays unread, failures map to results, nothing throws. */
  async function settle(action: () => Promise<GoalActionResult>): Promise<GoalActionResult> {
    try {
      const result = await action()
      if (!result.ok) return result
      return { ok: true }
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          code: 'failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
  /** One immediate activation read (the wire view's mapping). */
  async function readLive(sessionId: SessionId): Promise<GoalActivationEdge | undefined> {
    const result = await surfaces.goals.get(sessionId)
    if (!result.ok || result.value === undefined || result.value === null) return undefined
    const view = result.value
    return { id: view.id, revision: view.revision, activation: view.activation }
  }

  /**
   * Wait for one binding's session to finish opening (the fallback when
   * `using` is unavailable): resolves on `open`, rejects on `error`/`closed`,
   * and answers immediately for an absent store.
   */
  function waitForOpen(sessions: GoalSessionsFace, sessionId: SessionId): Promise<void> | undefined {
    const store = sessions.binding(sessionId)?.binding?.session
    if (store === undefined) return undefined
    // Already open (or no snapshot face at all): nothing to wait for.
    const state = store.getSnapshot?.()
    if (state === undefined || state.openState === 'open') return Promise.resolve()
    if (state.openState === 'error' || state.openState === 'closed') {
      return Promise.reject(state.openError instanceof Error
        ? state.openError
        : new Error(`session "${sessionId}" is not open`))
    }
    if (typeof store.subscribe !== 'function') return undefined
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = store.subscribe!(() => {
        try {
          const next = store.getSnapshot?.()
          if (next === undefined || next.openState === 'open') {
            unsubscribe?.()
            resolve()
          } else if (next.openState === 'error' || next.openState === 'closed') {
            unsubscribe?.()
            reject(next.openError instanceof Error
              ? next.openError
              : new Error(`session "${sessionId}" is not open`))
          }
        } catch (error: unknown) {
          unsubscribe?.()
          reject(error)
        }
      })
    })
  }

  return {
    async readActivation(sessionId) {
      try {
        // The native goal read's wait (ui-goal/src/client/index.ts:110-123):
        // retain the session, await its open promise, then verify openState
        // and read. A slow session therefore arms its activation edge instead
        // of failing the first read and leaving the pause button missing.
        const sessions = surfaces.sessions
        if (sessions !== undefined && typeof sessions.using === 'function') {
          return await sessions.using(sessionId, { source: 'goalActivation' }, async (reference) => {
            const state = reference?.binding?.session?.getSnapshot?.()
            if (state !== undefined && state.openState !== 'open') {
              throw state.openError instanceof Error
                ? state.openError
                : new Error(`session "${sessionId}" is not open`)
            }
            return readLive(sessionId)
          })
        }
        // Without `using`: subscribe the binding store until it opens. An
        // absent session face keeps the immediate read (the pre-#80 path).
        if (sessions !== undefined) await waitForOpen(sessions, sessionId)
        return await readLive(sessionId)
      } catch {
        return undefined
      }
    },
    subscribeActivation(sessionId, listener) {
      if (surfaces.remoteEvents === undefined) return () => {}
      try {
        return surfaces.remoteEvents.$on('goal/activation-changed', (...args: unknown[]) => {
          const event = args[0] as { sessionId?: SessionId; goal?: GoalLiveActivation } | undefined
          if (event === undefined || event === null || event.sessionId !== sessionId) return
          listener(event.goal ?? undefined)
        })
      } catch {
        return () => {}
      }
    },
    subscribeReset(listener) {
      if (surfaces.remoteEvents === undefined) return () => {}
      try {
        return surfaces.remoteEvents.$on('connection/reset', () => { listener() })
      } catch {
        return () => {}
      }
    },
    edit(sessionId, ref, objective) {
      return settle(() => surfaces.goals.edit(sessionId, ref, { objective }))
    },
    pause(sessionId, ref) {
      return settle(() => surfaces.goals.pause(sessionId, ref))
    },
    resume(sessionId, ref) {
      return settle(() => surfaces.goals.resume(sessionId, ref))
    },
    clear(sessionId, ref) {
      return settle(() => surfaces.goals.clear(sessionId, ref))
    },
  }
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetGoalFace(): void {
  face = undefined
  source = () => undefined
}
