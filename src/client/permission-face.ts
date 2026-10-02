/**
 * Data plane of the permission face (tool row ②, ADR-0005 revival): the
 * current preset rides the host's `permissions` session projection, the
 * selectable catalog comes from the host's `remote.permissionPresets`
 * namespace RPC with its forwarded invalidation event, and a switch writes
 * `/permission <preset>` through the live session's command face — the
 * token is the preset id itself and the pushed projection frame is the one
 * confirmation (no optimistic commit lives here).
 *
 * The view components of the host's permission picker are not exported, so
 * the face is rebuilt; this module is the narrow, capability-detected door
 * to its DATA surfaces, mirroring conversation-face.ts: every runtime
 * member is consumed through a local structural type, a missing surface
 * degrades the face to `undefined` (the FaceGate then hides it), and never
 * throws into the card.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registeredFace, type FaceDefinition, type FaceHandle } from './face.ts'
import type { ObservableSource, SessionId } from './conversation-face.ts'

/** Presentation for one selectable preset (host `PresetOption` shape). */
export interface PresetOption {
  /** Stable option value: a configured preset key, live `auto`, or derived `custom`. */
  readonly value: string
  /** The display label the host catalog carries. */
  readonly name: string
  /** One user-facing sentence on what the value means; omitted when not configured. */
  readonly description?: string
}

/** Process-level permission catalog (host `PermissionCatalog` shape). */
export interface PermissionCatalog {
  /** Every currently selectable preset, in contribution order. */
  readonly options: readonly PresetOption[]
}

/** Whole `permissions` session projection: the effective current value. */
export interface PermissionSelection {
  readonly currentValue: string
}

/** One `/permission` write outcome, mapped from the session command result. */
export type PermissionSubmitResult =
  | { readonly kind: 'admitted' }
  /** The host answered but knows no `/permission` command — the surface is gone. */
  | { readonly kind: 'unmatched' }
  /** Host refusal, transport failure, or no live session binding. */
  | { readonly kind: 'failed'; readonly message: string }

/** Observable catalog snapshot; `null` until one read succeeds for this generation. */
export interface PermissionCatalogState {
  readonly value: PermissionCatalog | null
}

/** The permission face the tool-row control consumes. */
export interface PermissionFace {
  /** Snapshot store of the process catalog; subscribe through `useObservable`. */
  readonly catalog: ObservableSource<PermissionCatalogState>
  /** Re-read the catalog (mount-time catch-up, invalidation events, retries). */
  refresh(): void
  /** Write one preset switch for one session; resolves, never throws. */
  submit(sessionId: SessionId, preset: string): Promise<PermissionSubmitResult>
}

/** Face id of the tool-row permission control in the face framework. */
export const PERMISSION_FACE_ID = 'tool.permission'

/** Narrow face of the host `remote.permissionPresets` namespace service. */
interface PermissionPresetsRemote {
  catalog(): Promise<
    { readonly ok: true; readonly value: PermissionCatalog }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
}

/** Narrow face of the host `remote` service's forwarded-event subscription. */
interface RemoteEventFace {
  $on(event: 'permission-presets/catalog-changed', listener: () => void): () => void
}

/** Narrow face of one live session (the command write rides it). */
interface LiveSessionFace {
  command(line: string): Promise<
    { readonly ok: true; readonly value: { readonly matched: boolean } }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
  >
}

/** Narrow face of the host sessions service. */
interface SessionsFace {
  binding(sessionId: SessionId): { readonly session: LiveSessionFace } | undefined
}

/** The host service surfaces the face needs, resolved per call. */
interface PermissionSurfaces {
  readonly presets: PermissionPresetsRemote
  /** Present when the `remote` service exposes forwarded events; refresh-on-change sheds without it. */
  readonly remoteEvents: RemoteEventFace | undefined
  readonly sessions: SessionsFace
}

export type PermissionSource = () => PermissionSurfaces | undefined

let source: PermissionSource = () => undefined
let face: PermissionFace | undefined

