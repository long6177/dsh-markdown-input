/**
 * The tool-row command menu face (ADR-0005 revival, toolbar row ①): the `+`
 * trigger and its self-drawn candidate menu, rebuilt after the host's
 * MenuView (not exported) but riding the host's data plane through
 * command-face.ts. One pipeline semantics with the native slash menu, at
 * its `query: ''` shape: the menu opens focused on the editor (combobox —
 * focus moves into the editor BEFORE the menu renders, the keyboard rides
 * the editor's menu-key seam), spans the card's width with its bottom edge
 * 4px above the card's top border, and lists the 添加 (file/goal/plan/
 * feedback) and 指令 (compact/permission/model/export) sections from the
 * session's command catalog — the static built-in rows standing in until
 * the catalog read lands, so the menu never opens empty.
 *
 * Picks dispatch like the host's table: claim rows insert the localized
 * token over the document head (Enter submits through the host's trigger
 * adjudication), bare commands run detached through `remote.commands.
 * execute`, the permission/model rows chain into the second-layer popup
 * faces, the file row rides the hidden file input, and the feedback row —
 * while the host `feedbackUi` service is alive — opens the session feedback
 * dialog with no insertion, the native decoration's own semantics. The face
 * mounts inside its FaceGate: a probe miss or a mid-life degrade hides it
 * alone (the gate's fallback carries the legacy attach button), never the
 * card.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconPlusOutlineMedium, MenuSurface, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from './conversation-face.ts'
import { useObservable, type ShellClaim } from './conversation-face.ts'
import { hasChainPopup, openChainPopup } from './chain-open.ts'
import { commandFace } from './command-face.ts'
import { assembleCommandRows, reportExecute } from './command-rows.ts'
import { feedbackUiSupported, openFeedbackSession } from './feedback-face.ts'
import type { SubagentShare } from './model-face.ts'
import { NS } from './locales.ts'
import type { MarkdownEditorHandle, MenuKeyHandler } from './markdown-editor.ts'
import css from './CommandMenuFace.module.css'

/** Design max-height of the menu (runtime viewport clamp re-fits it). */
const MAX_HEIGHT = 400
/** Viewport top margin the clamp keeps free (the conversation header chrome). */
const TOP_MARGIN = 84

/** Option DOM id, the host MenuView's format with the command source. */
function optionId(index: number): string {
  return `dsh-slash-option-command-${index}`
}

/** Props of the command-menu face as the composer chain delivers them. */
export interface CommandMenuFaceProps {
  /** Owning session; undefined leaves the face hidden (nothing to command). */
  readonly sessionId: SessionId | undefined
  readonly t: PropsLocale<typeof NS>['t']
  /**
   * The composer editor: focus target, leading probe, claim insertion, and
   * the keyboard seam. Delivered as state (not a ref) so the face's effects
   * re-bind when the editor arrives — child effects run before the card's
   * editor-mount effect, and the key seam must catch that moment.
   */
  readonly editor: MarkdownEditorHandle | null
  /** The card root: the menu portals here so it anchors above the card. */
  readonly container: RefObject<HTMLElement | null>
  /** File intake availability (attachment face + non-subagent + not busy). */
  readonly canPickFiles: boolean
  /** Opens the hidden file input — the file row's action. */
  readonly onPickFiles: () => void
  /** Card-banner outlet: a failed detached execution reports here. */
  readonly onError: (text: string) => void
  /** Registers the close verb the card calls when the document changes. */
  readonly registerClose: (close: (() => void) | null) => void
  /**
   * Runs when the menu opens (T10 popup interlock): the typed-trigger
   * completion popup closes, keeping one candidate surface above the card —
   * the native pipeline's single-MenuView semantics.
   */
  readonly onOpen?: () => void
  /**
   * The card's claim application (issue #79 AC5): called after a claim row's
   * token text lands, with the claim the shell's `beginCommand` applies —
   * catalog name, localized token, catalog hint, and a submit closure over
   * the detached execute verb — plus the pre-pick head end (detect
   * coordinates) the machine's chip replaces. Absent (or a no-op) on a host
   * without the runtime shell: the token text stands alone and the
   * typed-slash adjudication delivers it on Enter, the pre-#79 behavior.
   */
  readonly beginClaim?: (claim: ShellClaim, headEnd: number) => void
  /**
   * The session snapshot's subagent share (wire data; null = ordinary
   * session). A non-null address short-circuits the native catalog fetch to
   * an empty roster before any RPC (#76 AC4): the menu assembles no rows and
   * the launcher never opens it — a subagent session has no `+` candidates.
   */
  readonly subagent?: SubagentShare
}

/**
 * The `+` trigger and, while open, the candidate menu portaled to the card.
 * @param props - session, copy, editor/card refs, availability, and outlets.
 * @returns the trigger (with the portaled menu), or nothing while locked.
 */
