/**
 * The workspace row's add-flow verb plane (issue #42 alpha.13 retest): the
 * menu footer's "add workspace" action, read off TWO host services.
 *
 * The native picker's add row only exists when the surface's
 * `conversation.hero.workspace.directoryFlow` hole has an occupant — the
 * composed-flow package's slot UI that opens the OS directory chooser and
 * hands the picked path back. The card mounts no such hole, but the flow's
 * two MOVES are public verbs this plugin can reach directly, so the row needs
 * no hole at all:
 *
 * - `ctx.get('uiWorkspace').pickDirectory()` — the Host-native directory
 *   picker over RPC (`ui-workspace/src/client/navigation.ts:266-270`); null
 *   means the user cancelled;
 * - `ctx.get('workspaces').create({ path })` — register the picked directory
 *   as a Workspace (`packages/api/workspace-controller/src/client/service.ts`),
 *   rejecting with `workspace/invalid-path` / `workspace/name-conflict`.
 *
 * After adoption the flow continues through the SAME pick verb the rows use
 * (`uiWorkspace.startSession`, workspace-verb.ts): the created Workspace id
 * goes to `onPick`, which is exactly the native `adoptDirectory` tail
 * (`WorkspacePicker.tsx:131-139`).
 *
 * Resolution is the installer pattern every other face in this plugin uses
 * (`workspace-verb.ts`, `goal-face.ts`): the client apply hands in a lazy
 * thunk resolving both services per call, so boot order stays free. It is
 * deliberately NOT a declared `inject` dependency of the plugin: a missing
 * service would hold the whole plugin pending. The face is present only when
 * BOTH halves probe — a picker without adoption (or the reverse) is an add
 * row that dead-ends halfway, and the face rule hides a half-reachable flow
 * whole (the row disappears, the menu keeps its workspace rows).
 *
 * Copy rides the HOST `workspace` namespace (ui-workspace's own dictionary —
 * `menu.addWorkspace`, `folderError.title`, `folderError.retry`), bound
 * read-only in apply; the plugin's locales.ts ships the host strings verbatim
 * as fallback keys, so a dictionary miss still speaks the native words.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { WorkspaceAddHostTranslate } from './workspace-row-core.ts'

/** The host namespace the add flow's copy lives in (ui-workspace's locale NS). */
export const WORKSPACE_ADD_NS = 'workspace'

/** Narrow face of the host `uiWorkspace` service: the OS directory chooser. */
export interface DirectoryPickerFace {
  /**
   * Open the Host-native directory picker.
   * @returns the selected directory, or null when cancelled.
   */
  pickDirectory(): Promise<string | null>
}

/** Narrow face of the host `workspaces` service: adopt a directory. */
export interface WorkspaceCreateFace {
  /**
   * Register an existing path as a Workspace.
   * @param input - Host create payload (the picked directory path).
   * @returns the created (or idempotently resolved) Workspace.
   */
  create(input: { path: string }): Promise<{ workspaceId: string }>
}

/** The add flow needs both halves: pick a folder, adopt it. */
export interface WorkspaceAddFace {
  /** Open the Host-native directory picker; null = the user cancelled. */
  pickDirectory(): Promise<string | null>
  /** Register the picked directory as a Workspace (rejects on invalid path / conflict). */
  createWorkspace(input: { path: string }): Promise<{ workspaceId: string }>
}

export type WorkspaceAddSource = () => WorkspaceAddFace | undefined

let source: WorkspaceAddSource = () => undefined

/**
 * Bind the add-flow source (the client apply does this once; the thunk
 * resolves per call so boot order stays free).
 * @param resolve - lazy resolver; `undefined` = a half is absent.
 */
export function setWorkspaceAddSource(resolve: WorkspaceAddSource): void {
  source = resolve
}

/**
 * The add-flow face, or undefined while either host half is absent. Read per
 * call (a render, a flow start) so services that materialize later are still
 * found; a throwing `ctx.get` (sealed globals, exotic host builds) reads as
 * absent — an add probe must never be the thing that throws into the card.
 */
export function workspaceAddFace(): WorkspaceAddFace | undefined {
  try {
    return source()
  } catch {
    return undefined
  }
}

/**
 * Install the lazy resolver on the client root context (called once from the
 * plugin apply). Both services are capability-detected: a service without the
 * expected verb reads as absent, and the face is only complete when both are.
 * The wrapper face is cached against the two service identities, so the face
 * this installer hands out is as stable as the services themselves (the same
 * identity the pick verb's installer returns by handing the service object
 * straight through) — a per-call rebuild would churn every consumer callback.
 * @param ctx - client root context.
 */
export function installWorkspaceAddSource(ctx: ClientContext): void {
  let cached: { readonly ui: unknown; readonly workspaces: unknown; readonly face: WorkspaceAddFace } | undefined
  setWorkspaceAddSource(() => {
    try {
      const ui: unknown = ctx.get('uiWorkspace')
      const workspaces: unknown = ctx.get('workspaces')
      if (cached !== undefined && cached.ui === ui && cached.workspaces === workspaces) return cached.face
      if (ui === undefined || ui === null || workspaces === undefined || workspaces === null) return undefined
      const pickerCandidate = ui as Partial<DirectoryPickerFace>
      const creatorCandidate = workspaces as Partial<WorkspaceCreateFace>
      if (typeof pickerCandidate.pickDirectory !== 'function' || typeof creatorCandidate.create !== 'function') {
        return undefined
      }
      const picker = ui as DirectoryPickerFace
      const creator = workspaces as WorkspaceCreateFace
      const face: WorkspaceAddFace = {
        pickDirectory: () => picker.pickDirectory(),
        createWorkspace: input => creator.create(input),
      }
      cached = { ui, workspaces, face }
      return face
    } catch {
      return undefined
    }
  })
}

let localeT: WorkspaceAddHostTranslate | undefined

/**
 * Bind the add flow's translate seat (the client apply does this once,
 * beside the other namespace bindings). The `workspace` namespace belongs to
 * ui-workspace, which registers it in its own plugin body, so binding here is
 * a read, never a claim. The namespace is outside this build's merge table
 * (no dsh-client-ui-workspace types), so `bind` resolves through its untyped
 * overload and the seat is narrowed at this module's boundary.
 * @param t - the `workspace` namespace translate.
 */
export function setWorkspaceAddLocale(t: WorkspaceAddHostTranslate): void {
  localeT = t
}

/**
 * The add flow's translate seat, or undefined before apply binds it — the
 * card then renders the plugin's own verbatim fallback copy
 * (`resolveAddWorkspaceCopy`'s unbound arm), never raw keys.
 */
export function workspaceAddLocale(): WorkspaceAddHostTranslate | undefined {
  return localeT
}

/**
 * Test seam: drop the binding so a fresh test sees an unbound face. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetWorkspaceAddLocale(): void {
  localeT = undefined
}

/**
 * Test seam: drop the source so a fresh test sees fresh surfaces. Never call
 * in plugin code — the binding is page-lifetime by design.
 */
export function resetWorkspaceAddSource(): void {
  source = () => undefined
}
