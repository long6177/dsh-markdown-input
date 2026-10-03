/**
 * The paste decision core (issue #14, ADR-0005 — originally ADR-0003; T6
 * moved the only consumer into the CM6 surface, T7 retired the dock path):
 * a rich-text paste converts to clean Markdown (paste-converter.ts), while
 * plain text, file, and image pastes keep their native behavior. The
 * takeover editor (markdown-editor.ts) feeds this core from its contentDOM
 * paste handler — since T7 it is the one and only paste surface.
 */
import { convertHtmlToMarkdown } from './paste-converter.ts'

/** The clipboard summary the paste decision reads. */
export interface PasteClipboard {
  /** Whether any clipboard item carries a file (images included). */
  readonly hasFiles: boolean
  /** The extractable File objects (empty when the engine hides them). */
  readonly files: readonly File[]
  /** The `text/html` flavor; '' when absent. */
  readonly html: string
  /** The `text/plain` flavor; '' when absent. */
  readonly plain: string
}

/** What the editor does with one paste into the composer. */
export type PasteDecision =
  /** Leave the event alone; CM6's own paste routing applies. */
  | { readonly action: 'native' }
  /** The event is intercepted and `markdown` inserted in one transaction. */
  | { readonly action: 'convert'; readonly markdown: string }

/**
 * Read one paste event's clipboard payload, duck-typed because test engines
 * deliver `clipboardData` in varied shapes (the host keymap makes the same
 * concession). A throwing `getData` reads as an absent flavor. Files read
 * from the FileList flavor first (every real engine pastes files through
 * it), then from the item list — `hasFiles` is true whenever either shows a
 * file, even when the engine hides the extractable File objects.
 * @param data - the event's `clipboardData`, of any shape.
 */
export function readClipboard(data: unknown): PasteClipboard {
  if (typeof data !== 'object' || data === null) {
    return { hasFiles: false, files: [], html: '', plain: '' }
  }
  const transfer = data as DataTransfer
  const read = (type: string): string => {
    try {
      return transfer.getData(type) ?? ''
    } catch {
      return ''
    }
  }
  const html = read('text/html')
  const plain = read('text/plain')
  const direct = transfer.files
  if (direct !== undefined && direct.length > 0) {
    return { hasFiles: true, files: [...direct], html, plain }
  }
  let hasFiles = false
  const files: File[] = []
  const items = transfer.items
  if (items !== undefined) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (item?.kind !== 'file') continue
      hasFiles = true
      // Duck-typed fixtures may omit the extractor; real items carry it.
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null
      if (file !== null) files.push(file)
    }
  }
  return { hasFiles, files, html, plain }
}

/**
 * Decide what the editor does with one paste into the composer. Files and
 * images ride the host intake; the plain-paste gesture and any clipboard
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

/** How long a Ctrl/Cmd+Shift+V keydown arms the plain-paste window. */
export const PLAIN_PASTE_WINDOW_MS = 1000

/** The plain-paste gesture state one composer instance tracks. */
export interface PlainPasteGesture {
  /** Feed one keydown; Ctrl/Cmd+Shift+V arms the window. */
  keydown(event: { key: string, ctrlKey: boolean, metaKey: boolean, shiftKey: boolean }): void
  /** Whether the window is armed (per the tracker's clock). */
  active(): boolean
}

/**
 * Track the Ctrl/Cmd+Shift+V (paste without formatting) gesture. Paste
 * events carry no modifier state, so the editor watches keydowns: the combo
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
    active(): boolean {
      return armedAt !== undefined && clock() - armedAt <= windowMs
    },
  }
}
