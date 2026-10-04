/**
 * Seam: the takeover card's todo panel as the user sees it (issue #38). The
 * panel is the card's rebuild of the native TodoDock (`ui-conversation`
 * skeleton, the `conversation.input.dock` order-0 seat the takeover
 * structurally hides with the whole fallback bar): a present, non-empty list
 * shows the checklist glyph, the title, the per-status progress line, and the
 * collapse chevron; the panel starts collapsed and expanding lists every entry
 * with its status dot; loading, the pre-first-write `null`, an empty list, and
 * an absent projection key all render nothing.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'
import { TODO_PROGRESS_SEPARATOR, type TodoItemView } from '../src/client/todo-core.ts'
import { TodoStripFace, todoStripFaceDefinition } from '../src/client/TodoStripFace.tsx'

function fakeT(key: keyof typeof en, params?: Record<string, string | number>): string {
  return en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => `${params?.[name] ?? `{${name}}`}`)
}

function panel(): HTMLElement | null {
  return document.querySelector('[data-markdown-todo]')
}

function header(): HTMLButtonElement | null {
  return document.querySelector('[data-markdown-todo] button')
}

function rows(): HTMLElement[] {
  return [...document.querySelectorAll('[data-markdown-todo-list] > li')]
}

function glyphs(): (string | null)[] {
  return [...document.querySelectorAll('[data-markdown-todo-list] [role="img"]')]
    .map((node) => node.getAttribute('aria-label'))
}

const ITEMS: readonly TodoItemView[] = [
  { content: 'read the host', status: 'completed' },
  { content: 'rebuild the panel', status: 'in_progress' },
  { content: 'ship it', status: 'pending' },
]

/**
 * Mount the panel inside its real FaceGate, with `useProjection` answering a
 * fake hook (a live cell, so a pushed frame is what the next render reads);
 * `isFunction: false` models a host that renamed the hook away.
 */
function mountPanel(
  projection: unknown,
  options: { isFunction?: boolean } = {},
) {
  let current = projection
  const isFunction = options.isFunction ?? true
  const useProjection = isFunction
    ? (key: string): unknown => (key === 'todos' ? current : undefined)
    : undefined
  const renderTree = () => (
    <FaceGate definition={todoStripFaceDefinition(useProjection)}>
      <TodoStripFace useProjection={useProjection as (key: 'todos') => unknown} t={fakeT} />
    </FaceGate>
  )
  const view = render(renderTree())
  const rerender = (next: unknown): void => {
    current = next
    view.rerender(renderTree())
  }
  return { view, rerender }
}

afterEach(() => {
  cleanup()
  resetFaces()
})

describe('TodoStripFace visibility', () => {
  it('renders nothing while the projection is loading (undefined)', () => {
    mountPanel(undefined)
    expect(panel()).toBeNull()
  })

  it('renders nothing for the pre-first-write null', () => {
    mountPanel(null)
    expect(panel()).toBeNull()
  })

  it('renders nothing for an empty list (no todos, no panel)', () => {
    mountPanel([])
    expect(panel()).toBeNull()
  })

  it('renders nothing for a foreign projection frame', () => {
    mountPanel({ todos: ITEMS })
    mountPanel([{ content: 'a', status: 'someday' }])
    expect(panel()).toBeNull()
  })

  it('hides the whole face when the projection hook itself is missing', () => {
    mountPanel(ITEMS, { isFunction: false })
    expect(panel()).toBeNull()
  })

  it('renders the panel for a non-empty list', () => {
    mountPanel(ITEMS)
    expect(panel()).not.toBeNull()
    expect(panel()!.textContent).toContain(fakeT('todo.title'))
  })

  it('reappears when a first list lands and hides again when the list drains', () => {
    const { rerender } = mountPanel([])
    expect(panel()).toBeNull()
    rerender(ITEMS)
    expect(panel()).not.toBeNull()
    rerender([])
    expect(panel()).toBeNull()
  })
})

describe('TodoStripFace header', () => {
  it('summarizes every non-zero status in the native order and separator', () => {
    mountPanel(ITEMS)
    expect(header()!.textContent).toContain(
      fakeT('todo.progress.done', { done: 1 })
      + TODO_PROGRESS_SEPARATOR + fakeT('todo.progress.active', { active: 1 })
      + TODO_PROGRESS_SEPARATOR + fakeT('todo.progress.pending', { pending: 1 }),
    )
  })

  it('omits zero-count segments from the summary', () => {
    mountPanel([{ content: 'ship it', status: 'pending' }])
    expect(header()!.textContent).toContain(fakeT('todo.progress.pending', { pending: 1 }))
    expect(header()!.textContent).not.toContain(fakeT('todo.progress.done', { done: 0 }))
    expect(header()!.textContent).not.toContain(fakeT('todo.progress.active', { active: 0 }))
  })
})

describe('TodoStripFace collapse', () => {
  it('starts collapsed with the rows hidden, like the native dock', () => {
    mountPanel(ITEMS)
    expect(header()!.getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
  })

  it('expands on a header click and collapses again', () => {
    mountPanel(ITEMS)
    fireEvent.click(header()!)
    expect(header()!.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toHaveLength(3)
    fireEvent.click(header()!)
    expect(header()!.getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
  })

  it('keeps the collapse state across projection frames (local state, native parity)', () => {
    const { rerender } = mountPanel(ITEMS)
    fireEvent.click(header()!)
    expect(rows()).toHaveLength(3)
    rerender([...ITEMS, { content: 'write the retro', status: 'pending' }])
    expect(rows()).toHaveLength(4)
  })
})

describe('TodoStripFace rows', () => {
  it('lists every item in projection order with its content and status', () => {
    mountPanel(ITEMS)
    fireEvent.click(header()!)
    expect(rows().map((row) => row.getAttribute('data-status')))
      .toEqual(['completed', 'in_progress', 'pending'])
    expect(rows().map((row) => row.textContent))
      .toEqual(['read the host', 'rebuild the panel', 'ship it'])
  })

  it('announces each status beside its decorative dot', () => {
    mountPanel(ITEMS)
    fireEvent.click(header()!)
    expect(glyphs()).toEqual([
      fakeT('todo.status.completed'),
      fakeT('todo.status.inProgress'),
      fakeT('todo.status.pending'),
    ])
  })
})
