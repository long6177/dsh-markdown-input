/**
 * Seam 1 (chat side): the Markdown user-message renderer is tested from the
 * outside — render it with a fabricated `user`/`steering` node and assert
 * what a user sees: Markdown structure, preserved reference chips,
 * attachments.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownUserMessage, type MarkdownSeatKind } from '../src/client/UserMessage.tsx'
import { installClipboardStub } from './clipboard-stub.ts'

const t = vi.fn((key: string) => key)

afterEach(cleanup)

/**
 * Fabricate the keyed seat for one node kind. The host serves `user` and
 * `steering` with identical node data (steering adds `messageId`), which the
 * cast mirrors without importing the host's private record types.
 */
function seatProps(
  kind: MarkdownSeatKind,
  content: readonly unknown[],
  extra: Record<string, unknown> = {},
): ChatNodeViewProps<MarkdownSeatKind> {
  return {
    node: {
      kind,
      data: {
        kind,
        seq: 1,
        time: 0,
        content,
        source: {},
        ...(kind === 'steering' ? { messageId: 'msg-1' } : {}),
        ...extra,
      },
    },
    renderMessageImages: vi.fn(),
    t,
  } as unknown as ChatNodeViewProps<MarkdownSeatKind>
}

describe('MarkdownUserMessage', () => {
  it('renders markdown structure inside the bubble', () => {
    const { container } = render(<MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: '# 计划\n\n**重点**内容' }])} />)
    expect(container.querySelector('[data-markdown-user-bubble]')).toBeInTheDocument()
    expect(container.querySelector('h1')).toHaveTextContent('计划')
    expect(container.querySelector('strong')).toHaveTextContent('重点')
  })

  it('keeps reference chips as chips while markdownizing the text', () => {
    const { container } = render(
      <MarkdownUserMessage
        {...seatProps(
          'user',
          [{ type: 'text', text: '@notes/file.md 看看这个\n\n# 重点' }],
          { referenceLabels: ['notes/file.md'] },
        )}
      />,
    )
    const chip = container.querySelector('[data-ref-chip]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('notes/file.md')
    // The mention itself does not leak into a markdown paragraph run.
    expect(container.querySelector('h1')).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).not.toContain('@notes')
  })

  it('keeps a loaded skill slash-form as a chip while markdownizing', () => {
    const { container } = render(
      <MarkdownUserMessage
        {...seatProps(
          'user',
          [{ type: 'text', text: '/plan 列一下\n\n## 小节' }],
          { skillNames: ['plan'] },
        )}
      />,
    )
    const chip = container.querySelector('[data-ref-chip="skill"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('plan')
    expect(container.querySelector('h2')).not.toBeNull()
  })

  it('renders a plain message without chips through the markdown pipeline', () => {
    const { container } = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: 'just words\nsecond line' }])} />,
    )
    expect(container.querySelector('[data-ref-chip]')).toBeNull()
    expect(container.querySelector('p')).not.toBeNull()
  })

  it('keeps the lines the author typed visible — a list continuation line breaks instead of merging (alpha.17 feedback)', () => {
    // The maintainer's exact message: GFM folds `2. asdfao` and `afsdfa`
    // into one item paragraph and the bubble showed two lines, not three.
    const { container } = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: '1. 你好\n2. asdfao\nafsdfa' }])} />,
    )
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    // The continuation line is a hard break inside item 2 — rendered, not
    // folded into the paragraph (the host renders the break as a <br> plus
    // its trailing newline; the list marker is a ::marker, not text).
    expect(items[1]?.querySelector('br')).not.toBeNull()
    expect(items[1]?.textContent).toBe('asdfao\nafsdfa')
  })

  it('leaves fenced code interiors alone — no break injection inside the block', () => {
    const { container } = render(
      <MarkdownUserMessage
        {...seatProps('user', [{ type: 'text', text: 'before\n```text\n1. a\n2. b\n```\nafter' }])}
      />,
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.querySelector('br')).toBeNull()
    expect(pre?.textContent).toContain('1. a')
    expect(pre?.textContent).toContain('2. b')
  })

  it('keeps the wire session-reference form folded into a chip', () => {
    const { container } = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: '看 @[会话一](dsh-session:abc123) 的讨论' }])} />,
    )
    const chip = container.querySelector('[data-ref-chip="session"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('会话一')
  })

  it('renders a queued steering message through the same markdown seat', () => {
    const { container } = render(
      <MarkdownUserMessage
        {...seatProps(
          'steering',
          [{ type: 'text', text: '@notes/file.md 排队追加\n\n- 第一项' }],
          { referenceLabels: ['notes/file.md'] },
        )}
      />,
    )
    expect(container.querySelector('[data-markdown-user-bubble]')).toBeInTheDocument()
    expect(container.querySelector('[data-ref-chip]')).not.toBeNull()
    expect(container.querySelector('li')).toHaveTextContent('第一项')
  })

  it('renders file attachments as cards and delegates images to the host renderer', () => {
    const images = <div data-testid="images" />
    const renderMessageImages = vi.fn(() => images)
    const view = render(
      <MarkdownUserMessage
        {...{
          ...seatProps('user', [
            { type: 'text', text: '文件如下' },
            { type: 'image', attachment: { url: 'https://x/y.png' } },
            { type: 'file', attachment: { name: 'spec.md', bytes: 2048 } },
          ]),
          renderMessageImages,
        } as unknown as ChatNodeViewProps<'user'>}
      />,
    )
    expect(renderMessageImages).toHaveBeenCalledWith(expect.objectContaining({ align: 'end' }))
    expect(view.getByTestId('images')).toBeInTheDocument()
    expect(view.getByText('spec.md')).toBeInTheDocument()
  })

  it('renders an empty message as nothing inside the bubble row', () => {
    const { container } = render(<MarkdownUserMessage {...seatProps('user', [])} />)
    expect(container.querySelector('[data-markdown-user-bubble]')).toBeNull()
  })

  it('exposes the message through the locale seat for chrome copy', () => {
    render(<MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: 'hello' }])} />)
    // MarkdownText chrome keys resolve through the chat `t` seat.
    expect(t).toHaveBeenCalledWith('copy')
    expect(t).toHaveBeenCalledWith('markdown.footnotes')
  })
})

