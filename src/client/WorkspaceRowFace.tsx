/**
 * The card-top workspace row (issue #42, ADR-0006 option B): the native
 * `heroWorkspaceRow`'s first seat — `WorkspaceChip` + its pick menu — rebuilt
 * inside the takeover card. The row exists because the card elects on a
 * blank Session, and the chain's `overlay: true` election hides the whole
 * fallback bar the native hero row lives in (`ConversationContent.tsx:141`,
 * `:175`): without this row a new conversation has no workspace entry point
 * at all.
 *
 * Native parity is by construction, not by vendor: `dsh-client-ui-workspace`
 * is not in this build's dependency graph, so the chip is a local rebuild of
 * `EmptyHero.tsx:38-62` (closed/open folder glyph 16 + label +
 * `IconChevronDownOutlineRegular` 12, `aria-haspopup="menu"`,
 * `aria-expanded`), and the menu is the same `Menu` primitive the native
 * picker uses (`WorkspacePicker.tsx:190-201`) fed by the same standard
 * `useWorkspaces` snapshot — including the pinned "add workspace" footer row
 * (issue #42, alpha.13 retest): the native picker pins it below the scroll
 * region with the Menu's `footer` prop (`WorkspacePicker.tsx:111-119`,
 * `:194`) whenever the add flow is reachable, and this face mirrors that
 * exactly — same primitive, same footer prop, same plus glyph, so the row
 * geometry (`.footer` hairline, `.item` cell, the 16px glyph the icon cell
 * squeezes to 14px) is the primitive's own, not a re-style. The five-level
 * label chain, the picker rows, and the trigger-posture verdict are pure
 * functions in workspace-row-core.ts; this file only glues them to React and
 * the menu verbs.
 *
 * The row owns its open state, exactly like the native pair does, but the
 * OPEN state outlives it: the card's trigger posture lifts this chip's menu
 * open (owner-controlled `open` prop) so a whole-card click opens THIS menu in
 * place instead of a second, differently-anchored pick surface.
 */
