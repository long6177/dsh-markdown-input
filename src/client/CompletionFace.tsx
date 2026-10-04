/**
 * The typed-trigger completion popup face (T10): the `/` and `@` popups over
 * the CM6 surface, rebuilt after the host's MenuView like the `+` menu
 * (T5) and driven by the same one-pipeline semantics — a live trigger token
 * under the caret is the whole open/close contract.
 *
 * The editor (markdown-editor.ts) re-detects the token per update and
 * delivers identity-deduped probes through the probe seam; this face owns
 * everything else: the input-phase guard filter (claimed suppresses `/`,
 * frozen suppresses both — a probe miss or a dead data plane hides the
 * popup, plain text input is unaffected), the candidate groups
 * (completion-core.ts over the command catalog, the skill roll, and the
 * `remote.fileReferences` searches with stale-while-revalidate), the
 * combobox keyboard through the completion key seam, and the picks:
 * command rows dispatch exactly like the `+` menu's table (claim token /
 * detached execute / chained popup / file intake), the feedback row — while
 * the host `feedbackUi` service is alive — opens the session feedback dialog
 * and inserts nothing (the native decoration, issue #35), a skill inserts its
 * `/name ` token, and a file inserts its `formatFileMention` wire form —
 * `@path` or `@"path with spaces"`, a directory with its trailing slash —
 * with Tab drilling into directories. Every insertion is an ordinary
 * transaction, so the T9 chip decorations take over the visuals the moment
 * the text lands (insert → dictionary hit → decoration).
 *
 * Dismissal memory (host rememberDismissed): Escape — and the settling
 * picks themselves — record the probe identity the popup closed for, and a
 * bare re-track of that same token stays closed until the text changes. A
 * drill deliberately skips the memory: its open token re-tracks into the
 * descended listing.
 *
 * A chained popup row hands the second-layer face the settle hook of the
 * token that opened it (issue #36): a successful selection there consumes
 * `/mo` and returns focus to the editor (host PopupSelectController.settle
 * semantics). Dismissals and failures leave the token in the draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { MenuSurface, ReferenceIconRegular, useAnchoredMaxHeight } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { useObservable, type SessionId } from './conversation-face.ts'
import { hasChainPopup, openChainPopup, type ChainPopupSettle } from './chain-open.ts'
import { commandFace, commandFaceSupported } from './command-face.ts'
import { assembleCommandRows, reportExecute } from './command-rows.ts'
import { feedbackUiSupported, openFeedbackSession } from './feedback-face.ts'
import {
  assembleCompletionView, guardAllowsProbe, sameProbeIdentity, skillInsertion,
  type CompletionEntry, type CompletionGuard, type CompletionProbe,
  type CompletionView, type FileReferenceCandidate,
} from './completion-core.ts'
import { fileReferenceFace, fileReferenceFaceSupported } from './file-reference-face.ts'
import { skillFace, type SkillEntry } from './skill-face.ts'
import { NS } from './locales.ts'
import type { MarkdownEditorHandle, MenuKeyHandler } from './markdown-editor.ts'
import type { FaceDefinition } from './face.ts'
import css from './CompletionFace.module.css'

/** Design max-height of the popup (runtime viewport clamp re-fits it). */
const MAX_HEIGHT = 400
/** Viewport top margin the clamp keeps free (the conversation header chrome). */
const TOP_MARGIN = 84

/** Face id of the typed-trigger completion popups in the face framework. */
export const COMPLETION_FACE_ID = 'tool.completion'

/**
 * The FaceGate definition: the popup face needs at least one data plane —
 * the command catalog for `/` or `remote.fileReferences` for `@`. A probe
 * miss (or a mid-life degrade) hides the popups wholesale; per-trigger
 * availability is checked at render (one plane can die alone).
 */
export function completionFaceDefinition(): FaceDefinition {
  return {
    id: COMPLETION_FACE_ID,
    probe: () => commandFaceSupported() || fileReferenceFaceSupported(),
  }
}