describe('MarkdownUserMessage copy actions (#33)', () => {
  /** Stub the clipboard with a recording write; restores on afterEach. */
  let writeText: ReturnType<typeof vi.fn>
  let restoreClipboard: () => void
  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve(true))
    restoreClipboard = installClipboardStub(writeText)
  })
  afterEach(() => {
    restoreClipboard()
  })

  it('mounts the copy action row under the bubble for the user seat', () => {
    const { container, getByRole } = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: 'hello' }])} />,
    )
    const row = container.querySelector('[data-message-actions]')
    expect(row).not.toBeNull()
    // The row follows the stack inside the flow row (native userRow layout).
    expect(row?.previousElementSibling).toBe(container.querySelector('[data-markdown-user-message] > *'))
    expect(getByRole('button', { name: 'copy' })).toBeInTheDocument()
  })

  it('copies the pure source text, not the rendered markdown', async () => {
    const view = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: '# 标题\n\n**重点**内容' }])} />,
    )
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'copy' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    // The wire text the model received — markdown source, chips excluded.
    expect(writeText).toHaveBeenCalledWith('# 标题\n\n**重点**内容')
  })

  it('copies the raw wire text for chip messages — chips render, the mention stays in the copy', async () => {
    const view = render(
      <MarkdownUserMessage
        {...seatProps('user', [{ type: 'text', text: '@notes/file.md 看看这个' }], { referenceLabels: ['notes/file.md'] })}
      />,
    )
    expect(view.container.querySelector('[data-ref-chip]')).not.toBeNull()
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'copy' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    // Native parity: the copy is contentParts().text — the raw user text.
    expect(writeText).toHaveBeenCalledWith('@notes/file.md 看看这个')
  })

  it('mounts the same action row for a queued steering message', () => {
    const { container } = render(
      <MarkdownUserMessage {...seatProps('steering', [{ type: 'text', text: '排队追加' }])} />,
    )
    expect(container.querySelector('[data-message-actions]')).not.toBeNull()
    expect(container.querySelector('[data-message-actions] button')).not.toBeNull()
  })

  it('shows the message clock from the node time', () => {
    const { container } = render(
      <MarkdownUserMessage {...seatProps('user', [{ type: 'text', text: 'hello' }], { time: new Date(2025, 11, 31, 23, 59).getTime() })} />,
    )
    // Not today → the clock.ymd date template renders ahead of the time.
    const clock = container.querySelector('[data-message-actions] span')?.textContent ?? ''
    expect(clock).toContain('23:59')
    expect(t).toHaveBeenCalledWith('clock.ymd', { y: 2025, m: 12, d: 31 })
  })
})
