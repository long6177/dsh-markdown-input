/**
 * L1 paint layer (issue #15, ADR-0003): paint-only Markdown rendering over
 * the native composer text face. The engine reads the editor's text nodes,
 * parses the inline four with inline-syntax.ts, and paints the result with
 * the CSS Custom Highlight API — syntax markers dimmed, content colored.
 * Zero DOM modification: ranges and highlight registrations only, so the
 * host editor's IME, undo, and caret behavior are untouched and the sent
 * text stays the raw Markdown source.
 *
 * Every entry point consults the capability probe and the one-way kill
 * switch (capability.ts): unsupported browsers and mid-life failures —
 * including the editor root leaving the DOM — degrade that engine run to
 * the native composer until its dock occupant remounts, and never break
 * the composer itself.
 */
import { probe, killSwitch, type Capability, type KillSwitch } from './capability.ts'
import { parseInlineMarks, type InlineMark, type InlineMarkType, type TextRange } from './inline-syntax.ts'

/**
 * Probe the CSS Custom Highlight API surface the paint layer draws with
 * (`Highlight` + `CSS.highlights`). Unsupported browsers get the native
 * composer, not a broken one.
 */
export function paintCapability(): Capability {
  return probe(
    () => typeof globalThis.Highlight === 'function'
      && typeof CSS !== 'undefined'
      && 'highlights' in CSS,
    'CSS Custom Highlight API unavailable',
  )
}

/** Highlight names the engine owns in `CSS.highlights`. */
export const PAINT_HIGHLIGHT_NAMES = {
  /** Every syntax marker, dimmed. */
  mark: 'markdown-input-mark',
  bold: 'markdown-input-bold',
  italic: 'markdown-input-italic',
  code: 'markdown-input-code',
  strike: 'markdown-input-strike',
} as const

/** `data-plugin-css` tag id of the paint layer's injected stylesheet. */
export const PAINT_STYLE_ID = 'dsh-markdown-input/paint-layer.css'

/**
 * The paint styles. `::highlight()` accepts only paint-level properties —
 * no font size, weight, or layout (ADR-0003 caps the visuals at syntax
 * highlighting) — so bold is a text-shadow thicken, strike is real
 * line-through, and colors mix over `currentColor` to track the host theme.
 */
const PAINT_LAYER_CSS = [
  `::highlight(${PAINT_HIGHLIGHT_NAMES.mark}){color:color-mix(in srgb,currentColor 45%,transparent)}`,
  `::highlight(${PAINT_HIGHLIGHT_NAMES.bold}){text-shadow:0 0 .6px currentColor}`,
  `::highlight(${PAINT_HIGHLIGHT_NAMES.italic}){color:color-mix(in srgb,currentColor 82%,#d946ef)}`,
  `::highlight(${PAINT_HIGHLIGHT_NAMES.code}){color:color-mix(in srgb,currentColor 85%,#f59e0b);background-color:color-mix(in srgb,currentColor 12%,transparent)}`,
  `::highlight(${PAINT_HIGHLIGHT_NAMES.strike}){text-decoration:line-through;color:color-mix(in srgb,currentColor 60%,transparent)}`,
].join('')

/**
 * The slice of `CSS.highlights` the engine drives. A structural mirror,
 * not an import: the registry reaches this layer as an unknown-shaped
 * global, and a host that dropped it must read as unsupported.
 */
export interface PaintRegistry {
  set(name: string, highlight: unknown): unknown
  delete(name: string): unknown
}

/** The stylesheet tag the engine injected, if it created one this life. */
function injectPaintStyles(doc: Document): HTMLStyleElement | null {
  if (doc.head.querySelector(`style[data-plugin-css="${PAINT_STYLE_ID}"]`) !== null) return null
  const tag = doc.createElement('style')
  tag.dataset.pluginCss = PAINT_STYLE_ID
  tag.textContent = PAINT_LAYER_CSS
  doc.head.appendChild(tag)
  return tag
}

/** A text node's slice of the flat draft text, as absolute offsets. */
export interface PaintSegment {
  readonly node: Text
  readonly start: number
  readonly end: number
}

/** The editor's text content flattened for parsing, with the map back. */
export interface PaintText {
  /** Block texts joined by `\n`, matching the draft's logical lines. */
  readonly text: string
  readonly segments: readonly PaintSegment[]
}

/**
 * Flatten the editor's text into one parseable string. Each direct child
 * of the Lexical root is a block (a paragraph); every block boundary adds
 * one `\n` — including empty blocks (`<p><br></p>`) and a leading one —
 * so markers can never pair across a boundary. Text nodes keep document
 * order.
 * @param root - the composer editor root.
 */
export function collectPaintText(root: Element): PaintText {
  let text = ''
  const segments: PaintSegment[] = []
  const children = Array.from(root.childNodes)
  for (let index = 0; index < children.length; index += 1) {
    if (index > 0) text += '\n'
    const walker = (root.ownerDocument ?? document).createTreeWalker(children[index]!, NodeFilter.SHOW_TEXT)
    for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
      const node = current as Text
      if (node.data.length === 0) continue
      segments.push({ node, start: text.length, end: text.length + node.data.length })
      text += node.data
    }
  }
  return { text, segments }
}

