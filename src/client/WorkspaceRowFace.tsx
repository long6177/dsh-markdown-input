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
 * `useWorkspaces` snapshot. The five-level label chain, the picker rows, and
 * the trigger-posture verdict are pure functions in workspace-row-core.ts;
 * this file only glues them to React and the two menu verbs.
 *
 * The row owns its open state, exactly like the native pair does, but the
 * OPEN state outlives it: the card's trigger posture lifts this chip's menu
 * open (owner-controlled `open` prop) so a whole-card click opens THIS menu in
 * place instead of a second, differently-anchored pick surface.
 */
import { useCallback, useRef, type ReactNode } from 'react'
import {
  IconChevronDownOutlineRegular, IconFolderCloseRegular, IconFolderOpenRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './MarkdownComposer.module.css'
import type { WorkspaceLabelState, WorkspaceMenuItem } from './workspace-row-core.ts'

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
      <Menu
        open={props.open}
        anchor={null}
        items={[...props.menuItems]}
        selectedId={props.selectedWorkspaceId}
        onSelect={(id) => {
          props.onCloseMenu()
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
