/**
 * Seam: the submission-echo text entry (#77) — the keyed
 * `conversation.user.text.node` `text` shadow that puts the local echo's
 * plain text run through the same Markdown projection its durable bubble
 * uses, so the handoff at admission has no style jump. Tested from the
 * outside: render the entry with a fabricated text node and assert what a
 * user sees, plus the unbound-locale degradation (the host's plain run).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MarkdownEchoText } from '../src/client/UserMessage.tsx'
import { resetEchoLocale, setEchoLocale } from '../src/client/echo-text-face.ts'

afterEach(() => {
  cleanup()
  resetEchoLocale()
})

/** Fabricate one parser-produced plain text node over the whole input. */
function textNode(text: string): UserTextNodeProps<'text'> {
  return {
    node: { id: 'text', start: 0, end: text.length, data: { text } },
    raw: text,
    interactive: false,
  } as unknown as UserTextNodeProps<'text'>
}

describe('MarkdownEchoText (#77)', () => {
  it('renders the echo run through the durable bubble’s Markdown pipeline', () => {
    setEchoLocale(((key: string) => `chat:${key}`) as never)
    const { container } = render(<MarkdownEchoText {...textNode('# 标题\n\n**重点**内容')} />)
    expect(container.querySelector('h1')).toHaveTextContent('标题')
    expect(container.querySelector('strong')).toHaveTextContent('重点')
  })

  it('keeps the lines the author typed visible — the echo breaks, not folds', () => {
    setEchoLocale(((key: string) => `chat:${key}`) as never)
    const { container } = render(<MarkdownEchoText {...textNode('第一行\n第二行')} />)
    // Same hardenSoftBreaks projection the durable bubble renders, so the
    // handoff at admission cannot reflow the text.
    expect(container.querySelector('br')).not.toBeNull()
  })

  it('degrades to the host’s plain run while the chat locale seat is unbound', () => {
    // No binding (the apply seam did not run): native echo text, no Markdown.
    const { container } = render(<MarkdownEchoText {...textNode('# 标题')} />)
    expect(container.querySelector('h1')).toBeNull()
    expect(container.textContent).toBe('# 标题')
  })
})