/** Props of the completion popup face as the composer chain delivers them. */
export interface CompletionFaceProps {
  /** Owning session; undefined leaves the face hidden (nothing to search). */
  readonly sessionId: SessionId | undefined
  readonly t: PropsLocale<typeof NS>['t']
  /**
   * The composer editor: probe source (its seam delivers the live token),
   * key seam, and insertion target. Delivered as state (not a ref) so the
   * seams re-bind when the editor arrives.
   */
  readonly editor: MarkdownEditorHandle | null
  /** The card root: the popup portals here so it anchors above the card. */
  readonly container: RefObject<HTMLElement | null>
  /** Input-phase guard tier derived from the machine's phase. */
  readonly guard: CompletionGuard
  /** File intake availability (attachment face + non-subagent + not busy). */
  readonly canPickFiles: boolean
  /** Opens the hidden file input — the file row's action. */
  readonly onPickFiles: () => void
  /** Card-banner outlet: a failed detached execution reports here. */
  readonly onError: (text: string) => void
  /** Registers the close verb the card calls when the `+` menu opens. */
  readonly registerClose: (close: (() => void) | null) => void
  /** Runs when a probe opens the popup; closes the `+` menu (interlock). */
  readonly onOpen: () => void
}

/** One display row with its a11y id and flat position (the highlight space). */
interface CompletionRowItem {
  readonly kind: 'row'
  readonly flat: number
  readonly id: string
  readonly entry: CompletionEntry
}

/** Non-row render items: the group/section titles and the pending skeleton. */
type CompletionRenderItem =
  | CompletionRowItem
  | { readonly kind: 'groupTitle'; readonly key: string; readonly label: string }
  | { readonly kind: 'sectionTitle'; readonly key: string; readonly label: string }
  | { readonly kind: 'skeleton'; readonly key: string }

/**
 * The `@` fetch state: the landed results carry their query so a probe that
 * moved on renders them as stale (SWR) instead of current, and carry their
 * session so a session switch never flashes the old workspace's files.
 */
interface LandedFiles {
  readonly sessionId: SessionId
  readonly query: string
  readonly results: readonly FileReferenceCandidate[]
}

/**
 * Build the settle hook of one chain open (issue #36) for a popup row picked
 * while `probe` was live: the trigger token segment is snapshotted here and
 * consumed later, only if a second-layer selection succeeds. The host
 * `PopupSelectController.settle` tail is the model — consume the open-time
 * token segment, then return focus to the composer.
 *
 * The consume is a text-level CAS, the CM6 analogue of the host's draftRev
 * guard: the span is deleted only while the document still carries exactly
 * the snapshotted token there (and the span is non-empty). A false answer is
 * benign and never retried — the draft simply keeps whatever it now holds —
 * but focus still returns to the editor: a native settle always focuses the
 * composer, whatever the CAS decided.
 * @param handle - the composer editor the token lives in.
 * @param probe - the live trigger token at pick time.
 * @returns the settle hook handed to the chained popup face.
 */
function chainSettle(handle: MarkdownEditorHandle, probe: CompletionProbe): ChainPopupSettle {
  const token = handle.view.state.doc.sliceString(probe.start, probe.end)
  const { start, end } = probe
  return () => {
    const doc = handle.view.state.doc
    if (start < end && end <= doc.length && doc.sliceString(start, end) === token) {
      // An ordinary transaction: the probe seam and the chip decorations
      // observe a normal document change, and the deletion is one undo step.
      handle.view.dispatch({
        changes: { from: start, to: end },
        selection: { anchor: start },
      })
    }
    handle.focus()
  }
}

/**
 * The `/` and `@` candidate popup, portaled to the card while a live
 * trigger token is tracked. Renders nothing (and the key seam declines)
 * while closed — plain text input is unaffected.
 * @param props - session, copy, editor/card refs, guard, and outlets.
 * @returns the portaled popup, or nothing while closed.
 */
