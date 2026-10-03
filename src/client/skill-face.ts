/**
 * Data plane of the chip decorations' skill lexicon (T9): the hot `/`
 * dictionary comes from the host's `remote.skills.list({ sessionId })` RPC —
 * the same catalog the native `/` completion source polls (`ui-skill`'s
 * lexicon hook), so a decorated `/name` is exactly a name the native
 * pipeline would decorate. Session-reference and `@`-shape chips need no
 * data plane and stay available without this face.
 *
 * Mirrors command-face.ts: the host surface is consumed through a local
 * structural type and capability-detected per call — a missing
 * `remote.skills` namespace degrades to `undefined` (the `/` arm then stays
 * plain text), never a throw into the card. The `remote` service is
 * deliberately NOT a declared `inject` dependency of the plugin: a host
 * build without it would hold the whole plugin pending — a lazy per-call
 * probe degrades this face alone.
 *
 * Caching and invalidation mirror the host source: one list per session,
 * dropped by the forwarded `agent-preset/selected` (a preset switch
 * recomposes which skill providers its agent reads) and `connection/reset`.
 * A failed read leaves the session uncached so a later ensure retries.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from './command-face.ts'
import type { ObservableSource, SessionId } from './conversation-face.ts'

/**
 * One skill entry as the host catalog delivers it. The chip decorations read
 * only `name`; the completion popup (T10) additionally reads the discovery
 * copy when the host provides it.
 */
export interface SkillEntry {
  /** Kebab-case identifier referenced as `/name`. */
  readonly name: string
  /** Human-readable summary, when the host supplies one. */
  readonly description?: string
  /** False when the skill is user-invocation-only (native userOnly marker). */
  readonly modelInvocable?: boolean
}

/** Per-session lexicon caches as one publishable snapshot. */
export interface SkillLexiconState {
  readonly value: ReadonlyMap<SessionId, readonly SkillEntry[]>
}

/** The skill lexicon face the chip decorations consume. */
export interface SkillFace {
  /** Snapshot store of the per-session name rolls; subscribe through `useObservable`. */
  readonly lexicons: ObservableSource<SkillLexiconState>
  /** Fetch the session's lexicon unless already cached (mount warm-up). */
  ensure(sessionId: SessionId): void
}

/** Narrow face of the host `remote.skills` namespace. */
interface SkillsRemoteFace {
  list(input: { sessionId: SessionId }, signal?: AbortSignal): Promise<RemoteResult<{ readonly skills: readonly SkillEntry[] }>>
}

/** The host service surfaces the face needs, resolved per call. */
export interface SkillSurfaces {
  readonly skills: SkillsRemoteFace
  /** Present when the `remote` service exposes forwarded events; invalidation sheds without it. */
  readonly remoteEvents: { $on(event: 'agent-preset/selected' | 'connection/reset', listener: (...args: unknown[]) => void): () => void } | undefined
}

export type SkillSource = () => SkillSurfaces | undefined

let source: SkillSource = () => undefined
let face: SkillFace | undefined

/**
 * Bind the skill source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setSkillSource(resolve: SkillSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). Each service read is its own capability check — a host
 * build without the skills namespace or the forwarded-event face degrades
 * exactly that part.
 * @param ctx - client root context.
 */
export function installSkillSource(ctx: ClientContext): void {
  setSkillSource(() => {
    try {
      const remote = ctx.get('remote') as
        | (Partial<SkillSurfaces['remoteEvents']> & { readonly skills?: Partial<SkillsRemoteFace> })
        | undefined
      const skills = remote?.skills
      if (typeof skills?.list !== 'function') return undefined
      const remoteEvents = typeof remote?.$on === 'function'
        ? remote as SkillSurfaces['remoteEvents']
        : undefined
      return { skills: skills as SkillsRemoteFace, remoteEvents }
    } catch {
      return undefined
    }
  })
}

/**
 * The skill lexicon face, or undefined while the host surfaces are absent.
 * One process-wide instance (page lifetime): the per-session caches and the
 * invalidation subscriptions are shared by every surface that reads them.
 */
export function skillFace(): SkillFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: SkillSurfaces): SkillFace {
  let snapshot: SkillLexiconState = { value: new Map() }
  const inFlight = new Set<SessionId>()
  const listeners = new Set<() => void>()
  const store: ObservableSource<SkillLexiconState> = {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): SkillLexiconState {
      return snapshot
    },
  }
  function publish(next: SkillLexiconState): void {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  function ensure(sessionId: SessionId): void {
    if (snapshot.value.has(sessionId) || inFlight.has(sessionId)) return
    inFlight.add(sessionId)
    void (async () => {
      try {
        const result = await surfaces.skills.list({ sessionId })
        inFlight.delete(sessionId)
        if (!result.ok) return // uncached: the `/` arm stays plain, a later ensure retries
        publish({ value: new Map(snapshot.value).set(sessionId, result.value.skills) })
      } catch {
        inFlight.delete(sessionId)
      }
    })()
  }
  function dropSession(sessionId: SessionId): void {
    if (!snapshot.value.has(sessionId)) return
    const next = new Map(snapshot.value)
    next.delete(sessionId)
    publish({ value: next })
  }
  function dropAll(): void {
    if (snapshot.value.size === 0) return
    publish({ value: new Map() })
  }
  // The forwarded events mirror the host source's invalidation channels;
  // without the event face the caches still serve and re-fetch on reopen
  // after a manual page reload.
  if (surfaces.remoteEvents !== undefined) {
    try {
      surfaces.remoteEvents.$on('agent-preset/selected', (...args: unknown[]) => {
        // The forwarded payload is one session id; a non-string is ignored.
        if (typeof args[0] !== 'string') return
        dropSession(args[0] as SessionId)
      })
      surfaces.remoteEvents.$on('connection/reset', () => { dropAll() })
    } catch (error: unknown) {
      console.error('[markdown-input] skill lexicon event subscription failed', error)
    }
  }
  return { lexicons: store, ensure }
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetSkillFace(): void {
  face = undefined
  source = () => undefined
}
