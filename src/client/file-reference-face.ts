/**
 * Data plane of the `@` completion popup's file search (T10): the candidates
 * come from the host's `remote.fileReferences.list(sessionId, query, signal)`
 * RPC — the same session-cwd discovery the native `@` reference source reads.
 * The face is a thin, capability-detected door (mirroring skill-face.ts): the
 * namespace is consumed through a local structural type, a missing surface
 * degrades the face to `undefined` (the completion face then hides the `@`
 * popup — plain text input is unaffected), and never throws into the card.
 * Per-query caching and stale-while-revalidate live with the view (the
 * native pipeline refetches per track too); this face resolves every call.
 *
 * The `remote` service is deliberately NOT a declared `inject` dependency of
 * the plugin: a host build without it would hold the whole plugin pending —
 * a lazy per-call probe degrades this face alone.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { FileReferenceCandidate } from './completion-core.ts'
import type { RemoteResult } from './command-face.ts'
import type { SessionId } from './conversation-face.ts'

/** Narrow face of the host `remote.fileReferences` namespace. */
interface FileReferencesRemoteFace {
  list(sessionId: SessionId, query: string, signal?: AbortSignal): Promise<RemoteResult<readonly FileReferenceCandidate[]>>
}

/** The host service surfaces the face needs, resolved per call. */
export interface FileReferenceSurfaces {
  readonly fileReferences: FileReferencesRemoteFace
}

export type FileReferenceSource = () => FileReferenceSurfaces | undefined

/** The `@` file-search face the completion popup consumes. */
export interface FileReferenceFace {
  /**
   * Fetch one query's file/folder candidates. Resolves to the candidate list
   * — a host refusal or transport failure resolves to `[]` (the native
   * candidate-fetch failure policy: an empty group, never a throw).
   */
  search(sessionId: SessionId, query: string, signal?: AbortSignal): Promise<readonly FileReferenceCandidate[]>
}

let source: FileReferenceSource = () => undefined
let face: FileReferenceFace | undefined

/**
 * Bind the file-reference source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setFileReferenceSource(resolve: FileReferenceSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply).
 * @param ctx - client root context.
 */
export function installFileReferenceSource(ctx: ClientContext): void {
  setFileReferenceSource(() => {
    try {
      // The host gateway installs every Remote namespace as its own traced
      // service (`remote.<namespace>`); the bare `remote` service carries
      // only `$on`/`$mount` and never namespace properties (the #29 lesson).
      const fileReferences = ctx.get('remote.fileReferences') as Partial<FileReferencesRemoteFace> | undefined
      if (typeof fileReferences?.list !== 'function') return undefined
      return { fileReferences: fileReferences as FileReferencesRemoteFace }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the file-reference face: are the host service surfaces
 * present? Pure — safe to call from a FaceGate probe.
 */
export function fileReferenceFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The file-reference face, or undefined while the host surfaces are absent.
 * One process-wide instance (page lifetime).
 */
export function fileReferenceFace(): FileReferenceFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: FileReferenceSurfaces): FileReferenceFace {
  return {
    async search(sessionId, query, signal) {
      try {
        const result = await surfaces.fileReferences.list(sessionId, query, signal)
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
export function resetFileReferenceFace(): void {
  face = undefined
  source = () => undefined
}
