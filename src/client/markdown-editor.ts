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

  const baseExtensions: Extension[] = [
    history(),
    // markdownLanguage is the GFM-extended base (task lists included);
    // markdown()'s plain default is CommonMark only.
    markdown({ base: markdownLanguage }),
    EditorView.lineWrapping,
    Prec.highest(keymap.of([
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
    destroy: () => view.destroy(),
  }
}
