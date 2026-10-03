/**
 * Seam: the `+` command menu as the user sees it — the trigger, the
 * self-drawn MenuView replica, and the dispatch of the eight rows. Pins the
 * native contract the ticket demands: two localized sections, alias
 * rendering, the combobox keyboard through the editor's menu-key seam,
 * mousedown picks that keep editor focus, aria listbox/option/
 * activedescendant wiring, outside-pointerdown dismissal (card excluded),
 * the static fallback rows when the catalog RPC fails, chain-opens into the
 * permission/model popup faces, and a probe miss hiding the face behind the
 * gate's fallback.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { RefObject } from 'react'
import { CommandMenuFace, type CommandMenuFaceProps } from '../src/client/CommandMenuFace.tsx'
import { commandFaceDefinition, resetCommandFace, setCommandSource } from '../src/client/command-face.ts'
import type { MarkdownEditorHandle, MenuKeyHandler } from '../src/client/markdown-editor.ts'
import { registerChainPopup, resetChainPopups } from '../src/client/chain-open.ts'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en, zh } from '../src/client/locales.ts'

function fakeT(locale: Record<string, string>): CommandMenuFaceProps['t'] {
  return ((key: string, params?: Record<string, string>) => {
    const template = locale[key] ?? key
    return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
  }) as CommandMenuFaceProps['t']
}
const tZh = fakeT(zh)
const tEn = fakeT(en)

/** Build a recording editor stub; the captured menu-key handler drives the keyboard tests. */
function stubEditor(leading = true) {
  let menuHandler: MenuKeyHandler | null = null
  const editor = {
    focus: vi.fn(),
    isLeadingSelection: vi.fn(() => leading),
    claimSelection: vi.fn(),
    setMenuKeyHandler: vi.fn((handler: MenuKeyHandler | null) => { menuHandler = handler }),
  }
  return {
    editor,
    editorRef: { current: editor as unknown as MarkdownEditorHandle } as RefObject<MarkdownEditorHandle | null>,
    handler: () => menuHandler,
  }
}

function mountFace(options: {
  sessionId?: string | undefined
  canPickFiles?: boolean
  listResult?: unknown
  executeResult?: unknown
  leading?: boolean
  locale?: 'zh' | 'en'
  chainPopups?: boolean
} = {}) {
  const onError = vi.fn()
  const onPickFiles = vi.fn()
  // Default catalog read: pending forever, so the menu shows the static
  // fallback rows deterministically; tests pass `listResult` to land a read.
  const pending = new Promise(() => {})
  const surfaces = {
    commands: {
      list: vi.fn(() => {
        if (options.reject !== undefined) return Promise.reject(options.reject)
        if (options.listResult !== undefined) return Promise.resolve(options.listResult)
        return pending
      }),
      execute: vi.fn(() => Promise.resolve(options.executeResult ?? {
        ok: true, value: { commandId: 'c1', result: { kind: 'success' } },
      })),
    },
    $on: vi.fn(() => () => {}),
  }
  setCommandSource(() => ({ commands: surfaces.commands, remoteEvents: surfaces }))
  const { editor, editorRef, handler } = stubEditor(options.leading ?? true)
  const containerRef = { current: null as HTMLElement | null }
  let close: (() => void) | null = null
  const props = {
    sessionId: 'sessionId' in options ? options.sessionId : 's1',
    t: (options.locale ?? 'zh') === 'zh' ? tZh : tEn,
    editor: editorRef.current as MarkdownEditorHandle | null,
    container: containerRef as RefObject<HTMLElement | null>,
    canPickFiles: options.canPickFiles ?? true,
    onPickFiles,
    onError,
    registerClose: (fn: (() => void) | null) => { close = fn },
  } as unknown as CommandMenuFaceProps
  const view = render(
    <div ref={containerRef as never} data-composer-card>
      <div data-tool-row>
        <FaceGate
          definition={commandFaceDefinition()}
          fallback={<button type="button" data-testid="paperclip-fallback" />}
        >
          <CommandMenuFace {...props} />
        </FaceGate>
      </div>
    </div>,
  )
  if (options.chainPopups === true) {
    registerChainPopup('permission', () => true)
    registerChainPopup('model', () => true)
  }
  return { view, onError, onPickFiles, surfaces, editor, handler, close: () => close }
}

function trigger(): HTMLElement {
  return document.querySelector('button[data-command-menu-trigger]') as HTMLElement
}

function listbox(): HTMLElement | null {
  return document.querySelector('[role="listbox"]')
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll('[role="option"]')] as HTMLElement[]
}

async function openMenu(): Promise<void> {
  fireEvent.click(trigger())
  await waitFor(() => expect(listbox()).not.toBeNull())
}

afterEach(() => {
  cleanup()
  resetCommandFace()
  resetChainPopups()
  resetFaces()
})

