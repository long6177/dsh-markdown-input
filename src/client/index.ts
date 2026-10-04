/**
 * dsh-markdown-input, browser half: takes over the resident composer for
 * Markdown editing through a low-priority `conversation.composer` chain
 * entry (built-in takeover panels — approvals, questions, the subagent
 * read-only composer — outrank it and keep their elections), registers the
 * zh/en dictionaries, and replaces the `user`/`steering` chat-node seats so
 * sent and queued user messages render through the host's own Markdown
 * pipeline, reference chips preserved.
 *
 * The takeover card's faces read the host through capability-detected
 * gateways bound here: the conversation service (attachments, notices) and
 * the permission data plane (catalog RPC + invalidation event + the live
 * session's `/permission` write). Each face probes its own dependencies and
 * degrades alone.
 *
 * One peripheral-slot occupant registers at the host's
 * `conversation.composer.dock` beside the card — the fallback notice,
 * rendering the one-shot degradation announcement when the card falls back.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// The `chat`-namespace `t` seat also accepts the shared `common` vocabulary
// (copy/copied/markdown.footnotes) — that augmentation comes from here.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Context.slots (SlotRegistry) is declared by the renderer's client face.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { bindComposerCrash, takeoverDegraded } from './degrade.ts'
import { probe, type Capability } from './capability.ts'
import { installCommandSource } from './command-face.ts'
import { installConversationSource } from './conversation-face.ts'
import { installFeedbackSource } from './feedback-face.ts'
import { installGoalSource } from './goal-face.ts'
import { installPermissionSource } from './permission-face.ts'
import { installModelSource, MODEL_NS, setModelLocale } from './model-face.ts'
import { installSkillSource } from './skill-face.ts'
import { installFileReferenceSource } from './file-reference-face.ts'
import { TakeoverCard } from './composer-card.tsx'
import { FallbackNotice } from './FallbackNotice.tsx'
import { MARKDOWN_TAKEOVER } from './MarkdownComposer.tsx'
import { en, NS, zh, type ComposerKey } from './locales.ts'
import { en as modelEn, zh as modelZh, type ModelKey } from './ModelSelectFace.locales.ts'
import { MarkdownUserMessage } from './UserMessage.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Markdown composer copy. */
    'markdown-input': ComposerKey
    /** The vendored model picker's copy (verbatim ui-model-selection dictionary, own namespace — the host `model` namespace stays untouched). */
    'markdown-input.model': ModelKey
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
 * Probe the primitives values the Markdown seat composes with — the Markdown
 * pipeline plus the copy/clock chrome (#33). A host build whose module table
 * dropped any of them disables the seat replacement wholesale: nothing
 * registers and the host's own renderers stay — the user sees the native
 * bubbles (with the native actions row), never a broken seat.
 * @param surface - the primitives module namespace as the host table resolved it.
 */
export function userMessageCapability(surface: {
  MarkdownText?: unknown
  projectUserText?: unknown
  FileTypeIcon?: unknown
  fileSizeText?: unknown
  JsonBlock?: unknown
  Tooltip?: unknown
  writeClipboard?: unknown
  IconCopyOutlineRegular?: unknown
  IconCheckOutlineRegular?: unknown
}): Capability {
  return probe(
    () => present(surface.MarkdownText)
      && present(surface.JsonBlock)
      && present(surface.FileTypeIcon)
      && present(surface.Tooltip)
      && present(surface.IconCopyOutlineRegular)
      && present(surface.IconCheckOutlineRegular)
      && typeof surface.projectUserText === 'function'
      && typeof surface.fileSizeText === 'function'
      && typeof surface.writeClipboard === 'function',
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
  // The permission face reads the `remote.permissionPresets` catalog, the
  // forwarded invalidation event, and the live session's command face the
  // same lazy way; the capability detection lives in the installer.
  installPermissionSource(ctx)
  // The model face reads the host `modelDirectories` resolver (the same
  // per-session directories the native seat and /model popup use) the same
  // lazy way; a host build without model selection hides the face alone —
  // the service is deliberately not a declared inject dependency, which
  // would hold the whole plugin pending until it materializes.
  installModelSource(ctx)
  // The skill lexicon face (T9) reads the host `remote.skills` catalog —
  // the same hot `/` dictionary the native completion source polls — the
  // same lazy way; without it the chip decorations' `/` arm degrades to
  // plain text while the shape-only arms stay.
  installSkillSource(ctx)
  // The `@` completion popup's file search (T10) reads the host
  // `remote.fileReferences` namespace the same lazy way; without it the
  // popup face hides and typed `@` stays plain text.
  installFileReferenceSource(ctx)
  // The tool-row ① command menu reads the host `remote.commands` catalog
  // RPCs the same lazy way; a missed wiring here latches the face off for
  // the page life and the tool row silently stays on the paperclip
  // fallback (real-device regression #29).
  installCommandSource(ctx)
  // The feedback row's native semantics (issue #35) read the host
  // `feedbackUi` service the same lazy way: while the service is alive the
  // `+` menu / popup feedback row opens the session dialog instead of
  // inserting the claim token, mirroring the host's `/feedback` decoration;
  // a host build without ui-message-feedback keeps today's claim row.
  installFeedbackSource(ctx)
  // The goal strip (issue #34) reads the host `remote.goals` namespace the
  // same lazy way — the CAS mutation verbs plus the live activation read —
  // with the forwarded activation edges; without it the strip keeps
  // rendering and its buttons shed alone.
  installGoalSource(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'markdown-input: dictionaries')
  // The vendored picker's copy is the verbatim ui-model-selection dictionary
  // under the plugin's own namespace; the bound translate rides
  // model-face.ts into the component (bind is stable per namespace and reads
  // the active locale at call time — the same usage the host apply makes).
  ctx.effect(() => {
    const disposeModels = ctx.locale.register(MODEL_NS, { zh: modelZh, en: modelEn })
    setModelLocale(ctx.locale.bind(MODEL_NS))
    return disposeModels
  }, 'markdown-input: model dictionaries')
  // Card-level crash latch (ADR-0005): a render exception inside the card —
  // or an editor-face probe failure — funnels into the unified fallback
  // (degrade.ts), which latches the takeover off for the page life and
  // disposes this chain entry: the election collapses, the chain fallback
  // (the native composer) tops back in, and the machine draft the card
  // flushed on unmount survives. The latch outlives the entry — a later
  // session scope re-runs this inject thunk but must not re-attempt the
  // takeover; only reloading the browser half restarts it.
  let disposeEntry: (() => void) | undefined
  bindComposerCrash(() => {
    const dispose = disposeEntry
    disposeEntry = undefined
    dispose?.()
  })
  ctx.slots.inject('conversation.composer', () => {
    // Session latch: once degraded, the native composer stays for the rest
    // of the page life (ADR-0005 Q5).
    if (takeoverDegraded()) return () => {}
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
  // Gated on the primitives probe: a host build missing any composed value
  // (Markdown pipeline or copy/clock chrome) keeps the host's own renderers
  // — native bubbles with the native actions row.
  const messageCapability = userMessageCapability(primitives)
  if (messageCapability.supported) {
    for (const key of ['user', 'steering'] as const) {
      ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
        name: 'conversation.chat.node',
        key,
        priority: -1,
        locale: 'chat',
      }, MarkdownUserMessage))
    }
  } else {
    console.info(`[markdown-input] user-message Markdown rendering disabled: ${messageCapability.reason}`)
  }
  // Degradation notice (ADR-0005 Q5): quiet until the takeover falls back,
  // then the one-shot non-modal notice — event-driven over degrade.ts, so
  // it survives the card's unmount and never re-shows. The declared locale
  // delivers the `t` seat for the notice copy.
  ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
    name: 'conversation.composer.dock',
    id: 'markdown-input-fallback',
    locale: NS,
  }, FallbackNotice))
}
