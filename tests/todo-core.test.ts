/**
 * Seam: the todo panel's pure view model (issue #38). Visibility, the
 * structural projection read, and the header's progress segments are copied
 * from the native TodoPanel/TodoDock (`ui-conversation` skeleton): the
 * `todos` key carries the whole latest list or `null` before the first write,
 * an empty list and an absent key render nothing, and the per-status counts
 * join into one line with zero-count segments omitted.
 */
import { describe, expect, it } from 'vitest'
import {
  TODO_PROGRESS_SEPARATOR, todoDotState, todoItemsOf, todoPanelVisible,
  todoProgressLabel, todoProgressSegments, type TodoItemView,
} from '../src/client/todo-core.ts'

const ITEMS: readonly TodoItemView[] = [
  { content: 'read the host', status: 'completed' },
  { content: 'rebuild the panel', status: 'in_progress' },
  { content: 'ship it', status: 'pending' },
  { content: 'write the retro', status: 'pending' },
]

describe('todoItemsOf', () => {
  it('reads a well-shaped wire list structurally', () => {
    expect(todoItemsOf([{ content: 'a', status: 'pending' }]))
      .toEqual([{ content: 'a', status: 'pending' }])
  })

  it('reads the pre-first-write null and any non-array as the key being absent', () => {
    expect(todoItemsOf(null)).toBeUndefined()
    expect(todoItemsOf(undefined)).toBeUndefined()
    expect(todoItemsOf({})).toBeUndefined()
    expect(todoItemsOf('todos')).toBeUndefined()
  })

  it('rejects a foreign entry rather than trusting it', () => {
    expect(todoItemsOf([{ content: 'a', status: 'someday' }])).toBeUndefined()
    expect(todoItemsOf([{ content: 3, status: 'pending' }])).toBeUndefined()
    expect(todoItemsOf([null])).toBeUndefined()
    expect(todoItemsOf(['a'])).toBeUndefined()
  })

  it('keeps an empty list as an empty list — present, but nothing to show', () => {
    expect(todoItemsOf([])).toEqual([])
  })
})

describe('todoPanelVisible', () => {
  it('hides while the key is absent (loading, or todo support not composed)', () => {
    expect(todoPanelVisible(undefined)).toBe(false)
  })

  it('hides an empty list', () => {
    expect(todoPanelVisible([])).toBe(false)
  })

  it('shows a non-empty list', () => {
    expect(todoPanelVisible(ITEMS)).toBe(true)
  })
})

describe('todoProgressSegments', () => {
  it('counts done, active, and the pending remainder in native order', () => {
    expect(todoProgressSegments(ITEMS)).toEqual([
      { key: 'todo.progress.done', count: 1 },
      { key: 'todo.progress.active', count: 1 },
      { key: 'todo.progress.pending', count: 2 },
    ])
  })

  it('drops zero-count segments (a non-empty list keeps at least one)', () => {
    expect(todoProgressSegments([{ content: 'a', status: 'pending' }]))
      .toEqual([{ key: 'todo.progress.pending', count: 1 }])
    expect(todoProgressSegments([{ content: 'a', status: 'completed' }]))
      .toEqual([{ key: 'todo.progress.done', count: 1 }])
  })

  it('counts every in-progress entry (parallel work is allowed on the wire)', () => {
    expect(todoProgressSegments([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ])).toEqual([{ key: 'todo.progress.active', count: 2 }])
  })
})

describe('todoProgressLabel', () => {
  it('joins the translated segments with the native en-space middle dot', () => {
    const label = todoProgressLabel(todoProgressSegments(ITEMS), (segment) => `${segment.count} ${segment.key}`)
    expect(label).toBe(
      `1 todo.progress.done${TODO_PROGRESS_SEPARATOR}1 todo.progress.active`
      + `${TODO_PROGRESS_SEPARATOR}2 todo.progress.pending`,
    )
    expect(TODO_PROGRESS_SEPARATOR).toBe('\u2002·\u2002')
  })

  it('answers the empty string when there is nothing to count', () => {
    expect(todoProgressLabel([], () => 'never')).toBe('')
  })
})

describe('todoDotState', () => {
  it('maps the lifecycle onto the shared StateDot language', () => {
    expect(todoDotState('completed')).toBe('done')
    expect(todoDotState('in_progress')).toBe('ongoing')
    expect(todoDotState('pending')).toBe('idle')
  })
})