describe('CommandMenuFace trigger', () => {
  it('renders the + trigger with listbox semantics and closed state', () => {
    mountFace()
    expect(trigger()).toBeInTheDocument()
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveAttribute('title', '添加文件或调用指令')
  })

  it('opens on click: focus returns to the editor first (combobox), catalog warms up', async () => {
    const { editor, surfaces } = mountFace()
    await openMenu()
    expect(editor.focus).toHaveBeenCalled()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    expect(surfaces.commands.list).toHaveBeenCalledWith('s1')
  })

  it('toggles closed on a second click', async () => {
    mountFace()
    await openMenu()
    fireEvent.click(trigger())
    expect(listbox()).toBeNull()
  })

  it('renders nothing while the session is absent (locked card)', () => {
    mountFace({ sessionId: undefined })
    expect(trigger()).not.toBeInTheDocument()
    expect(listbox()).toBeNull()
  })
})

describe('CommandMenuFace menu surface', () => {
  it('shows the static eight rows in the two localized sections while the catalog is empty', async () => {
    mountFace({ chainPopups: true })
    await openMenu()
    const rows = options()
    expect(rows.map((row) => row.textContent)).toEqual([
      // 添加
      expect.stringContaining('文件'),
      expect.stringContaining('目标'),
      expect.stringContaining('计划'),
      expect.stringContaining('反馈'),
      // 指令
      expect.stringContaining('压缩'),
      expect.stringContaining('权限'),
      expect.stringContaining('模型'),
      expect.stringContaining('下载日志'),
    ])
    const titles = [...document.querySelectorAll('[data-command-section]')] as HTMLElement[]
    expect(titles.map((title) => title.textContent)).toEqual(['添加', '指令'])
  })

  it('swaps in catalog rows when the read lands, unlisted commands closing 指令', async () => {
    mountFace({
      listResult: {
        ok: true,
        value: [
          { name: 'custom', description: 'A custom command' },
          { definitionId: '@deepseek-ai/dsh-command-compact', name: 'compact', description: 'Compact' },
        ],
      },
      chainPopups: true,
    })
    await openMenu()
    await waitFor(() => {
      expect(options().map((row) => row.getAttribute('data-command-name'))).toEqual([
        'file', 'compact', 'model', 'custom',
      ])
    })
  })

  it('keeps the static rows when the catalog RPC fails (no empty window)', async () => {
    mountFace({ reject: new Error('transport down'), chainPopups: true })
    await openMenu()
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(options()).toHaveLength(8)
  })

  it('renders the localized alias beside the label (文件 file)', async () => {
    mountFace({ locale: 'zh' })
    await openMenu()
    const goal = options().find((row) => row.getAttribute('data-command-name') === 'goal')
    expect(goal?.querySelector('[data-command-alias]')?.textContent).toBe('goal')
    // en labels coincide with the name: no alias.
  })

  it('drops the alias for en labels matching the name', async () => {
    mountFace({ locale: 'en' })
    await openMenu()
    const goal = options().find((row) => row.getAttribute('data-command-name') === 'goal')
    expect(goal?.querySelector('[data-command-alias]')).toBeNull()
  })

  it('hides the file row when file intake is unavailable', async () => {
    mountFace({ canPickFiles: false })
    await openMenu()
    expect(options().map((row) => row.getAttribute('data-command-name'))).not.toContain('file')
  })

  it('wires aria-activedescendant to the highlighted option id', async () => {
    mountFace()
    await openMenu()
    const box = listbox() as HTMLElement
    expect(box.getAttribute('aria-activedescendant')).toBe('dsh-slash-option-command-0')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })
})

describe('CommandMenuFace keyboard', () => {
  it('cycles the highlight with ↑/↓ and keeps it on rows', async () => {
    const { handler } = mountFace({ chainPopups: true })
    await openMenu()
    await act(async () => { handler()?.('down') })
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe('dsh-slash-option-command-1')
    await act(async () => { handler()?.('up') })
    await act(async () => { handler()?.('up') })
    // Cycling wraps to the tail.
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe('dsh-slash-option-command-7')
  })

  it('picks the highlighted claim row on Enter and inserts the localized token', async () => {
    const { handler, editor } = mountFace({ leading: true })
    await openMenu()
    // Highlight the goal row (index 1 behind the file row).
    await act(async () => { handler()?.('down') })
    await act(async () => { handler()?.('pick') })
    expect(editor.claimSelection).toHaveBeenCalledWith('/目标 ')
    expect(listbox()).toBeNull()
  })

  it('declines a claim while the caret follows text (leading guard)', async () => {
    const { handler, editor } = mountFace({ leading: false })
    await openMenu()
    // goal/plan/feedback are filtered out inline; compact (index 1 now) executes.
    await act(async () => { handler()?.('down') })
    await act(async () => { handler()?.('pick') })
    expect(editor.claimSelection).not.toHaveBeenCalled()
    expect(editor.isLeadingSelection).toHaveBeenCalled()
  })

  it('closes on Escape/Shift+Tab through the seam and declines keys while closed', async () => {
    const { handler } = mountFace()
    await openMenu()
    await act(async () => { handler()?.('close') })
    expect(listbox()).toBeNull()
    // Closed: the seam declines, the editor's own keys carry on.
    expect(handler()?.('down')).toBe(false)
  })

  it('highlights rows under the pointer without closing', async () => {
    mountFace()
    await openMenu()
    fireEvent.mouseMove(options()[3])
    expect(listbox()?.getAttribute('aria-activedescendant')).toBe('dsh-slash-option-command-3')
  })
})

