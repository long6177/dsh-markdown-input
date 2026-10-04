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
      return { goals: goals as GoalsRemoteFace, remoteEvents }
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
  return {
    async readActivation(sessionId) {
      try {
        const result = await surfaces.goals.get(sessionId)
        if (!result.ok || result.value === undefined || result.value === null) return undefined
        const view = result.value
        return { id: view.id, revision: view.revision, activation: view.activation }
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