import { useCallback, useRef, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, IconPlusOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './MarkdownComposer.module.css'
import { ADD_WORKSPACE_ID, type WorkspaceLabelState, type WorkspaceMenuItem } from './workspace-row-core.ts'

/**
 * The copy the row reads from the host `conversation` namespace. Passed in as
 * a seat rather than imported so the component stays a pure function of props
 * (the card resolves the binding once, per render) and tests can drive it
 * with the host's own dictionary.
 */
export interface WorkspaceRowCopy {
  /** `hero.chooseWorkspace` — the chip's accessible name and the no-label face. */
  readonly choose: string
}

/**
 * The menu's pinned "add workspace" footer row (issue #42, alpha.13 retest).
 * Its PRESENCE is the add-flow capability verdict: the card passes undefined
 * when `uiWorkspace.pickDirectory` + `workspaces.create` are not both
 * reachable, and the row disappears whole (the face rule — no dead add row)
 * while the workspace rows above stay.
 */
export interface WorkspaceAddRow {
  /** `menu.addWorkspace` — the resolved host (or fallback) copy. */
  readonly label: string
  /** The flow is in flight (native `flowBusy`): the row cannot take another gesture. */
  readonly disabled: boolean
}

/** Props of the card-top workspace row. */
export interface WorkspaceRowFaceProps {
  /** Resolved label; undefined is the placeholder + trigger-posture face. */
  readonly label: WorkspaceLabelState
  /** Currently owning Workspace id (trailing check in the menu); undefined without one. */
  readonly selectedWorkspaceId: string | undefined
  /** Picker rows, already resolved through `workspaceDisplayTitle`. */
  readonly menuItems: readonly WorkspaceMenuItem[]
  /**
   * Menu expansion, owner-controlled by the card. It is lifted on purpose:
   * the card's OWN trigger posture is the whole-card pick target and its click
   * must open this very menu (one pick surface, one anchor), so the open state
   * cannot live down here where the card cannot reach it.
   */
  readonly open: boolean
  /** Toggle the menu (the chip's own click). */
  readonly onToggleMenu: () => void
  /** Close the menu (outside click, Escape, post-pick). */
  readonly onCloseMenu: () => void
  /** The pick: reuse-or-create the blank Session in that Workspace and switch. */
  readonly onPick: (workspaceId: string) => void
  /**
   * The add flow: adopt a NEW directory as a Workspace and pick it. Present
   * exactly when `addRow` is; the footer row click closes the menu first
   * (the native `openDirectoryFlow`, `WorkspacePicker.tsx:141-146`) and then
   * hands the gesture to the card, which owns the picker/create sequence.
   */
  readonly onAdd: () => void
  /** The pinned footer row, or undefined when the add flow is unreachable. */
  readonly addRow?: WorkspaceAddRow | undefined
  /** Whether the card is in the native trigger posture right now. */
  readonly triggerPosture: boolean
  /** The host `conversation` namespace copy. */
  readonly copy: WorkspaceRowCopy
  /** Test seam: the row root's data attribute. */
  readonly testId?: string | undefined
}

/**
 * Render the workspace row: one chip plus the pick menu anchored to it.
 * @param props - resolved label, picker rows, verbs and copy.
 * @returns the chip and its menu.
 */
export function WorkspaceRowFace(props: WorkspaceRowFaceProps): ReactNode {
  const chipRef = useRef<HTMLButtonElement | null>(null)

  // The menu's placement anchor. `getAnchorRect` (not the Menu's own wrapper
  // measurement) because the chip is a sibling of the Menu in a flex row and
  // the wrapper span it would measure carries no geometry of its own — the
  // same reason the native picker hands the host its chip ref.
  const getAnchorRect = useCallback(
    () => chipRef.current?.getBoundingClientRect() ?? null,
    [],
  )

  return (
    <div className={css.workspaceRow} data-markdown-workspace-row={props.testId ?? ''}>
      {/* The add row rides the Menu's `footer` prop — pinned below the items
          area with the primitive's own hairline, exactly the native picker's
          `footer={addEntries}` (`WorkspacePicker.tsx:194`); the plus glyph is
          the native entry's `size={16}`, which the icon cell squeezes to
          14px (`Menu.module.css:168-182`). Undefined hides the row whole.
          While the flow is in flight (`addRow.disabled`, the native
          `flowBusy`) EVERY row goes dead — the native picker gates its
          workspace rows off the same flag ("one picking interaction at a
          time", `WorkspacePicker.tsx:85-90`), so a late outcome cannot race
          a concurrent selection. */}
      <Menu
        open={props.open}
        anchor={null}
        items={props.addRow?.disabled === true
          ? props.menuItems.map(item => ({ ...item, disabled: true }))
          : [...props.menuItems]}
        footer={props.addRow === undefined ? undefined : [{
          id: ADD_WORKSPACE_ID,
          label: props.addRow.label,
          icon: <IconPlusOutlineRegular size={16} />,
          disabled: props.addRow.disabled,
        }]}
        selectedId={props.selectedWorkspaceId}
        onSelect={(id) => {
          props.onCloseMenu()
          // The native `handleSelect` routes the add sentinel to the flow
          // instead of a pick (`WorkspacePicker.tsx:221-227`).
          if (id === ADD_WORKSPACE_ID) {
            props.onAdd()
            return
          }
          props.onPick(id)
        }}
        onClose={props.onCloseMenu}
        side="bottom"
        portal
        getAnchorRect={getAnchorRect}
      />
      {/* Native chip semantics (`EmptyHero.tsx:46-60`): always interactive
          while a workspace is resolvable; in the TRIGGER posture it is
          disabled, because the whole card is the pick target then and a
          second live control inside it would split the click. A disabled
          control takes no pointer events (see the card CSS), so the card's
          own handler owns the gesture, exactly like the native
          `cardWorkspaceTrigger :disabled { pointer-events: none }`. */}
      <button
        ref={chipRef}
        type="button"
        className={css.workspaceChip}
        aria-label={props.copy.choose}
        aria-haspopup="menu"
        aria-expanded={props.open}
        disabled={props.triggerPosture}
        onClick={props.onToggleMenu}
      >
        {props.label === undefined
          ? <IconFolderCloseRegular className={css.workspaceFolder} size={16} />
          : <IconFolderOpenRegular className={css.workspaceFolder} size={16} />}
        <span className={css.workspaceChipLabel}>{props.label ?? props.copy.choose}</span>
        <IconChevronDownOutlineRegular className={css.workspaceChevron} size={12} />
      </button>
    </div>
  )
}
