/**
 * L3 paste layer (issue #14, ADR-0003): rich-text paste converts to clean
 * Markdown (paste-converter.ts) and writes through the host's version-guarded
 * insertion API — one undo step at the caret, while plain text, file, and
 * image pastes keep their native behavior. The engine below is the decision
 * core (clipboard summary → decision → guarded insertion); the DOM wiring
 * that feeds it lives in PasteDock.tsx.
 */
import { probe, type Capability, type KillSwitch } from './capability.ts'
import { convertHtmlToMarkdown } from './paste-converter.ts'

/**
 * The slice of the rc.2 `InputActions` face the paste layer drives
 * (`captureInsertion` + `insertText`, the version-guarded caret insertion).
 * A structural mirror, not an import: the face reaches this layer as an
 * unknown-shaped value from the conversation service, and a host that
 * dropped the verbs must read as unsupported, not as a type error.
 */
export interface InsertionFace {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

/**
 * Probe one candidate face for the guarded insertion API. A host build
 * that moved or dropped the verbs disables the paste layer (paste stays
 * native); the converter module itself stays import-safe either way.
 * @param face - candidate input face of unknown shape.
 */
export function insertionCapability(face: unknown): Capability {
  return probe(
    () => {
      if (typeof face !== 'object' || face === null) return false
      const candidate = face as Partial<InsertionFace>
      return typeof candidate.captureInsertion === 'function'
        && typeof candidate.insertText === 'function'
    },
    'guarded insertion API (captureInsertion/insertText) unavailable',
  )
}

/** The clipboard summary the paste decision reads. */
export interface PasteClipboard {
  /** Whether any clipboard item carries a file (images included). */
  readonly hasFiles: boolean
  /** The `text/html` flavor; '' when absent. */
  readonly html: string
  /** The `text/plain` flavor; '' when absent. */
  readonly plain: string
}

/** What the paste layer does with one paste into the composer. */
export type PasteDecision =
  /** Leave the event alone; the host's own paste routing applies. */
  | { readonly action: 'native' }
  /** The event is intercepted and `markdown` inserted in one guarded step. */
  | { readonly action: 'convert'; readonly markdown: string }

/**
 * Read one paste event's clipboard payload, duck-typed because test engines
 * deliver `clipboardData` in varied shapes (the host keymap makes the same
 * concession). A throwing `getData` reads as an absent flavor.
 * @param data - the event's `clipboardData`, of any shape.
 */
export function readClipboard(data: unknown): PasteClipboard {
  if (typeof data !== 'object' || data === null) {
    return { hasFiles: false, html: '', plain: '' }
  }
  const transfer = data as DataTransfer
  let hasFiles = false
  const items = transfer.items
  if (items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      if (items[index]?.kind === 'file') {
        hasFiles = true
        break
      }
    }
  }
  const read = (type: string): string => {
    try {
      return transfer.getData(type) ?? ''
    } catch {
      return ''
    }
  }
  return { hasFiles, html: read('text/html'), plain: read('text/plain') }
}

/**
 * Decide what the paste layer does with one paste into the composer. Files
 * and images ride the host intake; the plain-paste gesture and any clipboard
 * without an HTML flavor ride the host text path; an HTML flavor whose
 * Markdown would add nothing over the plain text (a plain paragraph, a
 * heading) also stays native so the host keeps its own paste semantics.
 * Everything else converts.
 * @param clipboard - the event's clipboard summary.
 * @param plainGesture - whether Ctrl/Cmd+Shift+V armed the plain-paste window.
 */
export function decideRichPaste(clipboard: PasteClipboard, plainGesture: boolean): PasteDecision {
  if (clipboard.hasFiles || plainGesture || clipboard.html.trim() === '') {
    return { action: 'native' }
  }
  const markdown = convertHtmlToMarkdown(clipboard.html)
  if (markdown === '' || markdown === clipboard.plain.trim()) {
    return { action: 'native' }
  }
  return { action: 'convert', markdown }
}

/**
 * Insert text through the guarded face: capture the selection span, then
 * let the host CAS the draft revision. One fresh capture on a miss; a
 * second refusal (machine frozen, disposed) fails the insertion and the
 * caller lets the native paste proceed.
 * @param face - the version-guarded insertion face.
 * @param text - plain text to insert at the caret in one undo step.
 */
export function insertGuarded(face: InsertionFace, text: string): boolean {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (face.insertText(text, face.captureInsertion())) return true
  }
  return false
}

