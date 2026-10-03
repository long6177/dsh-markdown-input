/**
 * The CodeMirror 6 surface of the taken-over composer: one factory that
 * mounts the editor, owns the key semantics (Enter sends, Shift+Enter and
 * code-fence Enter newline, IME composition never sends), converts pasted
 * HTML to clean Markdown, and reconfigures render/source mode and the
 * placeholder through compartments so undo history and scroll survive a
 * mode switch. Component tests drive this handle directly.
 */
import {
  history, historyKeymap, defaultKeymap, insertNewlineAndIndent,
} from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, placeholder,
} from '@codemirror/view'
import { liveRender } from './live-render.ts'
import { convertHtmlToMarkdown } from './paste-converter.ts'

export type EditMode = 'render' | 'source'

/** Which move the open `+` command menu wants (its combobox keyboard). */
export type MenuKeyIntent = 'up' | 'down' | 'pick' | 'close'

/**
 * A menu key handler: consumes a key by returning true (the editor's own
 * commands never see it), or declines to fall through while the menu is
 * closed. Handlers are consulted for the six menu keys only.
 */
export type MenuKeyHandler = (intent: MenuKeyIntent) => boolean

/** A fence marker line toggles the inside-fence state during the Enter scan. */
const FENCE_LINE_RE = /^\s{0,3}(?:```+|~~~+)/u

/**
 * Whether the caret sits inside an unterminated fenced code block. A line
 * scan, not a syntax-tree query: while the user is typing a fence the
 * closing marker does not exist yet, so the tree ends at the opening line
 * and would report the caret outside.
 */
export function insideOpenFence(doc: string, caretLine: number): boolean {
  const lines = doc.split('\n')
  let inside = false
  for (let i = 0; i <= caretLine && i < lines.length; i++) {
    const isFence = FENCE_LINE_RE.test(lines[i]!)
    if (i === caretLine) return isFence || inside
    if (isFence) inside = !inside
  }
  return inside
}

export interface MarkdownEditorOptions {
  /** Element the editor mounts into. */
  parent: HTMLElement
  placeholder: string
  mode: EditMode
  /** Enter outside a fence with non-composing input: send the message. */
  onSubmit(): void
  /** The document text changed (draft surfaced to the component). */
  onDocChange(text: string): void
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
   * six combobox keys — ↑/↓ cycle the highlight, Enter/Tab pick it,
   * Shift+Tab/Escape close — while its handler accepts them; a declined or
   * absent handler returns the keys to the editor's own commands.
   */
  setMenuKeyHandler(handler: MenuKeyHandler | null): void
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

/** Editor command: Enter sends outside fences, newlines inside them. */
function enterCommand(submit: () => void): (view: EditorView) => boolean {
  return (view) => {
    // IME composition: the Enter that confirms candidates is fully consumed
    // here — no send, and no stray newline under the composition.
    if (view.composing) return true
    const { state } = view
    const caretLine = state.doc.lineAt(state.selection.main.head).number
    if (insideOpenFence(state.doc.toString(), caretLine)) {
      return insertNewlineAndIndent(view)
    }
    submit()
    return true
  }
}

function pasteHandler(onDocChange: (text: string) => void): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const transfer = event.clipboardData
      if (transfer === null) return false
      // The DOM types omit keyboard modifiers on ClipboardEvent; real paste
      // events carry them, and the plain-text gesture needs them.
      const modifiers = event as ClipboardEvent & { ctrlKey?: boolean, metaKey?: boolean, shiftKey?: boolean }
      const plainGesture = (modifiers.ctrlKey === true || modifiers.metaKey === true) && modifiers.shiftKey === true
      const html = transfer.getData('text/html')
      if (plainGesture || html === '') return false
      event.preventDefault()
      view.dispatch(view.state.replaceSelection(convertHtmlToMarkdown(html)), {
        scrollIntoView: true,
      })
      onDocChange(view.state.doc.toString())
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
  const renderCompartment = new Compartment()
  const placeholderCompartment = new Compartment()
  const editableCompartment = new Compartment()
  // The open `+` menu installs its key handler here; the keymap consults it
  // ahead of the editor's own commands and falls through while it is null.
  const menuHandler: { current: MenuKeyHandler | null } = { current: null }
  const runMenu = (intent: MenuKeyIntent) => (view: EditorView): boolean => {
    // IME composition: a candidate-confirming keystroke never drives the
    // menu (defense in depth behind the editor's own composition gating).
    if (view.composing) return true
    const handler = menuHandler.current
    return handler === null ? false : handler(intent)
  }

  const baseExtensions: Extension[] = [
    history(),
    // markdownLanguage is the GFM-extended base (task lists included);
    // markdown()'s plain default is CommonMark only.
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    Prec.highest(keymap.of([
      // The open menu's combobox keys sit ahead of the send/newline bindings;
      // a declining run (menu closed) hands each key back to the next binding.
      { key: 'ArrowUp', run: runMenu('up') },
      { key: 'ArrowDown', run: runMenu('down') },
      { key: 'Enter', run: runMenu('pick') },
      { key: 'Tab', run: runMenu('pick') },
      { key: 'Shift-Tab', run: runMenu('close') },
      { key: 'Escape', run: runMenu('close') },
      { key: 'Enter', run: enterCommand(options.onSubmit) },
      { key: 'Shift-Enter', run: insertNewlineAndIndent },
    ])),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onDocChange(update.state.doc.toString())
    }),
    pasteHandler(options.onDocChange),
  ]

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: '',
      extensions: [
        baseExtensions,
        renderCompartment.of(options.mode === 'render' ? liveRender : []),
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
          renderCompartment.reconfigure(mode === 'render' ? liveRender : []),
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
    destroy: () => view.destroy(),
  }
}
