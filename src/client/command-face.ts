/**
 * Data plane of the command menu face (tool row ①, ADR-0005 revival): the
 * command catalog comes from the host's `remote.commands.list(sessionId)`
 * RPC — the same per-session directory the native slash pipeline reads —
 * and a bare menu command runs through `remote.commands.execute`, the exact
 * detached-execution verb the host's own dispatch table calls. Commands
 * needing arguments never execute here: the menu inserts the localized
 * claim token and the submitted line is adjudicated by the host's trigger
 * pipeline (composer-revival plan §3 technical fact 1).
 *
 * The host's MenuView is not exported, so the menu is rebuilt
 * (CommandMenuFace.tsx); this module is the narrow, capability-detected door
 * to the DATA surface, mirroring permission-face.ts: the remote namespace is
 * consumed through a local structural type, a missing surface degrades the
 * face to `undefined` (the FaceGate then hides it), and never throws into
 * the card. The `remote` service is deliberately NOT a declared `inject`
 * dependency of the plugin: a host build without it would hold the whole
 * plugin pending — a lazy per-call probe degrades this face alone.
 *
 * The catalog caches per session (the host's CommandDirectory contract):
 * the forwarded `commands/change` event repulls every known session in place
 * (the ready snapshot keeps serving — native invalidateAll), `agent-preset/
 * selected` drops that one session and prewarms it, and `connection/reset`
 * drops everything and prewarms the known sessions (native resetConnected).
 * A failed read marks the session failed (no snapshot, a later ensure
 * retries — never a poisoned key); the `+` menu keeps its static built-in
 * rows for such a session, so the menu never opens empty.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { registeredFace, type FaceDefinition, type FaceHandle } from './face.ts'
import type { ObservableSource, SessionId } from './conversation-face.ts'

/** Free-form input metadata a command may advertise (host CommandInputDescriptor). */
export interface CommandInputDescriptor {
  /** Placeholder shown before the user supplies free-form input. */
  readonly hint: string
  /** Whether composer attachments may accompany an invocation. */
  readonly attachments?: boolean
}

/**
 * One host command descriptor (host CommandDescriptor, re-declared
 * structurally — the wire is the remote's own objects, these only pin the
 * contract this plugin compiles against).
 */
export interface CommandDescriptor {
  /** Stable plugin-owned identity; first-party built-ins carry the package id. */
  readonly definitionId?: string
  /** Lowercase command name without the leading slash. */
  readonly name: string
  /** Human-readable summary used in discovery UI. */
  readonly description: string
  /** Present when the command takes free-form input (claim rows). */
  readonly input?: CommandInputDescriptor
}

/** One host RPC outcome (typert-protocol RemoteResult shape). */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The host's settled command execution payload (value.result). */
export type CommandOutcome =
  | { readonly kind: 'success'; readonly text?: string }
  | { readonly kind: 'error'; readonly text: string }

/** One detached command execution outcome, mapped from the remote result. */
export type CommandExecuteResult =
  | { readonly kind: 'success' }
  /** The handler answered with an error outcome; the composer keeps the draft. */
  | { readonly kind: 'error'; readonly text: string }
  /** The host answered but knows no such command. */
  | { readonly kind: 'unmatched' }
  /** Host refusal or transport failure. */
  | { readonly kind: 'failed'; readonly message: string }

/** Per-session catalog caches as one publishable snapshot. */
export interface CommandCatalogState {
  readonly value: ReadonlyMap<SessionId, readonly CommandDescriptor[]>
  /**
   * Sessions whose latest read failed (the host directory's `failed` state):
   * no snapshot is served, the completion popup removes the command group,
   * and the failure is never a poisoned key — a later ensure retries.
   */
  readonly failed: ReadonlySet<SessionId>
}

/** The command menu face the tool-row control consumes. */
export interface CommandFace {
  /** Snapshot store of the per-session caches; subscribe through `useObservable`. */
  readonly catalogs: ObservableSource<CommandCatalogState>
  /** Fetch the session's catalog unless already cached (mount/open warm-up). */
  ensure(sessionId: SessionId): void
  /** Run one detached command line for one session; resolves, never throws. */
  execute(sessionId: SessionId, line: string): Promise<CommandExecuteResult>
}