export function CommandMenuFace({
  sessionId, t, editor, container, canPickFiles, onPickFiles, onError, registerClose, onOpen, beginClaim, subagent,
}: CommandMenuFaceProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [leading, setLeading] = useState(true)
  const [highlight, setHighlight] = useState(0)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const face = commandFace()
  const catalogs = useObservable(face?.catalogs)

  // The open/rows/highlight mirrors keep the editor-seam handler and the
  // pick closures reading fresh state without re-binding every render.
  // (`editor` itself needs no mirror: it is a stable ref object read at
  // event time.)
  const openRef = useRef(open)
  openRef.current = open

  // The subagent catalog short-circuit (#76 AC4) outranks the static
  // fallback: a subagent session's roster is empty (the client contributions
  // drop out through their own availability flags), the native menu's
  // all-ready-empty close.
  const descriptors = subagent != null
    ? []
    : sessionId === undefined || catalogs === undefined
      ? null
      : catalogs.value.get(sessionId) ?? null
  const rows = useMemo(
    // hasChainPopup is a live registry read, not reactive state: the `open`
    // dep re-runs the assembly on every open so the chainable rows resolve
    // fresh. feedbackUiSupported is the same kind of read (issue #35): the
    // feedback row upgrades to the native action the moment the decoration
    // owner has activated. The client contributions carry the native
    // availability rules (#76 AC4): a subagent session picks no files and
    // gets no model row — the catalog above is short-circuited to an empty
    // roster.
    () => assembleCommandRows({
      descriptors,
      canPickFiles: subagent == null && canPickFiles,
      canChainPermission: hasChainPopup('permission'),
      canChainModel: subagent == null && hasChainPopup('model'),
      canOpenFeedback: feedbackUiSupported(), leading, t,
    }),
    [descriptors, canPickFiles, subagent, leading, t, open],
  )
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight

  const close = useCallback((): void => { setOpen(false) }, [])

  // The claim's submit closure (issue #79 AC5): the machine's claimed branch
  // calls it with the args typed after the token. The line rides the same
  // detached execute verb the bare rows use (the upstream leadingClaim
  // shape — the line always carries the catalog name); the outcome maps onto
  // the machine's SubmitOutcome instead of the banner.
  const executeClaimLine = useCallback(async (line: string): Promise<{
    kind: 'success' | 'error'
    text?: string
  }> => {
    if (face === undefined || sessionId === undefined) {
      return { kind: 'error', text: t('command.executeFailed', { message: 'command face absent' }) }
    }
    const result = await face.execute(sessionId, line)
    if (result.kind === 'success') return { kind: 'success' }
    if (result.kind === 'error') return { kind: 'error', text: result.text }
    if (result.kind === 'unmatched') return { kind: 'error', text: t('command.executeUnmatched') }
    return { kind: 'error', text: t('command.executeFailed', { message: result.message }) }
  }, [face, sessionId, t])

  // The card closes the menu whenever the document changes (the host
  // pipeline's track-loss: a typed character invalidates the trigger span).
  useEffect(() => {
    registerClose(close)
    return () => { registerClose(null) }
  }, [close, registerClose])

  // Mount-time warm-up: the catalog read starts before the first open. A
  // subagent session short-circuits before any RPC (#76 AC4).
  useEffect(() => {
    if (face !== undefined && sessionId !== undefined && subagent == null) face.ensure(sessionId)
  }, [face, sessionId, subagent])

  const openMenu = useCallback((): void => {
    // The native empty-candidate close (#76 AC4): a subagent session's roster
    // is short-circuited to nothing, so the launcher never floats an empty
    // menu (the key seam declines rowless surfaces the same way).
    if (rowsRef.current.length === 0) return
    // Combobox contract: the editor owns focus before the menu renders; the
    // trigger position (leading vs inline) freezes at open like the host's.
    editor?.focus()
    const leadingNow = editor?.isLeadingSelection() ?? true
    setLeading(leadingNow)
    setHighlight(0)
    setOpen(true)
    onOpen?.()
    if (face !== undefined && sessionId !== undefined) face.ensure(sessionId)
  }, [face, sessionId, editor, onOpen])

  const pickRow = useCallback((index: number): void => {
    const row = rowsRef.current[index]
    if (row === undefined) return
    setOpen(false)
    const editorHandle = editor
    switch (row.kind) {
      case 'action':
        onPickFiles()
        return
      case 'claim': {
        // The leading guard re-checks at apply time (host beginCommand): a
        // caret moved into text since open never claims.
        if (editorHandle !== null && editorHandle.isLeadingSelection()) {
          // The pre-pick head end is the span the machine's chip replaces —
          // captured before the token insertion moves the caret.
          const headEnd = editorHandle.selectionEnd()
          editorHandle.claimSelection(row.token ?? '')
          // The card applies the claim through the shell (issue #79 AC5):
          // the machine enters claimed and the ghost hint lives.
          beginClaim?.({
            name: row.name,
            token: row.token ?? '',
            ...(row.hint === undefined ? {} : { hint: row.hint }),
            submit: (args) => executeClaimLine(`/${row.name} ${args}`.trimEnd()),
          }, headEnd)
        }
        return
      }
      case 'execute':
        if (face !== undefined && sessionId !== undefined) {
          void face.execute(sessionId, row.line ?? '').then((result) => {
            reportExecute(result, onError, t)
          })
        }
        return
      case 'popup':
        if (row.popup !== undefined) openChainPopup(row.popup)
        return
      case 'feedback':
        // The host `feedbackUi` decoration's own run verb (ui-message-feedback
        // index.ts:139): open the session dialog, insert nothing. A typed
        // `/反馈 …` line never reaches this row — the host keeps the argued
        // line on the claim pipeline.
        openFeedbackSession(sessionId)
        return
    }
  }, [face, onError, onPickFiles, sessionId, t, editor, beginClaim, executeClaimLine])

  // The menu's combobox keyboard rides the editor's key seam: bound once,
  // reading fresh state through the refs. Closed (or rowless), every key is
  // declined and the editor's own commands carry on.
  const menuKeyHandler = useRef<MenuKeyHandler | null>(null)
  if (menuKeyHandler.current === null) {
    menuKeyHandler.current = (intent) => {
      if (!openRef.current || rowsRef.current.length === 0) return false
      const last = rowsRef.current.length - 1
      switch (intent) {
        case 'up':
          setHighlight((current) => (current <= 0 ? last : current - 1))
          return true
        case 'down':
          setHighlight((current) => (current >= last ? 0 : current + 1))
          return true
        case 'pick':
        case 'tab':
          // Tab drills in the completion popups (T10); the `+` menu has no
          // drill dimension, so it answers the verb as an ordinary pick.
          pickRow(highlightRef.current)
          return true
        case 'close':
          close()
          return true
      }
    }
  }
  useEffect(() => {
    editor?.setMenuKeyHandler(menuKeyHandler.current)
    return () => { editor?.setMenuKeyHandler(null) }
  }, [editor])
  // Outside-pointerdown dismissal, the host MenuView's rule: a press on
  // neither the menu nor the composer card closes the menu; the card's own
  // surfaces (text face, tool row) never do.
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) === true) return
      if (container.current?.contains(event.target) === true) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [open, close, container])

  // The keyboard highlight scrolls, not the editor (combobox): the browser
  // never moves a listbox row whose focus lives elsewhere.
  useEffect(() => {
    if (!open) return
    document.getElementById(optionId(highlight))?.scrollIntoView?.({ block: 'nearest' })
  }, [open, highlight])

  // Rows re-assembled on open may shrink (a popup face died mid-life):
  // keep the highlight inside the list.
  useEffect(() => {
    if (highlight > rows.length - 1) setHighlight(Math.max(0, rows.length - 1))
  }, [rows.length, highlight])

  const maxHeight = useAnchoredMaxHeight(menuRef, MAX_HEIGHT, open ? rows : null, TOP_MARGIN)

  if (sessionId === undefined) return null

  let lastSection: string | undefined
  return (
    <>
      <button
        type="button"
        className={css.trigger}
        data-command-menu-trigger
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('command.menu.open')}
        title={t('command.menu.open')}
        onClick={() => { open ? close() : openMenu() }}
      >
        <IconPlusOutlineMedium size={14} />
      </button>
      {open && container.current !== null && createPortal(
        <MenuSurface
          ref={menuRef}
          className={css.menu}
          style={{ maxHeight } satisfies CSSProperties}
          data-command-menu=""
        >
          <div
            className={css.viewport}
            role="listbox"
            aria-label={t('command.menu.listbox')}
            aria-activedescendant={rows.length > 0 ? optionId(highlight) : undefined}
          >
            {rows.map((row, index) => {
              const active = index === highlight
              const titleRow = row.section !== lastSection
                ? <div key={`section:${row.section}`} className={css.sectionTitle} role="presentation" data-command-section>{row.section}</div>
                : null
              lastSection = row.section
              const alias = row.label.toLowerCase() !== row.name.toLowerCase()
              return (
                // The fragment keys keep the section title and its row one
                // list entry while the row id stays the a11y contract.
                <Fragment key={optionId(index)}>
                  {titleRow}
                  <button
                    id={optionId(index)}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={active ? `${css.item} ${css.itemActive}` : css.item}
                    data-command-name={row.name}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      pickRow(index)
                    }}
                    onMouseMove={active ? undefined : () => { setHighlight(index) }}
                  >
                    {row.icon !== undefined && (
                      <span className={css.itemIcon} aria-hidden><row.icon size={14} /></span>
                    )}
                    <span className={css.itemName}>{row.label}</span>
                    {alias && <span className={css.itemAlias} data-command-alias>{row.name}</span>}
                    {row.description !== undefined && (
                      <span className={css.itemDescription}>{row.description}</span>
                    )}
                  </button>
                </Fragment>
              )
            })}
          </div>
        </MenuSurface>,
        container.current,
      )}
    </>
  )
}
