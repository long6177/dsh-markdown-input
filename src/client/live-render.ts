/**
 * Obsidian-style live rendering for the composer: markers fold and content
 * takes its styled shape on every line that does not hold the selection;
 * the cursor line (and any selected line) stays raw source. Decorations are
 * derived from the lezer markdown syntax tree, so escaped characters
 * (`\*`) are never folded — the parser hands them to us as `Escape`, not
 * as formatting. Widgets ride the folds: the task-list checkbox is clickable
 * and toggles its source marker in place, and a horizontal-rule line folds
 * into a `cm-md-hr` hairline (issue #48); fenced code hides its opening and
 * closing fence lines whole (fence, info string and line break included) and
 * floats a read-only language tag over the block's top-right corner while
 * the cursor is away (issue #47); list markers fold to a bullet dot or a
 * position-computed ordinal with per-level hanging indents (issue #46).
 * Source mode simply omits this extension.
 */
import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { RangeSet, type EditorState, type Range, type Text } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common'

const headingLineClass: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1',
  SetextHeading2: 'cm-md-h2',
}

/**
 * Checkbox glyph replacing a folded `[ ]` / `[x]` task marker. Issue #48:
 * clicking toggles the marker in the source — one transaction, isolated in
 * history so one undo step returns to the pre-click marker. The box stays
 * aria-hidden (keyboard focus/toggling is out of scope for #48; announcing
 * a button with no keyboard path would be a false affordance), and the
 * geometry lives in the render-mode CSS contract, unchanged by this issue.
 */
