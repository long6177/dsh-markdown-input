/**
 * dsh-markdown-input, browser half: takes over the resident composer for
 * Markdown editing through a low-priority `conversation.composer` chain
 * entry (built-in takeover panels — approvals, questions, the subagent
 * read-only composer — outrank it and keep their elections), registers the
 * zh/en dictionaries, and replaces the `user`/`steering` chat-node seats so
 * sent and queued user messages render through the host's own Markdown
 * pipeline, reference chips preserved.
 *
 * The two peripheral docks (paint L1, paste L3) stay registered: under the
 * takeover they see only the hidden native bar (the chain fallback stays
 * mounted but display:none), so both idle harmlessly until the dock
 * retirement (ADR-0005, T7).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The `chat`-namespace `t` seat also accepts the shared `common` vocabulary
// (copy/copied/markdown.footnotes) — that augmentation comes from here.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Context.slots (SlotRegistry) is declared by the renderer's client face.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { bindComposerCrash, TakeoverCard } from './composer-card.tsx'
import { probe, type Capability } from './capability.ts'
import { installConversationSource } from './conversation-face.ts'
import { MARKDOWN_TAKEOVER } from './MarkdownComposer.tsx'
import { en, NS, zh, type ComposerKey } from './locales.ts'
import { PaintDock } from './PaintDock.tsx'
import { PasteDock } from './PasteDock.tsx'
import { MarkdownUserMessage } from './UserMessage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Markdown composer copy. */
    'markdown-input': ComposerKey
  }
}

/** Required services: slot registry and copy. */
export const inject = ['slots', 'locale']

/**
 * A component value is present when the host module table resolved it at
 * all — `memo`/`forwardRef` wrap the function into an exotic object, so a
 * `typeof === 'function'` check would false-negative exactly the crash
 * this gate guards against (missing names = `undefined`).
 */
function present(value: unknown): boolean {
  return value !== undefined && value !== null
}

/**
 * Probe the primitives values the Markdown seat composes with. A host
 * build whose module table dropped any of them disables the seat
 * replacement wholesale: nothing registers and the host's own renderers
 * stay — the user sees the native bubbles, never a broken seat.
 * @param surface - the primitives module namespace as the host table resolved it.
 */
export function userMessageCapability(surface: {
  MarkdownText?: unknown
  projectUserText?: unknown
  FileTypeIcon?: unknown
  fileSizeText?: unknown
  JsonBlock?: unknown
}): Capability {
  return probe(
    () => present(surface.MarkdownText)
      && present(surface.JsonBlock)
      && present(surface.FileTypeIcon)
      && typeof surface.projectUserText === 'function'
      && typeof surface.fileSizeText === 'function',
    'primitives Markdown surface incomplete',
  )
}

/**
 * Client plugin body: take over the composer, register the dictionaries,
 * and replace the user-message seats.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The taken-over card reads the conversation service for its attachment
  // and notice faces (lazy per call — boot order stays free).
  installConversationSource(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'markdown-input: dictionaries')
  // Card-level crash latch (ADR-0005): a render exception inside the card
  // disposes this session's chain entry — the election collapses, the chain
  // fallback (the native composer) tops back in, and the machine draft the
  // card flushed on unmount survives. The latch holds for the entry's life;
  // a later session scope re-registers fresh.
  let disposeEntry: (() => void) | undefined
  bindComposerCrash(() => {
    const dispose = disposeEntry
    disposeEntry = undefined
    dispose?.()
  })
  ctx.slots.inject('conversation.composer', () => {
    const dispose = ctx.slots.register({
      name: 'conversation.composer',
      // After approvals/questions (1) and the subagent read-only composer
      // (-10): pending interactions keep precedence over Markdown editing.
      priority: 2,
      select: () => MARKDOWN_TAKEOVER,
      locale: NS,
    }, TakeoverCard)
    disposeEntry = dispose
    return () => {
      if (disposeEntry === dispose) disposeEntry = undefined
      dispose()
    }
  })
  // Keyed replacement of the user-message seats — turn-opening (`user`) and
  // queued mid-turn (`steering`) bubbles share identical node data and both
  // go Markdown; every other chat node kind keeps the host's own renderers.
  // The host registers the same keys at its default priority 0, and the
  // registry throws on same-key-same-priority: shadow it at a lower rank
  // (lowest renders), falling back to the host seat when we deregister.
  for (const key of ['user', 'steering'] as const) {
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
      name: 'conversation.chat.node',
      key,
      priority: -1,
      locale: 'chat',
    }, MarkdownUserMessage))
  }
  // L3 paste layer: one peripheral-slot occupant at the host's
  // `conversation.composer.dock` entry point (the ambient slot below the
  // composer card). Session scope grants the standard `inputActions` face;
  // the occupant renders an invisible anchor and converts rich-text paste
  // to clean Markdown through the version-guarded insertion verbs. The
  // host's composer bar declares the slot; inject defers the registration
  // until that declaration lands.
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'markdown-input-paste',
  }, PasteDock))
  // L1 paint layer: a second dock occupant runs the paint engine over the
  // native text face — the inline four colored, syntax markers dimmed, via
  // the CSS Custom Highlight API. Paint-only: zero DOM modification, so
  // IME, undo, and the caret stay the host's own. Like the paste layer,
  // the dock owns its capability probe: an unsupported browser never
  // attaches, and a mid-life failure or structure change degrades that
  // engine run alone, never the composer (ADR-0003). Under the takeover
  // (ADR-0005) it idles over the hidden fallback bar until T7 retires it.
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'markdown-input-paint',
  }, PaintDock))
}
