/**
 * Obsidian-style live rendering for the composer: markers fold and content
 * takes its styled shape on every line that does not hold the selection;
 * the cursor line (and any selected line) stays raw source. Decorations are
 * derived from the lezer markdown syntax tree, so escaped characters
 * (`\*`) are never folded — the parser hands them to us as `Escape`, not
 * as formatting. Source mode simply omits this extension.
 */
import { syntaxTree } from '@codemirror/language'
import { RangeSet, type EditorState, type Range, type Text } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, WidgetType,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

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

/** Checkbox glyph replacing a folded `[ ]` / `[x]` task marker. */
class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) { super() }

  override eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked
  }

  override toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = this.checked ? 'cm-md-taskbox cm-md-taskbox-checked' : 'cm-md-taskbox'
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  override ignoreEvent(): boolean {
    return true
  }
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
        fold(marks[0]!.from, marks[0]!.to)
        const closing = marks[marks.length - 1]!
        if (closing !== marks[0]) fold(closing.from, closing.to)
        return
      }
      if (name === 'Blockquote') {
        addLineClass(node.from, node.to, 'cm-md-quote')
        return
      }
      if (name === 'QuoteMark') {
        if (!touchesActiveLine(doc, active, node.from, node.from)) {
          fold(node.from, endOfSpaces(doc, node.to))
        }
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