/** Face id of the tool-row command menu in the face framework. */
export const COMMAND_FACE_ID = 'tool.commands'

/** Narrow face of the host `remote` service's forwarded-event subscription. */
interface RemoteEventFace {
  $on(event: 'commands/change' | 'agent-preset/selected' | 'connection/reset', listener: (...args: unknown[]) => void): () => void
}

/** Narrow face of the host `remote.commands` namespace. */
interface CommandsRemoteFace {
  list(sessionId: SessionId, signal?: AbortSignal): Promise<RemoteResult<readonly CommandDescriptor[]>>
  execute(
    sessionId: SessionId,
    line: string,
    submittedAttachments: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<RemoteResult<{ readonly result: CommandOutcome } | undefined>>
}

/** The host service surfaces the face needs, resolved per call. */
export interface CommandSurfaces {
  readonly commands: CommandsRemoteFace
  /** Present when the `remote` service exposes forwarded events; invalidation sheds without it. */
  readonly remoteEvents: RemoteEventFace | undefined
}

export type CommandSource = () => CommandSurfaces | undefined

let source: CommandSource = () => undefined
let face: CommandFace | undefined

/**
 * Bind the command source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setCommandSource(resolve: CommandSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). Each service read is its own capability check — a host
 * build without the commands namespace or the forwarded-event face degrades
 * exactly that part.
 * @param ctx - client root context.
 */
export function installCommandSource(ctx: ClientContext): void {
  setCommandSource(() => {
    try {
      // The host gateway installs every Remote namespace as its own traced
      // service (`remote.<namespace>`); the bare `remote` service carries
      // only `$on`/`$mount` and never namespace properties. Reading
      // `ctx.get('remote').commands` resolved to nothing on every real host
      // and latched this face off for the page life (real-device regression
      // #29); the permission face reads its namespace by the same dotted key.
      const commands = ctx.get('remote.commands') as Partial<CommandsRemoteFace> | undefined
      if (typeof commands?.list !== 'function' || typeof commands?.execute !== 'function') {
        return undefined
      }
      const remote = ctx.get('remote') as Partial<RemoteEventFace> | undefined
      const remoteEvents = typeof remote?.$on === 'function' ? (remote as RemoteEventFace) : undefined
      return { commands: commands as CommandsRemoteFace, remoteEvents }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the command face: are the host service surfaces
 * present? Pure — safe to call from a FaceGate probe (no store creation,
 * no subscriptions).
 */
export function commandFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The FaceGate definition of the tool-row command-menu face.
 */
export function commandFaceDefinition(): FaceDefinition {
  return { id: COMMAND_FACE_ID, probe: commandFaceSupported }
}

/**
 * The downstream door to the face handle the FaceGate registered: a lookup,
 * never a registration — the gated body reads the verdict and latches
 * mid-life degrades through it.
 */
export function commandFaceHandle(): FaceHandle | undefined {
  return registeredFace(COMMAND_FACE_ID)
}

/**
 * The command face, or undefined while the host surfaces are absent. One
 * process-wide instance (page lifetime): the per-session caches and the
 * invalidation subscriptions are shared by every surface that reads them.
 */
export function commandFace(): CommandFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = createFace(surfaces)
  return face
}

function createFace(surfaces: CommandSurfaces): CommandFace {
  let snapshot: CommandCatalogState = { value: new Map(), failed: new Set() }
  const inFlight = new Set<SessionId>()
  const listeners = new Set<() => void>()
  const store: ObservableSource<CommandCatalogState> = {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot(): CommandCatalogState {
      return snapshot
    },
  }
  function publish(next: CommandCatalogState): void {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  /** Every session the face holds a verdict for (a snapshot or a failure). */
  function known(): Set<SessionId> {
    return new Set([...snapshot.value.keys(), ...snapshot.failed])
  }
  function pull(sessionId: SessionId): void {
    if (inFlight.has(sessionId)) return
    inFlight.add(sessionId)
    void (async () => {
      let result: RemoteResult<readonly CommandDescriptor[]> | 'rejected'
      try {
        const answered = await surfaces.commands.list(sessionId)
        // A malformed answer (an undefined or non-RemoteResult body from a
        // degraded bridge) reads as a failed pull, never a crash into the
        // card — the shape check keeps the old silent-tolerance contract.
        result = answered !== null && typeof answered === 'object'
          && typeof (answered as { ok?: unknown }).ok === 'boolean'
          ? answered as RemoteResult<readonly CommandDescriptor[]>
          : 'rejected'
      } catch {
        result = 'rejected'
      }
      inFlight.delete(sessionId)
      if (result === 'rejected' || !result.ok) {
        // Native refresh failure: state `failed`, snapshot dropped. The
        // popup removes the command group; the `+` menu keeps its static
        // rows (existing design); a later ensure retries. Already-failed
        // sessions publish nothing new.
        if (snapshot.failed.has(sessionId) && !snapshot.value.has(sessionId)) return
        const value = new Map(snapshot.value)
        value.delete(sessionId)
        const failed = new Set(snapshot.failed)
        failed.add(sessionId)
        publish({ value, failed })
        return
      }
      const failed = new Set(snapshot.failed)
      failed.delete(sessionId)
      publish({ value: new Map(snapshot.value).set(sessionId, result.value), failed })
    })()
  }
  function ensure(sessionId: SessionId): void {
    // A healthy cached session is served from the cache; a failed one (or an
    // unknown one) pulls — the retry path, never a poisoned key.
    if (snapshot.value.has(sessionId) && !snapshot.failed.has(sessionId)) return
    pull(sessionId)
  }
  function dropAll(): void {
    if (snapshot.value.size === 0 && snapshot.failed.size === 0) return
    publish({ value: new Map(), failed: new Set() })
  }
  // The forwarded events mirror the host CommandDirectory's invalidation
  // sources; without the event face the caches still serve and re-fetch on
  // reopen after a manual page reload.
  if (surfaces.remoteEvents !== undefined) {
    try {
      surfaces.remoteEvents.$on('commands/change', () => {
        // Soft invalidation (native invalidateAll): every known session
        // repulls in the background while its ready snapshot keeps serving —
        // no flash to the static fallback, no synthetic regression.
        for (const sessionId of known()) pull(sessionId)
      })
      surfaces.remoteEvents.$on('agent-preset/selected', (...args: unknown[]) => {
        // The forwarded payload is one session id (the host resets that
        // session's composed commands); a non-string payload is ignored.
        if (typeof args[0] !== 'string') return
        const sessionId = args[0] as SessionId
        // Hard invalidation (native resetSession): drop the known session's
        // snapshot and prewarm it immediately.
        if (snapshot.value.has(sessionId) || snapshot.failed.has(sessionId)) {
          const value = new Map(snapshot.value)
          value.delete(sessionId)
          const failed = new Set(snapshot.failed)
          failed.delete(sessionId)
          publish({ value, failed })
          ensure(sessionId)
        }
      })
      surfaces.remoteEvents.$on('connection/reset', () => {
        // Hard invalidation (native resetConnected): drop everything and
        // prewarm the known sessions.
        const knownSessions = known()
        dropAll()
        for (const sessionId of knownSessions) pull(sessionId)
      })
    } catch (error: unknown) {
      console.error('[markdown-input] command catalog event subscription failed', error)
    }
  }
  async function execute(sessionId: SessionId, line: string): Promise<CommandExecuteResult> {
    try {
      const result = await surfaces.commands.execute(sessionId, line, [])
      if (!result.ok) return { kind: 'failed', message: `${result.error.code}: ${result.error.message}` }
      if (result.value === undefined) return { kind: 'unmatched' }
      const outcome = result.value.result
      return outcome.kind === 'error' ? { kind: 'error', text: outcome.text } : { kind: 'success' }
    } catch (error: unknown) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { catalogs: store, ensure, execute }
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetCommandFace(): void {
  face = undefined
  source = () => undefined
}