/** How long a Ctrl/Cmd+Shift+V keydown arms the plain-paste window. */
export const PLAIN_PASTE_WINDOW_MS = 1000

/** The plain-paste gesture state one composer instance tracks. */
export interface PlainPasteGesture {
  /** Feed one keydown; Ctrl/Cmd+Shift+V arms the window. */
  keydown(event: { key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): void
  /** Whether the window is armed at `now` (defaults to the tracker's clock). */
  active(now?: number): boolean
}

/**
 * Track the Ctrl/Cmd+Shift+V (paste without formatting) gesture. Paste
 * events carry no modifier state, so the layer watches keydowns: the combo
 * arms a short window during which the next paste stays native plain text.
 * @param windowMs - lookback window in milliseconds.
 * @param now - the clock, injectable for tests.
 */
export function plainPasteGestureTracker(
  windowMs: number = PLAIN_PASTE_WINDOW_MS,
  clock: () => number = Date.now,
): PlainPasteGesture {
  let armedAt: number | undefined
  return {
    keydown(event): void {
      if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        armedAt = clock()
      }
    },
    active(now?: number): boolean {
      const at = now ?? clock()
      return armedAt !== undefined && at - armedAt <= windowMs
    },
  }
}

/** Lexical marks its root contenteditable; the host composer editor is one. */
const LEXICAL_ROOT_SELECTOR = '[data-lexical-editor="true"]'

/** Ancestor hops the dock anchor may walk before giving up on the editor. */
const MAX_ANCHOR_HOPS = 8

/**
 * Resolve the composer's editor root from the dock anchor. The anchor
 * renders below the composer card, so the editor root is a descendant of a
 * nearby ancestor: walk up a bounded hop count and take the first ancestor
 * containing a Lexical root. Null means "not found" — the paste layer never
 * guesses past its own subtree.
 * @param anchor - the dock occupant's anchor element, if mounted.
 */
export function composerEditorRoot(anchor: Element | null): Element | null {
  let node = anchor?.parentElement ?? null
  for (let hop = 0; node !== null && hop < MAX_ANCHOR_HOPS; hop += 1) {
    const found = node.querySelector(LEXICAL_ROOT_SELECTOR)
    if (found !== null) return found
    node = node.parentElement
  }
  return null
}

/**
 * Wrap one listener body in the layer's latch-off guard: a latched layer
 * does nothing, and a first throw latches off with the reason — the
 * convention capability.ts documents for every layer's live entry points.
 */
function guardedListener(
  kill: KillSwitch,
  label: string,
  body: (event: Event) => void,
): (event: Event) => void {
  return (event: Event) => {
    if (kill.disabled) return
    try {
      body(event)
    } catch (error) {
      kill.disable(`${label} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * The live paste handler one dock instance installs: resolve the composer
 * editor from the anchor, decide, insert guarded, and only then cancel the
 * event so the host's Lexical paste routing never sees it. Every miss —
 * paste outside the composer, native-decision, refused insertion, latch-off
 * — falls through and the native paste proceeds untouched.
 * @param face - the guarded insertion face (probed by the caller).
 * @param anchorRef - live anchor element holder.
 * @param gesture - the plain-paste gesture tracker.
 * @param kill - the layer's one-way disable latch.
 * @returns the document-level paste listener.
 */
export function pasteListener(
  face: InsertionFace,
  anchorRef: { current: Element | null },
  gesture: PlainPasteGesture,
  kill: KillSwitch,
): (event: Event) => void {
  return guardedListener(kill, 'paste handler', (event) => {
    const root = composerEditorRoot(anchorRef.current)
    if (root === null) return
    const target = event.target
    if (!(target instanceof Element) || !root.contains(target)) return
    const clipboard = readClipboard((event as ClipboardEvent).clipboardData)
    const decision = decideRichPaste(clipboard, gesture.active())
    if (decision.action !== 'convert') return
    // Insert first, cancel after: a refused insertion (machine frozen,
    // revision moved) leaves the event free to run the native paste path.
    if (!insertGuarded(face, decision.markdown)) return
    event.preventDefault()
    event.stopPropagation()
  })
}

/** The keydown listener feeding the plain-paste gesture tracker. */
export function gestureListener(gesture: PlainPasteGesture, kill: KillSwitch): (event: Event) => void {
  return guardedListener(kill, 'gesture tracker', (event) => {
    const e = event as KeyboardEvent
    gesture.keydown({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey })
  })
}