export function CompletionFace({
  sessionId, t, editor, container, guard, canPickFiles, onPickFiles, onError, registerClose, onOpen,
}: CompletionFaceProps): ReactNode {
  const command = commandFace()
  const catalogs = useObservable(command?.catalogs)
  const skills = skillFace()
  const skillEntries = useObservable(skills?.lexicons)
  const fileFace = fileReferenceFace()

  const [probe, setProbe] = useState<CompletionProbe | null>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [landed, setLanded] = useState<LandedFiles | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Mirrors keep the editor-seam handler and pick closures reading fresh
  // state without re-binding every render.
  const probeRef = useRef<CompletionProbe | null>(null)
  probeRef.current = probe
  const openRef = useRef(open)
  openRef.current = open
  const highlightRef = useRef(highlight)
  highlightRef.current = highlight
  // The identity the popup was dismissed for (host rememberDismissed): a
  // bare re-track of the same token stays closed until the text changes.
  const dismissedRef = useRef<CompletionProbe | null>(null)
  // Armed by a settling insertion: the NEXT probe — the post-insert token,
  // or none when the insertion ends the token — becomes the dismissed
  // memory instead of reopening the popup.
  const rememberNextRef = useRef(false)
  const inFlightRef = useRef<AbortController | null>(null)
  // Prop mirrors for the seam closures bound once.
  const editorRef = useRef(editor)
  editorRef.current = editor
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError
  const tRef = useRef(t)
  tRef.current = t

  const skillRoll: readonly SkillEntry[] | null = skills === undefined
    ? [] // no lexicon plane: no skill group at all (native roster parity)
    : sessionId === undefined || skillEntries === undefined
      ? null // the lexicon read is pending
      : skillEntries.value.get(sessionId) ?? null

  const descriptors = sessionId === undefined || catalogs === undefined
    ? null
    : catalogs.value.get(sessionId) ?? null
  const commandRows = useMemo(
    () => command === undefined || probe === null || probe.trigger !== '/'
      ? null
      : assembleCommandRows({
        descriptors,
        canPickFiles,
        // Live registry reads, like the `+` menu: the chainable rows resolve
        // fresh per assembly, and feedbackUiSupported upgrades the feedback
        // row to the native dialog action whenever the decoration owner is
        // active (issue #35).
        canChainPermission: hasChainPopup('permission'),
        canChainModel: hasChainPopup('model'),
        canOpenFeedback: feedbackUiSupported(),
        leading: probe.position === 'leading',
        t,
      }),
    [command, probe, descriptors, canPickFiles, t],
  )

  const landedValid = landed !== null && landed.sessionId === sessionId
  const landedForProbe = landedValid && landed !== null && landed.query === probe?.query
  const view: CompletionView | null = useMemo(() => {
    if (probe === null) return null
    if (probe.trigger === '/' ? command === undefined : fileFace === undefined) return null
    // Landed results answer the current query only; an older query's landed
    // data shows as stale while the fresh fetch runs (SWR).
    const files = fetching || !landedForProbe || landed === null ? null : landed.results
    const staleFiles = fetching && landedValid && landed !== null ? landed.results : null
    return assembleCompletionView({ probe, commandRows, skills: skillRoll, files, staleFiles, t })
  }, [probe, command, fileFace, fetching, landedForProbe, landedValid, landed, commandRows, skillRoll, t])

  const pending = view?.pending ?? false
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  // The rendered item list and the flat row space the keyboard highlight
  // cycles (one listbox over the groups in display order, native flatten).
  const { items, rows } = useMemo<{ items: CompletionRenderItem[]; rows: CompletionRowItem[] }>(() => {
    const items: CompletionRenderItem[] = []
    const rows: CompletionRowItem[] = []
    for (const group of view?.groups ?? []) {
      if (group.status === 'ready' && group.entries.length === 0) continue
      const showTitle = group.title !== undefined
        && !group.entries.some((entry) => entry.section !== undefined)
      if (showTitle && group.title !== undefined) {
        items.push({ kind: 'groupTitle', key: `group:${group.id}`, label: group.title })
      }
      if (group.status === 'pending' && group.entries.length === 0) {
        items.push({ kind: 'skeleton', key: `skeleton:${group.id}` })
        continue
      }
      let lastSection: string | undefined
      for (const [index, entry] of group.entries.entries()) {
        if (entry.section !== undefined && entry.section !== lastSection) {
          items.push({ kind: 'sectionTitle', key: `section:${group.id}:${index}`, label: entry.section })
        }
        lastSection = entry.section
        const row: CompletionRowItem = {
          kind: 'row',
          flat: rows.length,
          id: `dsh-mdx-option-${group.id}-${index}`,
          entry,
        }
        rows.push(row)
        items.push(row)
      }
    }
    return { items, rows }
  }, [view])
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const visible = open && probe !== null && view !== null && guardAllowsProbe(guard, probe)
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  // All-ready-and-empty auto-close (host parity): a query with no candidates
  // anywhere closes the popup — an empty shell is not a candidate surface.
  // No dismissed memory: this close is the data's answer, not the user's.
  const allReadyEmpty = visible && view !== null && !view.pending && rows.length === 0
  useEffect(() => {
    if (allReadyEmpty) setOpen(false)
  }, [allReadyEmpty])

  /**
   * Replace the live token span with one insertion (the only text a pick
   * ever lands). Settling inserts close the popup and arm the dismissed
   * memory: the next probe — the settled token, or none when the insertion
   * ends the token — becomes the memory, so the popup stays closed for the
   * user's decision until the text changes (host settle semantics). A drill
   * inserts without settling: the open mention keeps the token live and the
   * descended listing opens on its own probe.
   */
  const insertOverToken = useCallback((text: string): void => {
    const handle = editorRef.current
    const current = probeRef.current
    if (handle === null || current === null) return
    handle.view.dispatch({
      changes: { from: current.start, to: current.end, insert: text },
      selection: { anchor: current.start + text.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
    })
  }, [])

  const insertSettling = useCallback((text: string): void => {
    rememberNextRef.current = true
    setOpen(false)
    insertOverToken(text)
  }, [insertOverToken])

  const closeWithMemory = useCallback((): void => {
    dismissedRef.current = probeRef.current
    setOpen(false)
  }, [])

  const pickRow = useCallback((row: CompletionRowItem, viaTab: boolean): void => {
    const editorHandle = editorRef.current
    const current = probeRef.current
    if (current === null) return
    const option = row.entry.option
    if (option.origin === 'command') {
      setOpen(false)
      switch (option.row.kind) {
        case 'action':
          dismissedRef.current = current
          onPickFiles()
          return
        case 'claim':
          // The leading guard re-checks at apply time (host beginCommand):
          // the popup tracks the live probe, so the probe's own position IS
          // the fresh verdict — whitespace before the TOKEN start, the typed
          // trigger itself excluded (an isLeadingSelection caret check would
          // count the token text and never claim).
          if (current.position === 'leading' && editorHandle !== null) {
            // The claim token ends with a space: the post-insert probe is
            // none, and the armed memory clears itself through the seam.
            rememberNextRef.current = true
            editorHandle.claimSelection(option.row.token ?? '')
          } else {
            dismissedRef.current = current
          }
          return
        case 'execute':
          dismissedRef.current = current
          if (command !== undefined && sessionId !== undefined) {
            void command.execute(sessionId, option.row.line ?? '').then((result) => {
              reportExecute(result, onErrorRef.current, tRef.current)
            })
          }
          return
        case 'popup': {
          // Settle the memory only when the chained popup actually opened: a
          // mid-life opener death must not silence the live token for good.
          // The settle hook is snapshotted from the live token (issue #36) and
          // forgotten with a declined open: the popup never held it.
          if (option.row.popup === undefined) return
          const settle = editorHandle === null ? undefined : chainSettle(editorHandle, current)
          if (openChainPopup(option.row.popup, settle)) {
            dismissedRef.current = current
          }
          return
        }
        case 'feedback':
          // The host `feedbackUi` decoration: the pick opens the session
          // feedback dialog and replaces the token with NOTHING (no
          // insertion, no dismissed memory — the settled token is simply
          // gone, so the popup cannot reopen on a memory that has no text to
          // remember).
          openFeedbackSession(sessionId)
          return
      }
      return
    }
    if (option.origin === 'skill') {
      insertSettling(skillInsertion(option.name))
      return
    }
    // File rows: Tab drills into a directory — the open mention keeps the
    // token live and the descended listing opens (no dismissed memory,
    // no close); every other pick settles the reference.
    if (viaTab && option.kind === 'directory') {
      insertOverToken(option.mention)
    } else {
      insertSettling(option.mention)
    }
  }, [command, sessionId, onPickFiles, insertSettling, insertOverToken])

  // The probe arrival: the one open/close decision point, driven by the
  // editor seam's identity-deduped probes.
  const onProbe = useCallback((next: CompletionProbe | null): void => {
    if (rememberNextRef.current) {
      // A settling pick's own insertion: remember what it produced (a live
      // settled token, or none when the insertion ended the token) and
      // stay closed.
      rememberNextRef.current = false
      dismissedRef.current = next
      setProbe(next)
      setOpen(false)
      return
    }
    if (next === null) {
      dismissedRef.current = null
      setProbe(null)
      setOpen(false)
      return
    }
    if (dismissedRef.current !== null && sameProbeIdentity(dismissedRef.current, next)) {
      // The dismissed token is still there, untouched: stay closed.
      setProbe(next)
      setOpen(false)
      return
    }
    dismissedRef.current = null
    const wasOpen = openRef.current
    setProbe(next)
    setOpen(true)
    if (!wasOpen) onOpenRef.current()
  }, [])

  // Seams bind on the editor's arrival (child effects run before the card's
  // editor-mount effect, then again when the handle lands as state).
  const keyHandler = useRef<MenuKeyHandler | null>(null)
  if (keyHandler.current === null) {
    keyHandler.current = (intent) => {
      if (!visibleRef.current || rowsRef.current.length === 0) return false
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
          // Refinement pending: consume the gesture — never pick a stale
          // row, and never let Tab leave the editor mid-refinement.
          if (pendingRef.current) return true
          pickRow(rowsRef.current[Math.min(highlightRef.current, last)]!, intent === 'tab')
          return true
        case 'close':
          closeWithMemory()
          return true
      }
    }
  }
  // Mount-time warm-up: the catalog and lexicon reads start before the first
  // popup (the `+` menu face warms the catalog too — ensure is idempotent).
  useEffect(() => {
    if (command !== undefined && sessionId !== undefined) command.ensure(sessionId)
    if (skills !== undefined && sessionId !== undefined) skills.ensure(sessionId)
  }, [command, skills, sessionId])
  useEffect(() => {
    editor?.setCompletionKeyHandler(keyHandler.current)
    return () => { editor?.setCompletionKeyHandler(null) }
  }, [editor])
  useEffect(() => {
    editor?.setCompletionProbeListener(onProbe)
    return () => { editor?.setCompletionProbeListener(null) }
  }, [editor, onProbe])

  // The card closes the popup when the `+` menu opens (one candidate
  // surface above the card — the native single-MenuView semantics).
  useEffect(() => {
    registerClose(closeWithMemory)
    return () => { registerClose(null) }
  }, [closeWithMemory, registerClose])

  // The `@` search: one fetch per live query, the previous results kept
  // visible while the fresh one runs (native stale-while-revalidate).
  useEffect(() => {
    if (!visible || probe === null || probe.trigger !== '@' || fileFace === undefined || sessionId === undefined) {
      return undefined
    }
    const controller = new AbortController()
    inFlightRef.current?.abort()
    inFlightRef.current = controller
    setFetching(true)
    void fileFace.search(sessionId, probe.query, controller.signal).then((results) => {
      if (controller.signal.aborted) return
      inFlightRef.current = null
      setLanded({ sessionId, query: probe.query, results })
      setFetching(false)
    }).catch(() => {
      // The face resolves failures to []; a face-level surprise must not
      // leave a permanent pending group behind.
      if (!controller.signal.aborted) setFetching(false)
    })
    return () => {
      controller.abort()
      if (inFlightRef.current === controller) inFlightRef.current = null
      setFetching(false)
    }
  }, [visible, probe, fileFace, sessionId])

  // Outside-pointerdown dismissal (the host MenuView's rule; the native
  // external-dismiss verb records the memory too — controller.dismiss()
  // calls rememberDismissed() — so an outer click silences the token).
  useEffect(() => {
    if (!visible) return undefined
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (menuRef.current?.contains(event.target) === true) return
      if (container.current?.contains(event.target) === true) return
      closeWithMemory()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown, true) }
  }, [visible, closeWithMemory, container])

  // A new token resets the highlight; a shrunk list clamps it.
  useEffect(() => { setHighlight(0) }, [probe])
  useEffect(() => {
    if (highlight > rows.length - 1) setHighlight(Math.max(0, rows.length - 1))
  }, [rows.length, highlight])

  // The keyboard highlight scrolls, not the editor (combobox).
  useEffect(() => {
    if (!visible) return
    document.getElementById(rows[Math.min(highlight, rows.length - 1)]?.id ?? '')?.scrollIntoView?.({ block: 'nearest' })
  }, [visible, highlight, rows])

  const maxHeight = useAnchoredMaxHeight(menuRef, MAX_HEIGHT, visible ? rows : null, TOP_MARGIN)

  if (sessionId === undefined) return null
  if (!visible || allReadyEmpty || probe === null || view === null || container.current === null) return null

  const activeFlat = Math.min(highlight, rows.length - 1)

  return createPortal(
    <MenuSurface
      ref={menuRef}
      className={css.menu}
      style={{ maxHeight } satisfies CSSProperties}
      data-completion-menu=""
    >
      <div
        className={css.viewport}
        role="listbox"
        aria-label={t('completion.suggestions.aria')}
        aria-activedescendant={rows[activeFlat]?.id}
      >
        {items.map((item) => {
          if (item.kind === 'groupTitle') {
            return (
              <div key={item.key} className={css.groupTitle} role="presentation" data-completion-group>
                {item.label}
              </div>
            )
          }
          if (item.kind === 'sectionTitle') {
            return <div key={item.key} className={css.sectionTitle} role="presentation" data-completion-section>{item.label}</div>
          }
          if (item.kind === 'skeleton') {
            return (
              <div key={item.key} role="status" aria-label={t('completion.loading')} data-completion-loading>
                <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '32%' }} /></div>
                <div className={css.skeletonRow}><span className={css.skeletonBar} style={{ width: '48%' }} /></div>
              </div>
            )
          }
          const { id, flat } = item
          const active = flat === activeFlat
          return (
            <OptionButton
              key={id}
              item={item}
              active={active}
              onPick={pickRow}
              highlight={setHighlight}
              t={t}
            />
          )
        })}
      </div>
    </MenuSurface>,
    container.current,
  )
}

