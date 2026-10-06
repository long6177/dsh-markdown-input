/**
 * Pure decision core of the card-top workspace row (issue #42, ADR-0006
 * option B): the takeover card keeps the election on a blank Session, which
 * hides the native `heroWorkspaceRow` with the whole chain fallback, so the
 * card rebuilds that row's two seats. This module owns everything about the
 * row that is a function of data — the native five-level label chain, the
 * picker rows, the trigger-posture verdict, and the row's own visibility —
 * with no React and no host types, so the host's resolution order is pinned
 * by unit tests instead of by a rendered tree.
 *
 * Nothing here is imported from the host: `dsh-client-ui-workspace` is not in
 * this build's dependency graph, and the two host helpers the native chain
 * uses — `workspaceTitleOf` (`packages/util/workspace-path/src/index.ts:58`)
 * and `workspaceDisplayTitle`
 * (`packages/api/workspace-controller/src/default-workspace.ts:28`) — are
 * re-declared structurally here (the `plan` key precedent), because a
 * cross-package import would put the host's module table on this plugin's
 * boot path. Keep the two re-declarations byte-faithful: the chip label is a
 * user-visible parity contract with the native hero.
 */

/**
 * The five-level chip label state. `undefined` means "no title resolved",
 * which is the native placeholder face (`t('hero.chooseWorkspace')`) AND the
 * trigger-posture arm — the native bar derives both from the same
 * `chipTitle === undefined` test (`ConversationContent.tsx:141`).
 */
export type WorkspaceLabelState = string | undefined