/** Map a flat-text range onto DOM ranges, one per intersecting text node. */
function domRanges(range: TextRange, paint: PaintText, doc: Document): Range[] {
  const ranges: Range[] = []
  for (const segment of paint.segments) {
    if (segment.end <= range.start || segment.start >= range.end) continue
    const dom = doc.createRange()
    dom.setStart(segment.node, Math.max(range.start, segment.start) - segment.start)
    dom.setEnd(segment.node, Math.min(range.end, segment.end) - segment.start)
    ranges.push(dom)
  }
  return ranges
}

/** The `Highlight` constructor of unknown shape (shimmed in tests). */
type HighlightCtor = new (...ranges: Range[]) => unknown

/**
 * Paint one parse frame: marker ranges dim into the shared mark highlight,
 * content ranges color into their type's highlight. All names are set
 * every frame — an empty highlight clears stale ranges from the previous
 * draft, so nothing survives a deletion.
 * @param marks - the parsed inline marks of the current draft text.
 * @param paint - the flat text and node map the marks refer to.
 * @param registry - the highlight registry to write.
 * @param doc - document to create ranges in.
 */
export function paintMarks(
  marks: readonly InlineMark[],
  paint: PaintText,
  registry: PaintRegistry,
  doc: Document,
): void {
  const markerRanges: Range[] = []
  const contentRanges: Record<InlineMarkType, Range[]> = {
    bold: [], italic: [], code: [], strike: [],
  }
  for (const mark of marks) {
    for (const marker of mark.markers) markerRanges.push(...domRanges(marker, paint, doc))
    contentRanges[mark.type].push(...domRanges(mark.content, paint, doc))
  }
  const Highlight = globalThis.Highlight as unknown as HighlightCtor
  registry.set(PAINT_HIGHLIGHT_NAMES.mark, new Highlight(...markerRanges))
  registry.set(PAINT_HIGHLIGHT_NAMES.bold, new Highlight(...contentRanges.bold))
  registry.set(PAINT_HIGHLIGHT_NAMES.italic, new Highlight(...contentRanges.italic))
  registry.set(PAINT_HIGHLIGHT_NAMES.code, new Highlight(...contentRanges.code))
  registry.set(PAINT_HIGHLIGHT_NAMES.strike, new Highlight(...contentRanges.strike))
}

/** Remove every highlight name the engine owns. */
function clearPaint(registry: PaintRegistry): void {
  for (const name of Object.values(PAINT_HIGHLIGHT_NAMES)) registry.delete(name)
}

function cssHighlightRegistry(): PaintRegistry | undefined {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return undefined
  return (CSS as unknown as { highlights: PaintRegistry }).highlights
}

/** A running paint engine. */
export interface PaintHandle {
  /** Idempotent teardown: stop observing and clear every highlight. */
  stop(): void
}

/** Lifecycle options; tests inject the registry and document. */
export interface PaintEngineOptions {
  /** Defaults to `CSS.highlights`. */
  readonly registry?: PaintRegistry
  /** Defaults to the root's owner document. */
  readonly doc?: Document
}

/**
 * Run the paint layer against one composer editor root. The first frame
 * paints synchronously; edits repaint through a MutationObserver, coalesced
 * per microtask. A latched-off or stopped engine leaves the composer
 * exactly as the host rendered it.
 * @param root - the composer editor root (Lexical contenteditable).
 * @param options - registry and document overrides.
 */
export function attachPaintLayer(root: Element, options: PaintEngineOptions = {}): PaintHandle {
  const doc = options.doc ?? root.ownerDocument ?? document
  const Highlight = globalThis.Highlight
  const registry = options.registry ?? cssHighlightRegistry()
  // No Highlight class or no registry to paint into: stay inert — probing
  // must be the safest thing the layer does.
  if (typeof Highlight !== 'function' || registry === undefined) {
    return { stop(): void {} }
  }
  const kill: KillSwitch = killSwitch()
  const style = injectPaintStyles(doc)
  let scheduled = false
  const paint = (): void => {
    if (kill.disabled) return
    try {
      if (!root.isConnected) {
        // Host structure change: the editor is gone — the layer disables
        // itself wholesale instead of painting into a stale tree.
        kill.disable('composer editor left the DOM')
        shutdown()
        return
      }
      const paintText = collectPaintText(root)
      paintMarks(parseInlineMarks(paintText.text), paintText, registry, doc)
    } catch (error: unknown) {
      kill.disable(`paint failed: ${error instanceof Error ? error.message : String(error)}`)
      try {
        clearPaint(registry)
      } catch {
        // Best effort: the latch already guarantees no further frames.
      }
    }
  }
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      paint()
    })
  }
  const observer = new MutationObserver(schedule)
  // Structure guard: the editor leaving the DOM — at any ancestor depth —
  // is a childList change above the root, which the root's own observer
  // never reports. The tripwire costs one `isConnected` read per page
  // mutation; churn that leaves the root connected does nothing.
  const structureObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      kill.disable('composer editor left the DOM')
      shutdown()
    }
  })
  structureObserver.observe(doc, { childList: true, subtree: true })
  const shutdown = (): void => {
    observer.disconnect()
    structureObserver.disconnect()
    try {
      clearPaint(registry)
    } catch {
      // The latch guarantees no further frames either way.
    }
    style?.remove()
  }
  observer.observe(root, { childList: true, characterData: true, subtree: true })
  paint()
  return {
    stop(): void {
      kill.disable('stopped')
      shutdown()
    },
  }
}
