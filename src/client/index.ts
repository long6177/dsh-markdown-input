/**
 * dsh-markdown-input, browser half: replaces the `user`/`steering`
 * chat-node seats so sent and queued user messages render through the
 * host's own Markdown pipeline, reference chips preserved. Per ADR-0003
 * the composer is the host's native surface — this plugin registers no
 * composer entry; the paint (L1) and paste (L3) layers build on the
 * capability skeletons in paint-layer.ts / paste-layer.ts.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The `chat`-namespace `t` seat also accepts the shared `common` vocabulary
// (copy/copied/markdown.footnotes) — that augmentation comes from here.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Context.slots (SlotRegistry) is declared by the renderer's client face.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { probe, type Capability } from './capability.ts'
import { MarkdownUserMessage } from './UserMessage.tsx'

/** Required services: slot registry. */
export const inject = ['slots']

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
 * Client plugin body: replace the `user`/`steering` chat-node seats with
 * the Markdown renderer, behind the capability probe.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const capability = userMessageCapability(primitives)
  if (!capability.supported) {
    // Auto-disable: degrade to the host seats for the whole page life.
    console.info(`[markdown-input] user-message Markdown rendering disabled: ${capability.reason}`)
    return
  }
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
}
