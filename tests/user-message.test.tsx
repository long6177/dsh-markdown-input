/**
 * Seam 1 (chat side): the Markdown user-message renderer is tested from the
 * outside — render it with a fabricated `user`/`steering` node and assert
 * what a user sees: Markdown structure, preserved reference chips,
 * attachments.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownUserMessage, type MarkdownSeatKind } from '../src/client/UserMessage.tsx'

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
