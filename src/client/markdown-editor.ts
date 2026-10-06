/**
 * The CodeMirror 6 surface of the taken-over composer: one factory that
 * mounts the editor, owns the key semantics (Enter always sends — no fence
 * exception since #46; Shift+Enter continues lists and quotes in render
 * mode and is a plain newline otherwise; IME composition never sends),
 * owns the paste migration (T6: the paste decision core converts rich text
 * to clean Markdown, plain/gesture/file pastes keep host intake semantics),
 * and reconfigures render/source mode and the placeholder through
 * compartments so undo history and scroll survive a mode switch. Component
 * tests drive this handle directly.
 */
import {
  history, historyKeymap, defaultKeymap, insertNewlineAndIndent,
} from '@codemirror/commands'
import { insertNewlineContinueMarkup, markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, placeholder,
} from '@codemirror/view'
import { liveRender } from './live-render.ts'
import { decideRichPaste, plainPasteGestureTracker, readClipboard } from './paste-decision.ts'
import { detectCompletion, sameProbeIdentity, type CompletionProbe } from './completion-core.ts'
import { refChipDecorations, setClaimGhostEffect, setSkillLexiconEffect, type ClaimGhost } from './ref-chip-decor.ts'

export type EditMode = 'render' | 'source'

/**
 * Which move the open `+` command menu wants (its combobox keyboard). The
 * completion popups (T10) share the seam: `tab` is their drill-or-pick verb,
 * which the `+` menu answers as an ordinary pick.
 */
export type MenuKeyIntent = 'up' | 'down' | 'pick' | 'close' | 'tab'

/** A menu key handler: consumes a key by returning true (the editor's own
 * commands never see it), or declines to fall through while the menu is
 * closed. Handlers are consulted for the combobox keys only. */
export type MenuKeyHandler = (intent: MenuKeyIntent) => boolean

/** The completion probe seam's listener: identity-deduped token or none. */
export type CompletionProbeListener = (probe: CompletionProbe | null) => void

/**
 * Shift+Enter continuation, path a: a line holding only a list marker and
 * whitespace. `1)`-style markers included.
 */
const EMPTY_ITEM_LINE_RE = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]*$/u

/** Shift+Enter continuation, path b: a line holding only `>` and whitespace. */
const EMPTY_QUOTE_LINE_RE = /^[ \t]*>[ \t]*$/u

/**
 * The empty-marker exit kind at `pos`, or null. The line-shape regexes only
 * nominate; the syntax tree confirms the context — a ListItem or a
 * Blockquote must own the line — and vetoes fenced code, where markup
 * shapes are code text, not a list or quote to exit. (The tree covers
 * unterminated fences: a fence without a closer still spans to the end of
 * the document.) The resolution anchors at the markup's own character, not
 * the caret: a caret parked before the marker's end (the line start
 * included) resolves to no marker-bearing ancestor of its own, while the
 * marker character always sits inside the ListItem/Blockquote the line
 * belongs to.
 */
function emptyMarkupExit(state: EditorState, pos: number): 'item' | 'quote' | null {
  const line = state.doc.lineAt(pos)
  const item = EMPTY_ITEM_LINE_RE.test(line.text)
  const quote = EMPTY_QUOTE_LINE_RE.test(line.text)
  if (!item && !quote) return null
  const mark = line.from + /^[ \t]*/.exec(line.text)![0].length
  for (let cur: SyntaxNode | null = syntaxTree(state).resolveInner(mark, 1); cur !== null; cur = cur.parent) {
    if (cur.name === 'FencedCode') return null
    if (item && cur.name === 'ListItem') return 'item'
    if (quote && cur.name === 'Blockquote') return 'quote'
  }
  return null
}

/**
 * Shift+Enter's list/quote continuation dispatch (#46), in priority order:
 * an empty list-item or quote line deletes its markup and exits (paths a/b —
 * the caret returns to the line start, no newline is inserted); list and
 * quote rows continue through lezer's markup-continuation command (path c —
 * same indent, next marker, ordered numbers advance by the written source
 * number); inside a fence that command declines itself (non-markdown
 * context) so the generic indented newline keeps the status quo (path d);
 * everywhere else it declines too and the bare newline remains (path e).
 */
function shiftEnterCommand(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  if (range.empty && emptyMarkupExit(state, range.head) !== null) {
    const line = state.doc.lineAt(range.head)
    view.dispatch({
      changes: { from: line.from, to: line.to },
      selection: { anchor: line.from },
      userEvent: 'input',
    })
    return true
  }
  if (insertNewlineContinueMarkup(view)) return true
  return insertNewlineAndIndent(view)
}

