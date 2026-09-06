/**
 * Seam 1 (chat side): the Markdown user-message renderer is tested from the
 * outside — render it with a fabricated `user` node and assert what a user
 * sees: Markdown structure, preserved reference chips, attachments.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatNode, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { MarkdownUserMessage } from '../src/client/UserMessage.tsx'

const t = vi.fn((key: string) => key)

afterEach(cleanup)

function userNode(content: readonly unknown[], extra: Record<string, unknown> = {}): ChatNode<'user'> {
  return {
    kind: 'user',
    data: {
      kind: 'user',
      seq: 1,
      time: 0,
      content,
      source: {},
      ...extra,
    },
  } as unknown as ChatNode<'user'>
}

function messageProps(content: readonly unknown[], extra: Record<string, unknown> = {}): ChatNodeViewProps<'user'> {
  return {
    node: userNode(content, extra),
    renderMessageImages: vi.fn(),
    t,
  } as unknown as ChatNodeViewProps<'user'>
}

describe('MarkdownUserMessage', () => {
  it('renders markdown structure inside the bubble', () => {
    const { container } = render(<MarkdownUserMessage {...messageProps([{ type: 'text', text: '# 计划\n\n**重点**内容' }])} />)
    expect(container.querySelector('[data-markdown-user-bubble]')).toBeInTheDocument()
    expect(container.querySelector('h1')).toHaveTextContent('计划')
    expect(container.querySelector('strong')).toHaveTextContent('重点')
  })

  it('keeps reference chips as chips while markdownizing the text', () => {
    const { container } = render(
      <MarkdownUserMessage
        {...messageProps(
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

  it('renders a plain message without chips through the markdown pipeline', () => {
    const { container } = render(
      <MarkdownUserMessage {...messageProps([{ type: 'text', text: 'just words\nsecond line' }])} />,
    )
    expect(container.querySelector('[data-ref-chip]')).toBeNull()
    expect(container.querySelector('p')).not.toBeNull()
  })

  it('keeps the wire session-reference form folded into a chip', () => {
    const { container } = render(
      <MarkdownUserMessage {...messageProps([{ type: 'text', text: '看 @[会话一](dsh-session:abc123) 的讨论' }])} />,
    )
    const chip = container.querySelector('[data-ref-chip="session"]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('会话一')
  })

  it('renders file attachments as cards and delegates images to the host renderer', () => {
    const images = <div data-testid="images" />
    const renderMessageImages = vi.fn(() => images)
    const view = render(
      <MarkdownUserMessage
        {...{
          ...messageProps([
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
    const { container } = render(<MarkdownUserMessage {...messageProps([])} />)
    expect(container.querySelector('[data-markdown-user-bubble]')).toBeNull()
  })

  it('exposes the message through the locale seat for chrome copy', () => {
    render(<MarkdownUserMessage {...messageProps([{ type: 'text', text: 'hello' }])} />)
    // MarkdownText chrome keys resolve through the chat `t` seat.
    expect(t).toHaveBeenCalledWith('copy')
    expect(t).toHaveBeenCalledWith('markdown.footnotes')
  })
})
