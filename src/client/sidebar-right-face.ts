/**
 * Data plane of the reference-chip activations (#75): the right-sidebar
 * navigation controller the native FileReference and skill source call.
 * `openResource(address)` claims, places, reveals, and records the
 * navigation — and its SYNCHRONOUS throw is the navigation failure the
 * native retry dialogs key on, so the face forwards it verbatim (no
 * catch-and-undefined here; a swallowed throw would silence the retry
 * affordance). The face is a thin, capability-detected door (the installer
 * pattern): a host without the service degrades to `undefined` and the
 * chips stay display-only spans.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Narrow face of the host `sidebarRight` service. */
export interface SidebarRightFace {
  /**
   * Open a `dsh-resource://` address: claim it, place it, reveal the
   * column, record the navigation.
   * @throws when no registered type accepts the address — a wiring
   *   mistake, and exactly the signal the file-retry dialog replays on.
   */
  openResource(address: string): void
}

/** The host service surfaces the face needs, resolved per call. */
export interface SidebarRightSurfaces {
  readonly sidebarRight: SidebarRightFace
}

export type SidebarRightSource = () => SidebarRightSurfaces | undefined

let source: SidebarRightSource = () => undefined
let face: SidebarRightFace | undefined

/**
 * Bind the sidebar-right source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy surfaces resolver; `undefined` = surfaces absent.
 */
export function setSidebarRightSource(resolve: SidebarRightSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply).
 * @param ctx - client root context.
 */
export function installSidebarRightSource(ctx: ClientContext): void {
  setSidebarRightSource(() => {
    try {
      const sidebarRight = ctx.get('sidebarRight') as Partial<SidebarRightFace> | undefined
      if (typeof sidebarRight?.openResource !== 'function') return undefined
      return { sidebarRight: sidebarRight as SidebarRightFace }
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the sidebar-right face: is the host service present?
 * Pure — safe to call from a FaceGate probe.
 */
export function sidebarRightFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The sidebar-right face, or undefined while the host service is absent.
 * One process-wide instance (page lifetime).
 */
export function sidebarRightFace(): SidebarRightFace | undefined {
  if (face !== undefined) return face
  const surfaces = source()
  if (surfaces === undefined) return undefined
  face = surfaces.sidebarRight
  return face
}

/**
 * Test seam: drop the singleton and the source so a fresh test sees fresh
 * surfaces. Never call in plugin code — the face is page-lifetime by design.
 */
export function resetSidebarRightFace(): void {
  face = undefined
  source = () => undefined
}