/**
 * Whether the line holds a list marker (a tree ListMark) — the gate that
 * scopes Tab/Shift-Tab to list rows. Fences and plain text are list-outside
 * and fall through to the browser's own focus move.
 */
function isListItemLine(state: EditorState, line: { from: number, to: number }): boolean {
  let found = false
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (node) => {
      if (node.name === 'ListMark') {
        found = true
        return false
      }
      return undefined
    },
  })
  return found
}

/**
 * The caret's line when it holds a list marker, or null — the shared gate
 * for the Tab indent commands: outside a list row both decline and the key
 * keeps the browser's focus move (native semantics).
 */
function listItemCaretLine(state: EditorState): { from: number, to: number, text: string } | null {
  const line = state.doc.lineAt(state.selection.main.head)
  return isListItemLine(state, line) ? line : null
}

/**
 * Tab inside a list row (render mode): two spaces at the line start — one
 * indent level. Outside a list the command declines and the key keeps the
 * browser's focus move (native semantics).
 */
function listItemTab(view: EditorView): boolean {
  const line = listItemCaretLine(view.state)
  if (!line) return false
  view.dispatch({
    changes: { from: line.from, insert: '  ' },
    userEvent: 'input.indent',
  })
  return true
}

/**
 * Shift+Tab inside a list row: remove up to two leading spaces (one indent
 * level). A row already at the margin consumes the key without changes so
 * the focus never jumps out mid-list.
 */
function listItemShiftTab(view: EditorView): boolean {
  const line = listItemCaretLine(view.state)
  if (!line) return false
  const spaces = /^ */.exec(line.text)![0].length
  const remove = Math.min(2, spaces)
  if (remove > 0) {
    view.dispatch({
      changes: { from: line.from, to: line.from + remove },
      userEvent: 'input.indent',
    })
  }
  return true
}

/** Render-mode-only keymap: the list continuation dispatch and the list
 * indent keys. Mounted through the render compartment so source mode keeps
 * its plain newline and the browser's Tab default. */
const renderListKeymap = keymap.of([
  { key: 'Shift-Enter', run: shiftEnterCommand },
  { key: 'Tab', run: listItemTab },
  { key: 'Shift-Tab', run: listItemShiftTab },
])

/**
 * Editor command: Enter always submits (#46 removed the fence-newline
 * exception — the ADR-0001 key semantics are strict send again). IME
 * composition consumes the key entirely: no send, no stray newline.
 */
function enterCommand(submit: () => void): (view: EditorView) => boolean {
  return (view) => {
    // IME composition: the Enter that confirms candidates is fully consumed
    // here — no send, and no stray newline under the composition.
    if (view.composing) return true
    submit()
    return true
  }
}

export interface MarkdownEditorOptions {
  /** Element the editor mounts into. */
  parent: HTMLElement
  placeholder: string
  mode: EditMode
  /** Enter with non-composing input: send the message (fences included, #46). */
  onSubmit(): void
  /** The document text changed (draft surfaced to the component). */
  onDocChange(text: string): void
  /**
   * Pasted files and images ride the host attachment intake (the same
   * channel as drag-and-drop and the attach button). True means the intake
   * admitted them and the paste is consumed; a false return leaves the
   * event to the default path, which does nothing with files.
   */
  onFiles(files: readonly File[]): boolean
}