class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) { super() }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked
  }

  override toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span')
    span.className = this.checked ? 'cm-md-taskbox cm-md-taskbox-checked' : 'cm-md-taskbox'
    span.setAttribute('aria-hidden', 'true')
    span.addEventListener('mousedown', (event) => {
      // mousedown, not click: the browser's default caret placement (and the
      // selection churn that would retire the widget mid-gesture) must not
      // run before the toggle lands. preventDefault stops that default;
      // ignoreEvent (below) keeps the editor's own mouse handling away.
      event.preventDefault()
      // A read-only surface never edits (the takeover's sending face shows
      // the draft without offering mutations).
      if (view.state.readOnly) return
      // Position is looked back up at click time (pos 回查), never cached —
      // so the widget stays eq-comparable on `checked` alone and a reused DOM
      // can never dispatch at a stale marker. The marker is the three source
      // characters the widget replaces; anything else at that spot is not a
      // task marker and the click fails open (no dispatch).
      const from = view.posAtDOM(span)
      const marker = view.state.doc.sliceString(from, from + 3)
      if (!/^\[[xX ]\]$/u.test(marker)) return
      const checked = marker.toLowerCase() === '[x]'
      view.dispatch({
        changes: { from, to: from + 3, insert: checked ? '[ ]' : '[x]' },
        // One click, one undo step: a toggle never merges with adjacent
        // typing or a fast second toggle into one history entry.
        annotations: isolateHistory.of('full'),
      })
    })
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Read-only language tag floating at a folded code block's top-right corner
 * (#47): pure display — no pointer interaction, no selection, positioned by
 * CSS against the line carrying `cm-md-codelang-line`.
 */
export class CodeLangWidget extends WidgetType {
  constructor(readonly lang: string) { super() }

  override eq(other: CodeLangWidget): boolean {
    return other.lang === this.lang
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-codelang'
    span.textContent = this.lang
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/**
 * Bullet dot or computed ordinal replacing a folded list marker (issue #46).
 * The three unordered markers (`-` `*` `+`) share one dot shape; ordered
 * markers show the position-computed number with the item's own `.`/`)`
 * suffix. Same replace-widget shape as the task checkbox: read-only, not
 * an input.
 */
class ListMarkerWidget extends WidgetType {
  constructor(private readonly label: string) { super() }

  override eq(other: ListMarkerWidget): boolean {
    return other.label === this.label
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-listmark'
    span.textContent = this.label
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
}

/** First whitespace-separated word of a fence info string ('' when absent). */
function firstInfoWord(info: string): string {
  return info.trim().split(/\s+/u, 1)[0] ?? ''
}

/** Depth cap for the per-level hanging-indent classes; deeper rows reuse it. */
const MAX_LIST_DEPTH = 6

/**
 * Nesting level of the row `item` belongs to: the count of list ancestors
 * between the item and the document root (its own list included), capped at
 * MAX_LIST_DEPTH. A top-level item's only list ancestor is its own list, so
 * top-level rows read depth 1. Drives the hanging-indent padding class
 * (`cm-md-li-dN`).
 */
function listDepthOf(item: SyntaxNode): number {
  let depth = 0
  for (let cur = item.parent; cur !== null; cur = cur.parent) {
    if (cur.name === 'BulletList' || cur.name === 'OrderedList') depth++
  }
  return Math.min(depth, MAX_LIST_DEPTH)
}

/**
 * 0-based position of `item` among `list`'s own ListItem children, by
 * position — node wrappers are created fresh per query, so identity never
 * holds between `mark.parent` and the sibling walk.
 */
function listItemIndex(list: SyntaxNode, item: SyntaxNode): number {
  let index = 0
  for (let child = list.firstChild; child !== null && child.from < item.from; child = child.nextSibling) {
    if (child.name === 'ListItem') index++
  }
  return index
}

/**
 * Lines that must stay raw: every line a selection range touches.
 * @param state - editor state to read the selection from.
 */
export function activeLinesOf(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) lines.add(n)
  }
  return lines
}

/** Whether any line the [from, to) range touches is selection-active. */
function touchesActiveLine(doc: Text, active: ReadonlySet<number>, from: number, to: number): boolean {
  const last = doc.lineAt(to).number
  for (let n = doc.lineAt(from).number; n <= last; n++) {
    if (active.has(n)) return true
  }
  return false
}

/** End of the run of plain spaces starting at `to` (folds `## ` whole). */
function endOfSpaces(doc: Text, to: number): number {
  let end = to
  while (end < doc.length && doc.sliceString(end, end + 1) === ' ') end++
  return end
}

const hide = Decoration.replace({})

/** Block replacement hiding a whole line: swallows the line break after it,
 * so the line disappears entirely — except a document-final line, which has
 * no break to swallow and folds to end-of-line, leaving one blank line. */
const hideLine = Decoration.replace({ block: true })

/**
 * Build the render-mode decoration set for the whole document. Pure over
 * (state, active lines): testable at the EditorState seam, mounted by the
 * view plugin below. Unknown node shapes stay raw (fail-open), so upstream
 * parser changes degrade to source view instead of corrupting display.
 * @param state - editor state whose syntax tree drives the decorations.
 * @param active - line numbers that must keep their markers visible.
 * @returns decorations folding markers outside the active lines.
 */
export function buildRenderDecorations(state: EditorState, active: ReadonlySet<number>): DecorationSet {
  const doc = state.doc
  const ranges: Range<Decoration>[] = []
  const lineClasses = new Map<number, Set<string>>()
  // Per-line end of a folded quote mark: the list branch clamps its own
  // fold prefix to it, so a `- ` widget on a quoted line never overlaps the
  // quote fold already covering `> `.
  const quoteFoldEnds = new Map<number, number>()

  const addLineClass = (from: number, to: number, className: string): void => {
    const last = doc.lineAt(to).number
    for (let n = doc.lineAt(from).number; n <= last; n++) {
      const set = lineClasses.get(n) ?? new Set<string>()
      set.add(className)
      lineClasses.set(n, set)
    }
  }

  const fold = (from: number, to: number): void => {
    if (to > from) ranges.push(hide.range(from, to))
  }

  /** Hide the whole line holding `pos`, line break included when one follows. */
  const foldLine = (pos: number): void => {
    const line = doc.lineAt(pos)
    const to = line.to < doc.length ? line.to + 1 : line.to
    if (to > line.from) ranges.push(hideLine.range(line.from, to))
  }

  /** Fold two emphasis-style marks and style the content between them. */
  const foldPair = (node: SyntaxNodeRef, markName: string, className: string): void => {
    const syntax = node.node
    if (syntax === null) return
    const marks = syntax.getChildren(markName)
    if (marks.length !== 2) return
    if (touchesActiveLine(doc, active, syntax.from, syntax.to)) return
    fold(marks[0]!.from, marks[0]!.to)
    fold(marks[1]!.from, marks[1]!.to)
    if (marks[1]!.from > marks[0]!.to) {
      ranges.push(Decoration.mark({ class: className }).range(marks[0]!.to, marks[1]!.from))
    }
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      const name = node.name
      if (Object.hasOwn(headingLineClass, name)) {
        addLineClass(node.from, node.to, headingLineClass[name]!)
        if (name.startsWith('ATXHeading')) {
          const mark = node.node?.getChild('HeaderMark')
          if (mark != null && !touchesActiveLine(doc, active, node.from, node.to)) {
            fold(mark.from, endOfSpaces(doc, mark.to))
          }
        }
        return
      }
      if (name === 'StrongEmphasis') return foldPair(node, 'EmphasisMark', 'cm-md-strong')
      if (name === 'Emphasis') return foldPair(node, 'EmphasisMark', 'cm-md-em')
      if (name === 'InlineCode') return foldPair(node, 'CodeMark', 'cm-md-code')
      if (name === 'Strikethrough') return foldPair(node, 'StrikethroughMark', 'cm-md-strike')
      if (name === 'Link') {
        const syntax = node.node
        const marks = syntax?.getChildren('LinkMark') ?? []
        // `[`, `]`, `(`, URL, `)` — reference-style links have no URL child
        // and stay raw.
        if (syntax === null || marks.length < 3 || syntax.getChild('URL') === null) return
        if (touchesActiveLine(doc, active, syntax.from, syntax.to)) return
        fold(marks[0]!.from, marks[0]!.to)
        fold(marks[1]!.from, syntax.to)
        if (marks[1]!.from > marks[0]!.to) {
          ranges.push(Decoration.mark({ class: 'cm-md-link' }).range(marks[0]!.to, marks[1]!.from))
        }
        return
      }
      if (name === 'FencedCode') {
        addLineClass(node.from, node.to, 'cm-md-codeblock')
        if (touchesActiveLine(doc, active, node.from, node.to)) return
        const marks = node.node?.getChildren('CodeMark') ?? []
        if (marks.length === 0) return
        // Whole-line folds (#47): the opening fence line (fence + info
        // string) and, for a closed block, the closing fence line each hide
        // entire — break included — so the block visually starts at its
        // first code line and ends at its last. A document-final fence has
        // no break to swallow and folds to end-of-line, leaving one blank
        // line (accepted by the issue).
        const closing = marks[marks.length - 1]!
        const closeLine = closing !== marks[0] ? doc.lineAt(closing.to) : null
        foldLine(node.from)
        if (closeLine !== null) foldLine(closeLine.to)
        // Language tag (#47): floats over the block's top-right corner while
        // the fences are folded. Rendered only when a content line exists
        // between the fences to carry it (an empty block — adjacent fences —
        // folds away whole and gets nothing) and the info string names a
        // language; the tag shows the info string's first word, additional
        // parameters ride the hidden line.
        const contentStart = doc.lineAt(node.from).number + 1
        const contentEnd = closeLine === null ? doc.lines : closeLine.number - 1
        if (contentStart <= contentEnd) {
          const info = node.node?.getChild('CodeInfo')
          const lang = info === null || info === undefined
            ? ''
            : firstInfoWord(doc.sliceString(info.from, info.to))
          if (lang !== '') {
            const first = doc.line(contentStart)
            ranges.push(Decoration.widget({ widget: new CodeLangWidget(lang) }).range(first.from))
            addLineClass(first.from, first.to, 'cm-md-codelang-line')
          }
        }
        return
      }
      if (name === 'Blockquote') {
        addLineClass(node.from, node.to, 'cm-md-quote')
        return
      }
      if (name === 'QuoteMark') {
        const end = endOfSpaces(doc, node.to)
        quoteFoldEnds.set(doc.lineAt(node.from).number, end)
        if (!touchesActiveLine(doc, active, node.from, node.from)) {
          fold(node.from, end)
        }
        return
      }
      if (name === 'ListMark') {
        const mark = node.node
        const item = mark?.parent ?? null
        const list = item?.parent ?? null
        if (item === null || list === null || (list.name !== 'BulletList' && list.name !== 'OrderedList')) return
        const line = doc.lineAt(node.from)
        const ordered = list.name === 'OrderedList'
        // The row classes carry the hanging indent (see the CSS face); they
        // stay on the active line like the heading classes do — only the
        // fold yields to the cursor.
        addLineClass(line.from, line.to, `cm-md-listitem cm-md-li-d${listDepthOf(item)} ${ordered ? 'cm-md-li-ordered' : 'cm-md-li-bullet'}`)
        if (active.has(line.number)) return
        let label = '•'
        if (ordered) {
          const suffix = doc.sliceString(node.from, node.to).endsWith(')') ? ')' : '.'
          label = `${listItemIndex(list, item) + 1}${suffix}`
        }
        // The widget opens the line: the item's own indent spaces fold
        // together with the marker so the hanging-indent padding sees one
        // constant column. A quote mark folded earlier on this line bounds
        // how far the prefix reaches (never overlapping that fold).
        let from = node.from
        while (from > line.from && doc.sliceString(from - 1, from) === ' ') from--
        const quoted = quoteFoldEnds.get(line.number)
        if (quoted !== undefined && from < quoted) from = quoted
        ranges.push(Decoration.replace({ widget: new ListMarkerWidget(label) }).range(from, endOfSpaces(doc, node.to)))
        return
      }
      if (name === 'HorizontalRule') {
        // Issue #48: the whole rule folds into a hairline drawn by the
        // `cm-md-hr` line class. The class rides the fold — on the active
        // line the raw marker shows and the hairline must not paint behind
        // it (unlike the heading classes, which style the raw text itself).
        if (touchesActiveLine(doc, active, node.from, node.to)) return
        fold(node.from, node.to)
        addLineClass(node.from, node.to, 'cm-md-hr')
        return
      }
      if (name === 'Task') {
        const marker = node.node?.getChild('TaskMarker')
        if (marker == null) return
        if (touchesActiveLine(doc, active, marker.from, marker.to)) return
        const checked = doc.sliceString(marker.from, marker.to).trim().toLowerCase() === '[x]'
        ranges.push(Decoration.replace({
          widget: new TaskCheckboxWidget(checked),
        }).range(marker.from, marker.to))
        return
      }
    },
  })

  for (const [line, classes] of lineClasses) {
    const pos = doc.line(line).from
    ranges.push(Decoration.line({ class: [...classes].sort().join(' ') }).range(pos, pos))
  }

  return RangeSet.of(ranges, true)
}

/** View plugin mounting the decorations; rebuilt on doc/selection changes. */
export const liveRender = ViewPlugin.fromClass(class {
  decorations: DecorationSet

  constructor(view: EditorView) {
    this.decorations = buildRenderDecorations(view.state, activeLinesOf(view.state))
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) {
      this.decorations = buildRenderDecorations(update.view.state, activeLinesOf(update.view.state))
    }
  }
}, {
  decorations: plugin => plugin.decorations,
})
