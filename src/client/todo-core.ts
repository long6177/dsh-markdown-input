/**
 * The todo panel's pure view model (issue #38): when the takeover card shows
 * the checklist the native composer keeps in its `conversation.input.dock`
 * (TodoDock, order 0 — the first dock seat, ahead of the goal strip's order
 * 10 and the queue strip's order 20), and what its header and rows read.
 * The math is copied from the native TodoPanel/TodoDock
 * (`ui-conversation` skeleton): the projection value is the whole latest
 * `todo/write` list or `null` before the first write, an empty list renders
 * nothing, every non-zero status segment joins into one progress line, and
 * the `StateDot` language maps `completed`/`in_progress`/`pending` onto
 * done/ongoing/idle.
 *
 * Host wire shapes are consumed through narrow structural types (the
 * conversation-face convention — the same reason `plan-core` restates its
 * key): the `todos` key is declared by `@deepseek-ai/dsh-tool-todo`, which is
 * NOT in this build's dependency graph, so the keyed hook is widened at the
 * call site and every field is re-validated here. A missing or foreign field
 * reads as the item's absence, never as a trusted value.
 */

/** The `StateDot` semantic one todo status renders as (host `StateDotState`). */
export type TodoDotState = 'done' | 'ongoing' | 'idle'

/**
 * One checklist entry: what the row shows and how its dot reads.
 * Deliberately the native `TodoItem` shape — `content` plus the closed
 * three-state lifecycle. The list is replaced wholesale on every write, so
 * entries carry no identity beyond their content (the native row key).
 */
export interface TodoItemView {
  /** Human-readable imperative line shown as the row's text. */
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
}

/**
 * One header progress segment: a count resolution plus the host copy key it
 * renders through. Zero-count segments are dropped before they get here (the
 * native `progressLabel`), so the face can render every segment it receives.
 */
export interface TodoProgressSegment {
  /** Host `conversation` dictionary key (`todo.progress.done|active|pending`). */
  readonly key: 'todo.progress.done' | 'todo.progress.active' | 'todo.progress.pending'
  /** How many items the segment counts; always ≥ 1. */
  readonly count: number
}

/**
 * The native separator: en spaces (U+2002) around a middle dot. HTML
 * collapses runs of ASCII spaces, so widening the separator's breathing room
 * needs a literal wide space.
 */
export const TODO_PROGRESS_SEPARATOR = '\u2002·\u2002'

/** The three lifecycle values, in the order the wire may carry them. */
const TODO_STATUSES: readonly TodoItemView['status'][] = ['pending', 'in_progress', 'completed']

/** Type guard over one raw status field (the closed union, re-validated). */
function isTodoStatus(value: unknown): value is TodoItemView['status'] {
  return (TODO_STATUSES as readonly unknown[]).includes(value)
}

/**
 * Structural read of one `todos` projection frame: wire data despite its
 * typed face — a missing or foreign field reads as the key's absence
 * (capability absence is the key's absence, never a value), and a
 * well-shaped non-array frame (the pre-first-write `null` included) reads as
 * no list rather than a crash.
 * @param value - the raw projection value.
 * @returns the validated items, or undefined when the key carries no list.
 */
export function todoItemsOf(value: unknown): readonly TodoItemView[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: TodoItemView[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') return undefined
    const item = raw as { readonly content?: unknown; readonly status?: unknown }
    if (typeof item.content !== 'string' || !isTodoStatus(item.status)) return undefined
    items.push({ content: item.content, status: item.status })
  }
  return items
}

/**
 * Native panel visibility: only a present, non-empty list has a panel. The
 * absent key (loading, or todo support not composed on the host) and the
 * pre-first-write `null` read hidden — and an empty list reads hidden too,
 * because the native TodoPanel returns null for it.
 * @param todos - the validated list, undefined when the key is absent.
 */
export function todoPanelVisible(todos: readonly TodoItemView[] | undefined): boolean {
  return todos !== undefined && todos.length > 0
}

/**
 * The status segments of the header's progress line, in the native
 * `done`/`active`/`pending` order. `pending` is the remainder — items whose
 * status is neither `completed` nor `in_progress` — and a segment with a zero
 * count is omitted as noise (a non-empty list keeps at least one).
 * @param todos - the validated list, already known non-empty for a header.
 */
export function todoProgressSegments(todos: readonly TodoItemView[]): readonly TodoProgressSegment[] {
  const done = todos.filter((item) => item.status === 'completed').length
  const active = todos.filter((item) => item.status === 'in_progress').length
  const pending = todos.length - done - active
  return [
    ...done > 0 ? [{ key: 'todo.progress.done', count: done } as const] : [],
    ...active > 0 ? [{ key: 'todo.progress.active', count: active } as const] : [],
    ...pending > 0 ? [{ key: 'todo.progress.pending', count: pending } as const] : [],
  ]
}

/**
 * Join the translated progress segments into the native one-line header
 * label. The copy arrives already interpolated (the `t` seat's business),
 * so this is pure joining: segments in order, separated by the en-space
 * middle dot.
 * @param segments - the non-zero segments, in native order.
 * @param label - renders one segment's copy through the locale seat.
 */
export function todoProgressLabel(
  segments: readonly TodoProgressSegment[],
  label: (segment: TodoProgressSegment) => string,
): string {
  return segments.map(label).join(TODO_PROGRESS_SEPARATOR)
}

/**
 * Map one todo lifecycle state onto the shared `StateDot` language, copied
 * from the native panel.
 * @param status - the entry's status.
 */
export function todoDotState(status: TodoItemView['status']): TodoDotState {
  switch (status) {
    case 'completed': return 'done'
    case 'in_progress': return 'ongoing'
    case 'pending': return 'idle'
  }
}