export interface MarkdownEditorHandle {
  /** The live view; exposed for the component's focus plumbing and tests. */
  readonly view: EditorView
  setMode(mode: EditMode, placeholder: string): void
  /** Toggle the editable face; a read-only surface keeps the draft visible. */
  setEditable(editable: boolean): void
  /** Replace the whole document and park the caret at its end; no-op when equal. */
  setText(text: string): void
  getText(): string
  focus(): void
  /**
   * Install (or clear) the open `+` menu's key handler. The menu owns the
   * combobox keys — ↑/↓ cycle the highlight, Enter/Tab pick it,
   * Shift+Tab/Escape close — while its handler accepts them; a declined or
   * absent handler returns the keys to the editor's own commands. The
   * completion popups' handler (T10) shares the seam and is consulted first.
   */
  setMenuKeyHandler(handler: MenuKeyHandler | null): void
  /**
   * Install (or clear) the completion popups' key handler (T10). Same
   * contract as the `+` menu's handler, consulted ahead of it: ↑/↓ cycle,
   * Enter picks, Tab drills-or-picks, Escape/Shift+Tab close; declined keys
   * fall through to the `+` menu's handler and then the editor's own.
   */
  setCompletionKeyHandler(handler: MenuKeyHandler | null): void
  /**
   * Install (or clear) the completion popups' probe listener (T10). The
   * editor re-detects the live trigger token on every document/selection
   * change — frozen while IME composition runs, re-emitted from the
   * compositionend seam when the composition ends with no transaction (#45)
   * — and delivers identity-deduped probes (or null). Binding delivers the
   * current probe.
   */
  setCompletionProbeListener(listener: CompletionProbeListener | null): void
  /**
   * Replace the hot skill dictionary behind the chip decorations' `/` arm
   * (the `remote.skills` face resolves after mount; an empty roll keeps
   * slash tokens plain text — the per-face degradation contract).
   */
  setSkillLexicon(names: readonly string[]): void
  /** Set (or clear) the active command claim's token mark and ghost hint. */
  setClaimGhost(ghost: ClaimGhost | null): void
  /**
   * Whether only whitespace precedes the selection (the leading-trigger
   * position of the host's command pipeline — claim rows only make sense
   * there, and a claim inserts over the whole document head).
   */
  isLeadingSelection(): boolean
  /**
   * Insert one claim token over the document head through the selection end
   * (the host beginCommand contract) and park the caret after the token;
   * the trailing-space token text is the caller's.
   */
  claimSelection(token: string): void
  destroy(): void
}

/**
 * The takeover editor's paste face (T6): the paste decision core —
 * readClipboard + decideRichPaste — is the one paste surface since T7
 * retired the dock occupant over the native fallback composer. Files and
 * images are intercepted first and ride the host attachment intake; a
 * converted rich paste lands at the selection in one transaction; every
 * other paste (plain-only, Ctrl/Cmd+Shift+V, no-op conversion, no
 * clipboard payload) returns false and CM6's own paste handler inserts the
 * plain flavor untouched.
 *
 * Paste priority design (the T6 note for T9/T10): paste rides a
 * contentDOM DOM handler, NOT the keymap — `paste` is not a keymap event,
 * so this holds no keymap rank and can neither preempt nor be preempted by
 * the Prec.highest menu-combobox bindings (T5), defaultKeymap, or the
 * completion keymaps T9/T10 will add. The conversion dispatches one
 * ordinary replaceSelection transaction: the live-render decorations
 * (mark/replace, no atomicRanges) simply recompute from the new document —
 * a paste can never wedge on decoration bounds — and any active completion
 * popup (T9/T10) observes the standard `input.paste` userEvent and reacts
 * as it would to CM6's own paste (dismiss on document change). The same
 * single transaction with its `input.paste` annotation is one history
 * entry: one undo step reverts a converted paste without touching typed
 * text around it.
 *
 * The plain-paste gesture reads two signals: the modifier keys browsers
 * put on the paste event itself, and the validated keydown-window tracker
 * (plainPasteGestureTracker) — the mechanism the alpha.2/3 native path
 * shipped — fed from contentDOM keydowns as the engine-independent floor
 * for hosts whose paste events omit modifier state.
 * @param onFiles - the host attachment intake (admission → consume).
 */
function pasteHandler(onFiles: (files: readonly File[]) => boolean): Extension {
  const gesture = plainPasteGestureTracker()
  return EditorView.domEventHandlers({
    // Arming the plain-paste window needs no consumption: every keydown
    // feeds the tracker, which filters for Ctrl/Cmd+Shift+V itself.
    keydown(event) {
      gesture.keydown(event)
      return false
    },
    paste(event, view) {
      const transfer = event.clipboardData
      if (transfer === null) return false
      const clipboard = readClipboard(transfer)
      // Files and images never reach the text converter: the host intake
      // owns them, and only an admitted intake consumes the paste.
      if (clipboard.hasFiles) {
        if (clipboard.files.length === 0 || !onFiles(clipboard.files)) return false
        event.preventDefault()
        return true
      }
      // The DOM types omit keyboard modifiers on ClipboardEvent; real paste
      // events carry them, and the plain-text gesture needs them.
      const modifiers = event as ClipboardEvent & { ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }
      const eventGesture = (modifiers.ctrlKey === true || modifiers.metaKey === true) && modifiers.shiftKey === true
      const decision = decideRichPaste(clipboard, eventGesture || gesture.active())
      if (decision.action !== 'convert') return false
      event.preventDefault()
      view.dispatch(view.state.replaceSelection(decision.markdown), {
        scrollIntoView: true,
        userEvent: 'input.paste',
      })
      return true
    },
  })
}

