/**
 * Seam 0 (registration): the client `apply()` is the plugin's whole surface
 * toward the host slot registry, so it is asserted from the outside with a
 * recording `ctx` — the composer is taken over through ONE low-priority
 * chain entry (built-in panels outrank it, ADR-0005), dictionaries ship,
 * and the chat-node seat is keyed replacement only: exactly the `user` and
 * `steering` keys, gated on the primitives capability probe.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, userMessageCapability } from '../src/client/index.ts'
import { MarkdownUserMessage } from '../src/client/UserMessage.tsx'
import { TakeoverCard } from '../src/client/composer-card.tsx'
import { degradeTakeover, resetTakeoverDegradation } from '../src/client/degrade.ts'
import { commandFaceSupported, resetCommandFace } from '../src/client/command-face.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import { en as modelEn, zh as modelZh } from '../src/client/ModelSelectFace.locales.ts'
import { MODEL_NS } from '../src/client/model-face.ts'
import { FallbackNotice } from '../src/client/FallbackNotice.tsx'

interface RecordedRegistration {
  name: string
  key?: string
  id?: string
  priority?: number
  locale?: string
  component: unknown
}

/** A context that runs `inject` thunks eagerly and records registrations. */
function recordedContext(options: { remote?: unknown } = {}): {
  ctx: ClientContext
  injected: readonly string[]
  registrations: readonly RecordedRegistration[]
  dictionaries: readonly unknown[][]
} {
  const injected: string[] = []
  const registrations: RecordedRegistration[] = []
  const dictionaries: unknown[][] = []
  const ctx = {
    get(key: string): unknown {
      return key === 'remote' ? options.remote : undefined
    },
    effect(fn: () => unknown): unknown {
      return fn()
    },
    locale: {
      register(...args: unknown[]): () => void {
        dictionaries.push(args)
        return () => {}
      },
      bind(ns: string): (key: string) => string {
        return (key: string) => `${ns}:${key}`
      },
    },
    slots: {
      inject(name: string, register: () => void): void {
        injected.push(name)
        register()
      },
      register(options: Record<string, unknown>, component: unknown): () => void {
        registrations.push({
          name: options.name as string,
          key: options.key as string | undefined,
          id: options.id as string | undefined,
          priority: options.priority as number | undefined,
          locale: options.locale as string | undefined,
          component,
        })
        return () => {}
      },
    },
  } as unknown as ClientContext
  return { ctx, injected, registrations, dictionaries }
}

afterEach(() => {
  resetTakeoverDegradation()
  resetCommandFace()
})

describe('client apply registration', () => {
  it('takes over the composer through one low-priority chain entry', () => {
    const { ctx, injected, registrations } = recordedContext()
    apply(ctx)
    expect(injected).toContain('conversation.composer')
    const composer = registrations.filter(entry => entry.name === 'conversation.composer')
    expect(composer).toHaveLength(1)
    // The chain tries entries in ascending priority (lower first): approvals
    // register at 1 and the subagent read-only composer at -10, so both try
    // BEFORE the Markdown card and keep their elections; the card's 2 still
    // precedes the native fallback body.
    expect(composer[0]?.priority).toBe(2)
    expect(composer[0]?.locale).toBe(NS)
    expect(composer[0]?.component).toBe(TakeoverCard)
  })

  it('wires the command-menu face source so the tool-row ① probe can pass', () => {
    // The face installers bind lazy resolvers; apply() must wire every one —
    // a missed installer latches its FaceGate verdict off for the page life
    // and the tool row silently renders the fallback attach button (#29).
    const remote = { commands: { list: () => {}, execute: () => {} } }
    const { ctx } = recordedContext({ remote })
    apply(ctx)
    expect(commandFaceSupported()).toBe(true)
  })

  it('the command-menu face stays degraded when the host lacks the namespace', () => {
    const { ctx } = recordedContext()
    apply(ctx)
    expect(commandFaceSupported()).toBe(false)
  })

  it('touches only the composer chain, chat-node slot, and composer dock', () => {
    const { ctx, injected } = recordedContext()
    apply(ctx)
    expect([...new Set(injected)].sort())
      .toEqual(['conversation.chat.node', 'conversation.composer', 'conversation.composer.dock'])
  })

  it('replaces exactly the user and steering chat-node keys', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const chatSeats = registrations.filter(entry => entry.name === 'conversation.chat.node')
    // Every chat-node registration carries a key: an unkeyed one would catch
    // all node kinds and displace the host renderers wholesale.
    expect(chatSeats.map(entry => entry.key).sort()).toEqual(['steering', 'user'])
    // The host registers the same keys at default priority 0 and the
    // registry throws on same-key-same-priority; we shadow at a lower rank.
    for (const seat of chatSeats) {
      expect(seat.priority).toBe(-1)
      expect(seat.component).toBe(MarkdownUserMessage)
      expect(seat.locale).toBe('chat')
    }
  })

  it('occupies the composer dock with the fallback-notice entry alone', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const docks = registrations.filter(entry => entry.name === 'conversation.composer.dock')
    // T7 retired the paste/paint dock occupants; the notice is the only one
    // left, and the only dock that declares a locale namespace (its copy).
    expect(docks).toHaveLength(1)
    expect(docks[0]).toMatchObject({
      id: 'markdown-input-fallback',
      component: FallbackNotice,
      locale: NS,
      key: undefined,
    })
  })

  it('ships the markdown-input dictionaries (zh/en) for the card copy', () => {
    const { ctx, dictionaries } = recordedContext()
    apply(ctx)
    // Two namespaces: the card copy, and the vendored model picker's verbatim
    // ui-model-selection dictionary under the plugin's own namespace (the
    // host `model` namespace stays untouched).
    expect(dictionaries).toEqual([
      [NS, { zh, en }],
      [MODEL_NS, { zh: modelZh, en: modelEn }],
    ])
  })

  it('the session latch: a degraded takeover never re-registers, the rest still does', () => {
    // Degraded earlier in the page life (boundary crash, editor-face probe
    // failure): re-running apply — a later session scope's re-inject — must
    // not re-attempt the takeover (ADR-0005 Q5). Dictionaries, chat-node
    // seats, and the dock occupant (the fallback notice) are not part of
    // the latch.
    degradeTakeover('editor face probe failed (setDraft missing)')
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const names = registrations.map(entry => entry.name)
    expect(names).not.toContain('conversation.composer')
    expect(names).toContain('conversation.chat.node')
    expect(names).toContain('conversation.composer.dock')
    expect(registrations.filter(entry => entry.name === 'conversation.composer.dock')).toHaveLength(1)
  })
})

describe('userMessageCapability gate', () => {
  const full = {
    MarkdownText: () => null,
    projectUserText: () => null,
    FileTypeIcon: () => null,
    fileSizeText: () => '',
    JsonBlock: () => null,
  }

  it('supports a complete primitives surface', () => {
    expect(userMessageCapability(full).supported).toBe(true)
  })

  it('disables when any composed value is missing', () => {
    const { FileTypeIcon, ...withoutIcons } = full
    void FileTypeIcon
    const verdict = userMessageCapability(withoutIcons)
    expect(verdict.supported).toBe(false)
    expect(verdict.reason).toContain('Markdown surface')
  })
})