/**
 * Bind the permission source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setPermissionSource(resolve: PermissionSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). Each service read is its own capability check — a host
 * build without the permission remote, the sessions service, or the
 * forwarded-event face degrades exactly that part.
 * @param ctx - client root context.
 */
export function installPermissionSource(ctx: ClientContext): void {
  setPermissionSource(() => {
    try {
      const presets = ctx.get('remote.permissionPresets') as Partial<PermissionPresetsRemote> | undefined
      const sessions = ctx.get('sessions') as Partial<SessionsFace> | undefined
      if (typeof presets?.catalog !== 'function' || typeof sessions?.binding !== 'function') return undefined
      const remote = ctx.get('remote') as Partial<RemoteEventFace> | undefined
      const remoteEvents = typeof remote?.$on === 'function' ? (remote as RemoteEventFace) : undefined
      return {
        presets: presets as PermissionPresetsRemote,
        remoteEvents,
        sessions: sessions as SessionsFace,
      }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the permission face: are the host service surfaces
 * present? Pure — safe to call from a FaceGate probe (no store creation,
 * no subscriptions).
 */
export function permissionFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The FaceGate definition of the tool-row permission face. The projection
 * hook rides the composer chain props; the service surfaces resolve lazily.
 * @param useProjection - the session projection hook as the chain delivers it.
 */
export function permissionFaceDefinition(useProjection: unknown): FaceDefinition {
  return {
    id: PERMISSION_FACE_ID,
    probe: () => typeof useProjection === 'function' && permissionFaceSupported(),
  }
}

/**
 * The downstream door to the face handle the FaceGate registered: a
 * lookup, never a registration — the gated body reads the verdict and
 * latches mid-life degrades (an unmatched write) through it, and a body
 * rendered without its gate cannot accidentally latch a probe of its own.
 */
export function permissionFaceHandle(): FaceHandle | undefined {
  return registeredFace(PERMISSION_FACE_ID)
}

/**
 * The permission face, or undefined while the host surfaces are absent.
 * One process-wide instance (page lifetime): the catalog store and the
 * invalidation subscription are shared by every surface that reads them.
 */
export function permissionFace(): PermissionFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: PermissionSurfaces): PermissionFace {
  let snapshot: PermissionCatalogState = { value: null }
  const listeners = new Set<() => void>()
  let epoch = 0
  const store: ObservableSource<PermissionCatalogState> = {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): PermissionCatalogState {
      return snapshot
    },
  }
  function publish(next: PermissionCatalogState): void {
    if (next.value === snapshot.value) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  function refresh(): void {
    // Latest read wins: a slow stale settlement must not overwrite a newer
    // catalog (the same fence the host's catalog directory runs).
    const current = ++epoch
    void (async () => {
      try {
        const result = await surfaces.presets.catalog()
        if (current !== epoch) return
        publish({ value: result.ok ? result.value : null })
      } catch {
        if (current !== epoch) return
        publish({ value: null })
      }
    })()
  }
  // The invalidation event re-reads; without the forwarded-event face the
  // catalog still refreshes on mount when empty and on explicit refreshes.
  if (surfaces.remoteEvents !== undefined) {
    try {
      surfaces.remoteEvents.$on('permission-presets/catalog-changed', () => { refresh() })
    } catch (error: unknown) {
      console.error('[markdown-input] permission catalog event subscription failed', error)
    }
  }
  async function submit(sessionId: SessionId, preset: string): Promise<PermissionSubmitResult> {
    try {
      const live = surfaces.sessions.binding(sessionId)?.session
      if (typeof live?.command !== 'function') {
        return { kind: 'failed', message: 'this session is not materialized yet' }
      }
      const result = await live.command(`/permission ${preset}`)
      if (!result.ok) return { kind: 'failed', message: `${result.error.code}: ${result.error.message}` }
      if (!result.value.matched) return { kind: 'unmatched' }
      return { kind: 'admitted' }
    } catch (error: unknown) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { catalog: store, refresh, submit }
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetPermissionFace(): void {
  face = undefined
  source = () => undefined
}