/** Editable-face extensions: DOM and transaction gates flip together. */
function editableExtensions(editable: boolean): Extension {
  return [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]
}

/**
 * Mount the markdown editor and return the component-facing handle.
 * @param options - mount target, initial mode/placeholder, and callbacks.
 */
export function createMarkdownEditor(options: MarkdownEditorOptions): MarkdownEditorHandle {
  const { parent } = options
  // The render-mode compartment: the live-render decorations AND the
  // render-only list keymap (#46) flip together; source mode empties it.
  const renderCompartment = new Compartment()
  const placeholderCompartment = new Compartment()
  const editableCompartment = new Compartment()
  // The open `+` menu installs its key handler here; the keymap consults it
  // ahead of the editor's own commands and falls through while it is null.
  const menuHandler: { current: MenuKeyHandler | null } = { current: null }
  // The completion popups (T10) install theirs here; runMenu consults the
  // completion handler FIRST (its popup and the `+` menu never open at once —
  // typed text closes the menu — so the chain is unambiguous), then the
  // `+` menu's, then declines so the editor's own commands carry on.
  const completionHandler: { current: MenuKeyHandler | null } = { current: null }
  const runMenu = (intent: MenuKeyIntent) => (view: EditorView): boolean => {
    // IME composition: a candidate-confirming keystroke never drives the
    // menus (defense in depth behind the editor's own composition gating).
    if (view.composing) return true
    const completion = completionHandler.current
    if (completion !== null && completion(intent)) return true
    const menu = menuHandler.current
    return menu === null ? false : menu(intent)
  }
  // The completion probe seam (T10): the live trigger token is re-detected
  // on every document/selection change and delivered identity-deduped; the
  // listener binds late (the popup face mounts as a sibling), so binding
  // delivers the current probe once.
  const probeListener: { current: CompletionProbeListener | null } = { current: null }
  let lastProbe: CompletionProbe | null = null
  const emitProbe = (state: EditorState, force = false): void => {
    const listener = probeListener.current
    if (listener === null) return
    const next = detectCompletion(state.doc.toString(), state.selection.main.head)
    if (!force && sameProbeIdentity(next, lastProbe)) return
    lastProbe = next
    listener(next)
  }

  // The composition-end probe re-emit (#45): on Windows Chrome the IME's
  // committed text is already in the document DURING the composition (each
  // mutation is read as an `input.type.compose` transaction the composing
  // gate below freezes), so compositionend has nothing pending to flush —
  // CM6 schedules no transaction and its 50ms composition-clear update
  // (`view.update([])`) carries neither docChanged nor selectionSet, and
  // the probe stays at the composition-start snapshot (the committed `/mo`
  // never retargets the popup). The compositionend DOM event is the one
  // reliable end signal. It lands one microtask later: CM6's own
  // compositionend observer (view/dist/index.cjs:5304-5321) runs ahead of
  // every domEventHandlers handler (observers before handlers,
  // :4593-4603 + :4749-4751), so `view.composing` is already false, and a
  // Safari-style pending-change flush is itself a microtask queued ahead
  // of this one — by our tick the re-read sees the committed text, before
  // the next paint (rAF/setTimeout would add frame/timer delay for no
  // ordering gain). The identity dedupe in emitProbe makes repeat events
  // and flush-preceded emissions no-ops; the freeze semantics are intact —
  // nothing emits while `view.composing` still holds.
  let compositionEndPending = false
  let editorDestroyed = false
  const compositionEndProbe: Extension = EditorView.domEventHandlers({
    compositionend(_event, view) {
      if (editorDestroyed || compositionEndPending) return
      compositionEndPending = true
      queueMicrotask(() => {
        compositionEndPending = false
        if (editorDestroyed || view.composing) return
        emitProbe(view.state)
      })
    },
  })

  const baseExtensions: Extension[] = [
    history(),
    // markdownLanguage is the GFM-extended base (task lists included);
    // markdown()'s plain default is CommonMark only.
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    Prec.highest(keymap.of([
      // The open menus' combobox keys stay the highest-priority bindings; a
      // declining run (both popups closed) hands each key back to the
      // bindings below. Tab routes the completion popups' drill-or-pick
      // verb; the `+` menu answers it as an ordinary pick.
      { key: 'ArrowUp', run: runMenu('up') },
      { key: 'ArrowDown', run: runMenu('down') },
      { key: 'Enter', run: runMenu('pick') },
      { key: 'Tab', run: runMenu('tab') },
      { key: 'Shift-Tab', run: runMenu('close') },
      { key: 'Escape', run: runMenu('close') },
      // Enter always submits (#46) — and it must sit in THIS keymap, not the
      // default-precedence one below: lang-markdown's own keymap binds Enter
      // to insertNewlineContinueMarkup at Prec.high (markdownKeymap, pushed
      // by markdown() at lang-markdown/dist:423), which outranks every
      // default-precedence binding and claims Enter for a continuation
      // newline on list and quote lines (lazy-continuation lines included) —
      // the alpha.16 regression. After the menu pick, precedence no longer
      // matters: the menu answers first, everywhere else Enter sends.
      { key: 'Enter', run: enterCommand(options.onSubmit) },
    ])),
    // The render-mode list keys (#46) sit ahead of the send/newline base so
    // the continuation dispatch replaces the plain Shift+Enter newline and
    // Tab/Shift-Tab indent list rows — but behind the menu combobox chain
    // above, which always answers first. Source mode reconfigures the
    // compartment to [] and keeps the base alone.
    renderCompartment.of(options.mode === 'render' ? [liveRender, renderListKeymap] : []),
    keymap.of([
      // Enter always submits (#46: no fence exception) and rides the
      // Prec.highest keymap above; Shift+Enter is the generic indented
      // newline — the base the render compartment rebinds.
      { key: 'Shift-Enter', run: insertNewlineAndIndent },
    ]),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChange(update.state.doc.toString())
      // The probe freezes while IME composition runs (a pinyin caret churns
      // the token per keystroke). The end-of-composition re-emit is NOT this
      // listener's job: on Windows Chrome the composition ends with no
      // transaction at all (the committed text landed during the
      // composition, and the end carries nothing to flush), so this listener
      // alone never sees it — the compositionend seam below re-emits.
      if (update.view.composing) return
      if (update.docChanged || update.selectionSet) emitProbe(update.state)
    }),
    pasteHandler(options.onFiles),
    compositionEndProbe,
    refChipDecorations,
  ]

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        baseExtensions,
        placeholderCompartment.of(placeholder(options.placeholder)),
        editableCompartment.of(editableExtensions(true)),
      ],
    }),
  })

  return {
    view,
    setMode(mode, placeholderText) {
      // Effects ride an explicit effects array: bare StateEffect specs are
      // dropped by this @codemirror/state line.
      view.dispatch({
        effects: [
          renderCompartment.reconfigure(mode === 'render' ? [liveRender, renderListKeymap] : []),
          placeholderCompartment.reconfigure(placeholder(placeholderText)),
        ],
      })
    },
    setEditable(editable) {
      view.dispatch({
        effects: [editableCompartment.reconfigure(editableExtensions(editable))],
      })
    },
    setText(text) {
      if (view.state.doc.toString() === text) return
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: text.length },
      })
    },
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    setMenuKeyHandler(handler) {
      menuHandler.current = handler
    },
    setCompletionKeyHandler(handler) {
      completionHandler.current = handler
    },
    setCompletionProbeListener(listener) {
      probeListener.current = listener
      // Late binding delivers the current probe: a draft restored (or seeded)
      // while no listener was bound still opens on its live trigger token.
      if (listener !== null) emitProbe(view.state, true)
    },
    setSkillLexicon(names) {
      view.dispatch({ effects: setSkillLexiconEffect.of([...names]) })
    },
    setClaimGhost(ghost) {
      view.dispatch({ effects: setClaimGhostEffect.of(ghost) })
    },
    isLeadingSelection(): boolean {
      const selection = view.state.selection.main
      return view.state.doc.sliceString(0, selection.from).trim() === ''
    },
    claimSelection(token) {
      view.dispatch({
        changes: { from: 0, to: view.state.selection.main.to, insert: token },
        selection: { anchor: token.length },
        scrollIntoView: true,
      })
    },
    destroy: () => {
      // Silences the compositionend seam's deferred re-emit: a destroyed
      // editor must not deliver probes (the listener is already cleared by
      // the component's own teardown, but the seam stays self-contained).
      editorDestroyed = true
      view.destroy()
    },
  }
}
