/**
 * Read-only views of the host services the reference features read per call
 * (#75): the `sessions` list snapshot (a session summary's origin/parent
 * linkage for subagent detection, its update time for the row's age, its
 * cwd for path addressing) and the host facts' home (user-home path
 * abbreviation). The chat-node renderer side has no standard seat, so the
 * snapshots are consumed through a lazily probed, per-call-read face — the
 * installer pattern every other face uses, with the services deliberately
 * NOT declared `inject` dependencies (a host build without them would hold
 * the whole plugin pending).
 *
 * A host without a service, or without the snapshot shape, degrades that
 * read to `undefined` and every reader takes its own fallback: all sessions
 * under the plain section, ages from the candidate creation time, un-
 * abbreviated locations. The reads are snapshot lookups, not subscriptions —
 * callers re-render through their own state and re-read per call.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/**
 * One session summary, narrowed to the fields this plugin reads. The
 * `parentId` alias is the upstream source's own spelling of the typed
 * `parentSessionId` field (a src/lib drift at dsh-v0.2.1-rc.2) — real hosts
 * answer either, so both are read.
 */
export interface SessionSummaryLike {
  /** `'subagent'` when the session was spawned by another session. */
  readonly origin?: unknown
  /** The spawning session's id (typed field spelling). */
  readonly parentSessionId?: unknown
  /** The spawning session's id (upstream source spelling, same value). */
  readonly parentId?: unknown
  /** Last update time in Unix epoch milliseconds, when recorded. */
  readonly updatedAt?: unknown
  /** The session's workspace root, when recorded. */
  readonly cwd?: unknown
}

/** The narrowed snapshot this face exposes (the host `byId` map). */
export type SessionsSnapshot = Readonly<Record<string, SessionSummaryLike | undefined>>

/** The lazy resolver the reads consult (the client context's `get`). */
export type SessionsSource = () => { get(key: string): unknown } | undefined

let source: SessionsSource = () => undefined

/**
 * Bind the sessions source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = the context is absent.
 */
export function setSessionsSource(resolve: SessionsSource): void {
  source = resolve
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply). Purely a binding — the shape checks live in the reads.
 * @param ctx - client root context.
 */
export function installSessionsSource(ctx: ClientContext): void {
  setSessionsSource(() => ctx)
}

/**
 * The host sessions list snapshot's `byId` map, or undefined while the
 * service is absent or shaped unexpectedly. Read per call so a service that
 * materializes later is still found; a throwing read (sealed globals,
 * exotic host builds) reads as absent — a read must never be the thing that
 * throws into the card.
 */
export function sessionSnapshot(): SessionsSnapshot | undefined {
  try {
    const sessions = source()?.get('sessions') as
      | { list?: { getSnapshot?: () => { byId?: unknown } } }
      | undefined
    const byId = sessions?.list?.getSnapshot?.()?.byId
    if (byId === undefined || byId === null || typeof byId !== 'object') return undefined
    return byId as SessionsSnapshot
  } catch {
    return undefined
  }
}

/**
 * The host facts' home directory (the bare `remote` service's `$host`
 * snapshot — a gateway field, not one of the traced `remote.<namespace>`
 * services), or undefined while it is absent or not a string. Location
 * abbreviations degrade to the full path without it.
 */
export function hostHome(): string | undefined {
  try {
    const home = (source()?.get('remote') as { $host?: { home?: unknown } } | undefined)?.$host?.home
    return typeof home === 'string' ? home : undefined
  } catch {
    return undefined
  }
}

/**
 * Test seam: drop the source so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetSessionsSource(): void {
  source = () => undefined
}
