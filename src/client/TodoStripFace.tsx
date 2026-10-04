/**
 * The takeover card's todo panel face (issue #38): the card's rebuild of the
 * native TodoDock (`ui-conversation` skeleton, the `conversation.input.dock`
 * order-0 seat — the dock strip renders inside the composer chain's fallback
 * bar, which the takeover hides whole, so the card rebuilds it above its goal
 * strip, the native dock order 0 < 10 < 20). A present, non-empty todo list
 * shows the checklist glyph, the title, the per-status progress line, and the
 * collapse chevron; expanding lists every entry as a status dot plus its
 * content. `null` (pre-first-write), an absent key (loading, or todo support
 * not composed on the host), and the empty list render nothing — the
 * projection being absent hides the whole face, never a dead seat. The
 * collapse state is local component state, exactly like the native panel.
 * Mounts inside its FaceGate — a render exception latches this face off
 * alone, never the card.
 */
import { useState, type ReactNode } from 'react'
import {
  IconChecklistOutlineMedium, IconChevronDownOutlineMedium, IconChevronUpOutlineMedium, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaceDefinition } from './face.ts'
import { NS } from './locales.ts'
import {
  todoDotState, todoItemsOf, todoPanelVisible, todoProgressLabel,
  todoProgressSegments, type TodoItemView, type TodoProgressSegment,
} from './todo-core.ts'
import css from './MarkdownComposer.module.css'

/** Face id of the todo panel in the face framework (the host seat is the input dock's `todo` entry). */
export const TODO_STRIP_FACE_ID = 'strip.todo'

/**
 * The FaceGate definition of the todo panel: the projection hook is the
 * panel's one hard dependency — everything else the face needs is local
 * state, so a probe miss (a host that renamed the hook away) hides this face
 * alone, never the card.
 * @param useProjection - the session projection hook as the chain delivers it.
 */
export function todoStripFaceDefinition(useProjection: unknown): FaceDefinition {
  return {
    id: TODO_STRIP_FACE_ID,
    probe: () => typeof useProjection === 'function',
  }
}

type TodoCopy = PropsLocale<typeof NS>['t']

/** The localized status announcement each decorative dot carries (the native `statusLabel`). */
function statusLabel(status: TodoItemView['status'], t: TodoCopy): string {
  switch (status) {
    case 'completed': return t('todo.status.completed')
    case 'in_progress': return t('todo.status.inProgress')
    case 'pending': return t('todo.status.pending')
  }
}

/**
 * Interpolate one progress segment through the locale seat: the segment
 * carries its host copy key and the count, the copy's own placeholder name is
 * the last path segment (native `{done}` / `{active}` / `{pending}`).
 */
function segmentLabel(segment: TodoProgressSegment, t: TodoCopy): string {
  const name = segment.key.slice(segment.key.lastIndexOf('.') + 1)
  return t(segment.key, { [name]: `${segment.count}` })
}

/** Props of the todo panel as the composer chain delivers them. */
export interface TodoStripFaceProps {
  /**
   * Session projection reader; the `todos` key carries the whole latest
   * `todo/write` list. The reader answers the raw wire value — the panel
   * normalizes it structurally (the key's declaration lives outside this
   * build's dependency graph, so the card widens the keyed hook to deliver
   * here).
   */
  readonly useProjection: (key: 'todos') => unknown
  readonly t: TodoCopy
}

/**
 * The in-card todo panel, or null without a list.
 * @param props - projection reader and copy.
 * @returns the panel, or nothing while loading, unset, or empty.
 */
export function TodoStripFace({ useProjection, t }: TodoStripFaceProps): ReactNode {
  // Native parity: the checklist starts collapsed and the header carries the
  // progress line either way.
  const [collapsed, setCollapsed] = useState(true)
  const todos = todoItemsOf(useProjection('todos'))

  if (!todoPanelVisible(todos) || todos === undefined) return null

  const progress = todoProgressLabel(todoProgressSegments(todos), (segment) => segmentLabel(segment, t))

  return (
    <div className={css.todo} data-markdown-todo>
      <button
        type="button"
        className={css.todoHeader}
        aria-expanded={!collapsed}
        onClick={() => { setCollapsed((value) => !value) }}
      >
        <span className={css.todoLead} aria-hidden><IconChecklistOutlineMedium size={14} /></span>
        <span className={css.todoTitle}>{t('todo.title')}</span>
        <span className={css.todoProgress}>{progress}</span>
        <span className={css.todoChevron} aria-hidden>
          {collapsed ? <IconChevronUpOutlineMedium size={14} /> : <IconChevronDownOutlineMedium size={14} />}
        </span>
      </button>
      {!collapsed && (
        <ul className={css.todoList} data-markdown-todo-list>
          {todos.map((item) => (
            <li key={item.content} className={css.todoItem} data-status={item.status}>
              <span className={css.todoGlyph} role="img" aria-label={statusLabel(item.status, t)}>
                <StateDot state={todoDotState(item.status)} />
              </span>
              <span className={css.todoContent}>{item.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