/**
 * One candidate row: the shared combobox button shell (listbox option
 * semantics, mousedown pick that keeps the editor focused, pointer-motion
 * highlight) around the origin's content — command rows keep their `+` menu
 * face (icon component, localized title, alias, right-aligned description),
 * skill rows read name + description, file rows carry the reference glyph,
 * the parent-directory location, and a directory's drill affordance.
 */
function OptionButton({ item, active, onPick, highlight, t }: {
  item: CompletionRowItem
  active: boolean
  onPick: (row: CompletionRowItem, viaTab: boolean) => void
  highlight: (flat: number) => void
  t: PropsLocale<typeof NS>['t']
}): ReactNode {
  const { entry, id, flat } = item
  const option = entry.option
  const marker = option.origin === 'command'
    ? option.row.name
    : option.origin === 'skill'
      ? option.name
      : option.path
  let content: ReactNode
  if (option.origin === 'command') {
    const row = option.row
    const alias = row.label.toLowerCase() !== row.name.toLowerCase()
    content = (
      <>
        {row.icon !== undefined && (
          <span className={css.itemIcon} aria-hidden><row.icon size={14} /></span>
        )}
        <span className={css.itemName}>{row.label}</span>
        {alias && <span className={css.itemAlias} data-completion-alias>{row.name}</span>}
        {row.description !== undefined && (
          <span className={css.itemDescription}>{row.description}</span>
        )}
      </>
    )
  } else if (option.origin === 'skill') {
    content = (
      <>
        <span className={css.itemName}>{option.name}</span>
        {option.description !== undefined && (
          <span className={css.itemDescription}>{option.description}</span>
        )}
      </>
    )
  } else {
    const directory = option.kind === 'directory'
    content = (
      <>
        <span className={css.itemIcon} aria-hidden>
          <ReferenceIconRegular kind={directory ? 'folder' : 'file'} size={14} />
        </span>
        <span className={css.itemName}>{option.label}</span>
        {/* The wire name with the directory's trailing slash, native
            file-row parity (`src/` beside `src`). */}
        <span className={css.itemAlias} data-completion-alias>{`${option.label}${directory ? '/' : ''}`}</span>
        {option.parent !== '' && (
          <span className={css.itemDescription}>{option.parent}</span>
        )}
        {directory && (
          <span className={css.trailing}>
            {/* Visual hint only: Tab drills the highlighted row; the chevron
                is its pointer twin (mousedown keeps the editor focused,
                stopPropagation keeps the settle pick out). */}
            <span className={css.drillHintText} aria-hidden>{t('completion.drill.hint')}</span>
            <kbd className={css.drillKey} aria-hidden>{t('completion.drill.key')}</kbd>
            <span
              role="button"
              aria-label={t('completion.drill.aria')}
              className={css.drill}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onPick(item, true)
              }}
            >›</span>
          </span>
        )}
      </>
    )
  }
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={active}
      className={active ? `${css.item} ${css.itemActive}` : css.item}
      data-completion-option={marker}
      onMouseDown={(event) => {
        event.preventDefault()
        onPick(item, false)
      }}
      onMouseMove={active ? undefined : () => { highlight(flat) }}
    >
      {content}
    </button>
  )
}
