/**
 * dsh-markdown-input, browser half: registers the zh/en dictionaries, the
 * low-priority composer chain entry that takes over the resident composer
 * for Markdown editing, and the `user` chat-node renderer that Markdownizes
 * sent user messages. Built-in takeover panels (approvals, questions,
 * subagent) outrank this entry by priority, so they keep their elections.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MarkdownComposer, MARKDOWN_TAKEOVER } from './MarkdownComposer.tsx'
import { en, NS, zh, type ComposerKey } from './locales.ts'
import { MarkdownUserMessage } from './UserMessage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Markdown composer copy. */
    'markdown-input': ComposerKey
  }
}

export type { MarkdownComposerProps } from './MarkdownComposer.tsx'

/** Required services: slot registry and copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries, the composer takeover, and
 * the Markdown user-message renderer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'markdown-input: dictionaries')
  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    // After approvals/questions (0..1) and the subagent read-only composer
    // (-10): pending interactions keep precedence over Markdown editing.
    priority: 2,
    select: () => MARKDOWN_TAKEOVER,
    locale: NS,
  }, MarkdownComposer))
  // Keyed replacement of the user-message seat; steering and every other
  // chat node kind keep the host's own renderers.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'user',
    locale: 'chat',
  }, MarkdownUserMessage))
}
