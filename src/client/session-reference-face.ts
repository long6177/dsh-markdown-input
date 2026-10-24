/**
 * Data plane of the `@` completion popup's session mentions (#75): the
 * candidates come from the host's `remote.sessionReferenceResolver.
 * candidates(sessionId, query, signal)` RPC — the same cross-session
 * discovery the native `@` reference source reads. The face is a thin,
 * capability-detected door (mirroring file-reference-face.ts): the namespace
 * is consumed through a local structural type, a missing surface degrades
 * the face to `undefined` (the popup then assembles no session group — file
 * candidates are unaffected), and never throws into the card. Per-query
 * caching and stale-while-revalidate live with the view (the face resolves
 * every call, like the file-reference face).
 *
 * The `remote` service is deliberately NOT a declared `inject` dependency of
 * the plugin: a host build without it would hold the whole plugin pending —
 * a lazy per-call probe degrades this face alone.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from './command-face.ts'
import type { SessionId } from './conversation-face.ts'

/**
 * One session candidate of the host session-reference resolver
 * (`@deepseek-ai/dsh-session-reference` types, re-declared structurally).
 */
export interface SessionMentionCandidate {
  /** Opaque source session identity. */
  readonly sessionId: string
  /** Latest log-backed title, falling back to the opaque session id. */
  readonly label: string
  /** Display name, preferring a subagent's durable creation label. */
  readonly displayTitle?: string
  /** Source session working directory, when recorded. */
  readonly cwd?: string
  /** True when `cwd` is recorded and equals the requesting agent's. */
  readonly sameWorkspace: boolean
  /** Source session creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Canonical `@[label](dsh-session:…)` mention serialized into the draft. */
  readonly mention: string
}

/** Narrow face of the host `remote.sessionReferenceResolver` namespace. */
interface SessionReferenceResolverFace {
  candidates(sessionId: SessionId, query: string, signal?: AbortSignal): Promise<RemoteResult<readonly SessionMentionCandidate[]>>
}

/** The host service surfaces the face needs, resolved per call. */
export interface SessionReferenceSurfaces {
  readonly sessionReferenceResolver: SessionReferenceResolverFace
}

export type SessionReferenceSource = () => SessionReferenceSurfaces | undefined

/** The `@` session-mention face the completion popup consumes. */
export interface SessionReferenceFace {
  /**
   * Fetch one query's session mention candidates. Resolves to the candidate
   * list — a host refusal or transport failure resolves to `[]` (the native
   * candidate-fetch failure policy: an empty group, never a throw).
   */
  candidates(sessionId: SessionId, query: string, signal?: AbortSignal): Promise<readonly SessionMentionCandidate[]>
}

let source: SessionReferenceSource = () => undefined
let face: SessionReferenceFace | undefined

/**
 * Bind the session-reference source (the client apply does this once; the
 * thunk resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setSessionReferenceSource(resolve: SessionReferenceSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply).
 * @param ctx - client root context.
 */
export function installSessionReferenceSource(ctx: ClientContext): void {
  setSessionReferenceSource(() => {
    try {
      // The host gateway installs every Remote namespace as its own traced
      // service (`remote.<namespace>`); the bare `remote` service carries
      // only `$on`/`$mount` and never namespace properties (the #29 lesson).
      const resolver = ctx.get('remote.sessionReferenceResolver') as Partial<SessionReferenceResolverFace> | undefined
      if (typeof resolver?.candidates !== 'function') return undefined
      return { sessionReferenceResolver: resolver as SessionReferenceResolverFace }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the session-reference face: are the host service
 * surfaces present? Pure — safe to call from a FaceGate probe.
 */
export function sessionReferenceFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The session-reference face, or undefined while the host surfaces are
 * absent. One process-wide instance (page lifetime).
 */
export function sessionReferenceFace(): SessionReferenceFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: SessionReferenceSurfaces): SessionReferenceFace {
  return {
    async candidates(sessionId, query, signal) {
      try {
        const result = await surfaces.sessionReferenceResolver.candidates(sessionId, query, signal)
        return result.ok ? result.value : []
      } catch {
        return []
      }
    },
  }
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetSessionReferenceFace(): void {
  face = undefined
  source = () => undefined
}