/** One Workspace row as the picker and the label chain read it (native `WorkspaceView` subset). */
export interface WorkspaceRowView {
  readonly workspaceId: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

/** The Workspace list projection as the global `useWorkspaces` standard hook delivers it. */
export interface WorkspaceRowSnapshot {
  readonly items: readonly WorkspaceRowView[]
  /** Monotone arrival lifecycle: `ready` is final, `pending` means the list is still loading. */
  readonly phase: 'pending' | 'ready'
}

/**
 * The native `workspaceTitleOf`: the final non-empty segment of a path under
 * either separator, empty for a separator-only path. Copied structurally from
 * `packages/util/workspace-path/src/index.ts:58`.
 * @param path - workspace directory path, POSIX or Windows spelling.
 */
export function workspaceTitleOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/**
 * The native chip basename rule: the final path segment, or the raw path when
 * the path is separator-only. Copied structurally from
 * `packages/client/ui-conversation/src/client/skeleton/EmptyHero.tsx:22`.
 * @param cwd - non-empty workspace directory path.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The native stored-title lookup: a Workspace still carrying the automatic
 * first-use title reads as the caller's localized default name, every other
 * title verbatim. Copied structurally from
 * `packages/api/workspace-controller/src/default-workspace.ts:28`.
 * @param title - stored Workspace title.
 * @param localizedDefault - `t('workspace.defaultName')` in the active language.
 */
export function workspaceDisplayTitle(title: string, localizedDefault: string): string {
  return title === 'default-workspace' ? localizedDefault : title
}

/** The session facts the label chain reads; all of them come from chain props. */
export interface WorkspaceLabelInput {
  /** Session identity from the chain props; absent only in the no-session fallback shape. */
  readonly sessionId: string | undefined
  /** The owning Workspace row: `items.find(w => w.sessionIds.includes(sessionId))`. */
  readonly sessionWorkspace: WorkspaceRowView | undefined
  /** The just-picked Workspace row (the pending pick's title wins over everything). */
  readonly pendingWorkspace: WorkspaceRowView | undefined
  /** The session list's `byId[sessionId].cwd` bridge; absent when the list does not know the session. */
  readonly cwd: string | undefined
  /** The Workspace list lifecycle: a `pending` list may still be hiding the owner. */
  readonly phase: 'pending' | 'ready'
  /** `t('workspace.defaultName')` for the automatic first-use title. */
  readonly localizedDefaultTitle: string
}

/**
 * Resolve the chip label in the native order
 * (`ConversationContent.tsx:99-108`):
 *
 * 1. a just-picked Workspace (pending) wins, so the click reads back instantly;
 * 2. no session at all — the cold-start fallback shape — is the placeholder;
 * 3. the blank session's owning Workspace, when the list has it;
 * 4. the list is still loading → the session's cwd basename bridges, so the
 *    title does not flash on refresh (an empty or unknown cwd is no title);
 * 5. the list is ready but owns no Workspace (deleted from the sidebar) →
 *    no title, never the deleted folder's name through cwd.
 *
 * The winner is then read through {@link workspaceDisplayTitle}, so an
 * automatic first-use title renders in the reader's language.
 * @param input - the chain's session facts.
 * @returns the display label, or undefined for the placeholder/trigger face.
 */
export function workspaceLabelState(input: WorkspaceLabelInput): WorkspaceLabelState {
  const stored = input.pendingWorkspace?.title
    ?? (input.sessionId === undefined
      ? undefined
      : input.sessionWorkspace?.title
        ?? (input.phase === 'ready' || input.cwd === undefined || input.cwd === ''
          ? undefined
          : workspaceLabel(input.cwd)))
  return stored === undefined
    ? undefined
    : workspaceDisplayTitle(stored, input.localizedDefaultTitle)
}

/** One picker row, the shape the primitives `Menu` consumes. */
export interface WorkspaceMenuItem {
  readonly id: string
  readonly label: string
}

/**
 * The picker rows: every listed Workspace in list order, each labelled
 * through {@link workspaceDisplayTitle}. These are the menu's ITEMS only —
 * since the alpha.13 retest the "add workspace" action rides the Menu's
 * `footer` prop pinned below the list (the native picker's own shape,
 * `WorkspacePicker.tsx:111-119`), fed by the add-flow verb plane
 * (workspace-add.ts); the items stay workspace rows, so an add row can never
 * be mistaken for a pick target here.
 * @param items - the Workspace list from the standard hook.
 * @param localizedDefaultTitle - `t('workspace.defaultName')`.
 */
export function workspaceMenuItems(
  items: readonly WorkspaceRowView[],
  localizedDefaultTitle: string,
): WorkspaceMenuItem[] {
  return items.map(item => ({
    id: item.workspaceId,
    label: workspaceDisplayTitle(item.title, localizedDefaultTitle),
  }))
}

/** Everything the row needs to decide its own visibility. */
export interface WorkspaceRowSupport {
  /** Session identity from chain props. */
  readonly sessionId: string | undefined
  /** `session.blank` — the native hero condition. Older sessions show no row at all. */
  readonly blank: boolean
  /** Whether the global `useWorkspaces` standard hook reached this chain entry. */
  readonly hookPresent: boolean
  /** Whether `ctx.get('uiWorkspace')` exposed the reuse-or-create verb. */
  readonly verbPresent: boolean
}

/**
 * Whether the card-top row renders: a blank session AND the two data surfaces
 * the row is useless without — the list hook (the label chain and the menu
 * rows) and the reuse-or-create verb (the pick). A missing surface hides the
 * row whole, per the face rule: no control is ever offered dead. The row is
 * also the only surface that can switch the card into the trigger posture, so
 * hiding it leaves the card exactly as it is today.
 * @param support - the three presence facts.
 */
export function workspaceRowSupported(support: WorkspaceRowSupport): boolean {
  return support.sessionId !== undefined
    && support.blank
    && support.hookPresent
    && support.verbPresent
}

/**
 * The native trigger posture verdict (`ConversationContent.tsx:141`): a blank
 * hero session whose chip resolved no title turns the WHOLE card into the
 * workspace picker — dashed inset outline, non-editable surface, the card
 * itself the click target, `placeholder.workspace`, aria
 * `hero.chooseWorkspace`. This card has no "no session at all" arm (the
 * takeover never elects then), so the blank-and-titleless test is the whole
 * formula.
 * @param input - the resolved label state and the session's blank flag.
 */
export function workspaceTriggerPosture(input: {
  readonly blank: boolean
  readonly label: WorkspaceLabelState
}): boolean {
  return input.blank && input.label === undefined
}

// ---------------------------------------------------------------------------
// The add-workspace flow (issue #42 alpha.13 retest): the menu footer row and
// its two edge decisions, mirroring the native `WorkspacePickFlow` — the row
// id (`WorkspacePicker.tsx:24`), the pinned footer entry (`:106-108`), and
// the "add is the only entry" verdict that consumes the anchor's open request
// and pulls the directory flow directly (`:157-162`).
// ---------------------------------------------------------------------------

/** The menu id of the add row — the native `ADD_WORKSPACE` sentinel, verbatim. */
export const ADD_WORKSPACE_ID = '::add-workspace'

/** The host `workspace` namespace keys the add row and its error surface read. */
export type WorkspaceAddKey =
  | 'menu.addWorkspace'
  | 'folderError.title'
  | 'folderError.retry'

/** The add flow's copy record: host words when bound, plugin words otherwise. */
export type WorkspaceAddCopy = Record<WorkspaceAddKey, string>

/**
 * The host seat the add flow's copy fold reads. `ctx.locale.bind('workspace')`
 * resolves through the untyped overload (the namespace lives in ui-workspace,
 * outside this build's merge table), so the seat is narrowed structurally to
 * exactly the keys this flow reads.
 */
export type WorkspaceAddHostTranslate = (key: WorkspaceAddKey, params?: Record<string, unknown>) => string

/**
 * Resolve the add flow's copy: the HOST `workspace` namespace's own words
 * through the bound seat, the plugin's verbatim fallback lines under a miss
 * (a bound translate answers a miss with the echoed key) or an unbound
 * namespace. The `resolveStatsCopy` fold, one namespace over.
 * @param hostT - the bound `workspace` translate, or undefined before apply binds it.
 * @param own - the plugin's fallback copy (the host's zh/en strings verbatim).
 */
export function resolveAddWorkspaceCopy(
  hostT: WorkspaceAddHostTranslate | undefined,
  own: WorkspaceAddCopy,
): WorkspaceAddCopy {
  if (hostT === undefined) return own
  const read = (key: WorkspaceAddKey): string => {
    const value = hostT(key)
    return value === key ? own[key] : value
  }
  return {
    'menu.addWorkspace': read('menu.addWorkspace'),
    'folderError.title': read('folderError.title'),
    'folderError.retry': read('folderError.retry'),
  }
}

/**
 * One add-flow footer entry, the shape the primitives `Menu` consumes
 * (minus the leading icon, which only the face can build — the core stays
 * React-free). Mirrors the native entry: `label: t('menu.addWorkspace')`,
 * `disabled: flowBusy` (`WorkspacePicker.tsx:106-108`).
 * @param label - the resolved `menu.addWorkspace` copy.
 * @param busy - whether the flow is in flight (picker or adoption pending).
 */
export function addWorkspaceEntry(label: string, busy: boolean): {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
} {
  return { id: ADD_WORKSPACE_ID, label, disabled: busy }
}

/**
 * The native "add is the only entry" verdict (`WorkspacePicker.tsx:157-162`):
 * nothing is listed, the list has settled (`ready` — a pending list may still
 * be hiding rows), and the flow is reachable — so a menu would offer nothing
 * to choose between and the anchor gesture IS the action. The native gates it
 * `!pinAdd && listSettled && addEntries.length === 1` with `pinAdd` false
 * exactly when the list is empty; this card never mounts the add-only
 * surface, so the three facts collapse to these.
 * @param input - flow reachability, list lifecycle, and the row count.
 */
export function addWorkspaceIsOnlyEntry(input: {
  readonly addPresent: boolean
  readonly phase: 'pending' | 'ready'
  readonly itemCount: number
}): boolean {
  return input.addPresent && input.phase === 'ready' && input.itemCount === 0
}