describe('CommandMenuFace picks', () => {
  it('picks with mousedown that keeps the editor focus (preventDefault)', async () => {
    const { onPickFiles, handler } = mountFace()
    await openMenu()
    const fileRow = options()[0]
    // preventDefault on the mousedown keeps CM6 focus (combobox); the
    // dispatched event reporting non-defaulted proves the call happened.
    const notCancelled = fireEvent.mouseDown(fileRow, { cancelable: true })
    expect(notCancelled).toBe(false)
    expect(onPickFiles).toHaveBeenCalledTimes(1)
    expect(handler()).not.toBeNull() // the seam stays bound; only the menu closed
    expect(listbox()).toBeNull()
  })

  it('executes bare commands detached and reports failures through the banner', async () => {
    const { surfaces, onError } = mountFace({
      executeResult: { ok: false, error: { code: 'session/writer-held', message: 'busy' } },
    })
    await openMenu()
    const compact = options().find((row) => row.getAttribute('data-command-name') === 'compact')
    fireEvent.mouseDown(compact as HTMLElement)
    await waitFor(() => expect(surfaces.commands.execute).toHaveBeenCalledWith('s1', '/compact'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('命令执行失败：session/writer-held: busy'))
  })

  it('reports a handler error outcome with its text', async () => {
    const { onError } = mountFace({
      executeResult: {
        ok: true, value: { commandId: 'c1', result: { kind: 'error', text: 'no goal set' } },
      },
    })
    await openMenu()
    const compact = options().find((row) => row.getAttribute('data-command-name') === 'compact')
    fireEvent.mouseDown(compact as HTMLElement)
    await waitFor(() => expect(onError).toHaveBeenCalledWith('no goal set'))
  })

  it('chains permission/model into their popup faces after closing', async () => {
    const opened: string[] = []
    const unregisterPermission = registerChainPopup('permission', () => { opened.push('permission'); return true })
    const unregisterModel = registerChainPopup('model', () => { opened.push('model'); return true })
    const { surfaces } = mountFace()
    try {
      await openMenu()
      const permission = options().find((row) => row.getAttribute('data-command-name') === 'permission')
      fireEvent.mouseDown(permission as HTMLElement)
      expect(opened).toEqual(['permission'])
      expect(listbox()).toBeNull()
      expect(surfaces.commands.execute).not.toHaveBeenCalled()
    } finally {
      unregisterPermission()
      unregisterModel()
    }
  })

  it('hides the chainable rows while their popup faces are dead', async () => {
    mountFace()
    await openMenu()
    const names = options().map((row) => row.getAttribute('data-command-name'))
    // permission falls back to a claim row, model (contribution-only) hides.
    expect(names).not.toContain('model')
    const permission = options().find((row) => row.getAttribute('data-command-name') === 'permission')
    expect(permission).not.toBeNull()
  })
})

describe('CommandMenuFace face gate', () => {
  it('hides behind the gate fallback while the probe fails (no command source)', () => {
    // resetCommandFace in afterEach unbound the source: the probe fails and
    // the gate swaps in the legacy attach button instead of the trigger.
    const props = {
      sessionId: 's1',
      t: tZh,
      editor: null,
      container: { current: null },
      canPickFiles: false,
      onPickFiles: () => {},
      onError: () => {},
      registerClose: () => {},
    } as unknown as CommandMenuFaceProps
    render(
      <FaceGate
        definition={commandFaceDefinition()}
        fallback={<button type="button" data-testid="paperclip-fallback" />}
      >
        <CommandMenuFace {...props} />
      </FaceGate>,
    )
    expect(document.querySelector('[data-command-menu-trigger]')).toBeNull()
    expect(document.querySelector('[data-testid="paperclip-fallback"]')).toBeInTheDocument()
  })
})

describe('CommandMenuFace dismissal', () => {
  it('closes on pointerdown outside the card', async () => {
    mountFace()
    await openMenu()
    fireEvent.pointerDown(document.body)
    expect(listbox()).toBeNull()
  })

  it('stays open on pointerdown inside the card (combobox pattern)', async () => {
    mountFace()
    await openMenu()
    fireEvent.pointerDown(trigger())
    expect(listbox()).not.toBeNull()
  })

  it('closes when the document changes through the registered close', async () => {
    const { close } = mountFace()
    await openMenu()
    await act(async () => { close()?.() })
    expect(listbox()).toBeNull()
  })
})
