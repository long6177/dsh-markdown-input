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
import { ContextMeterFace } from '../src/client/ContextMeterFace.tsx'
import { CONTEXT_NS } from '../src/client/context-meter-face.ts'
import { agentPresetsRemoteFace, resetAgentPresetsSource } from '../src/client/agent-preset-face.ts'
import { resetWorkspaceVerbSource, workspaceVerbFace } from '../src/client/workspace-verb.ts'

interface RecordedRegistration {
  name: string
  key?: string
  id?: string
  priority?: number
  order?: number
  locale?: string
  component: unknown
}

/** A context that runs `inject` thunks eagerly and records registrations. */
function recordedContext(options: {
  remote?: unknown
  remoteCommands?: unknown
  remoteAgentPresets?: unknown
  uiWorkspace?: unknown
} = {}): {
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
      // The host gateway installs namespaces as `remote.<ns>` services; the
      // bare `remote` service carries only `$on`/`$mount`.
      if (key === 'remote.commands') return options.remoteCommands
      if (key === 'remote.agentPresets') return options.remoteAgentPresets
      if (key === 'uiWorkspace') return options.uiWorkspace
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
          order: options.order as number | undefined,
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
  resetWorkspaceVerbSource()
  resetAgentPresetsSource()
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
    // a missed installer (or a wrong surface shape) latches its FaceGate
    // verdict off for the page life and the tool row silently renders the
    // fallback attach button (#29). The host shape: the namespace is its own
    // `remote.commands` service, the bare `remote` service only carries `$on`.
    const remoteCommands = { list: () => {}, execute: () => {} }
    const { ctx } = recordedContext({ remote: { $on: () => () => {} }, remoteCommands })
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

  it('leaves the composer dock to the fallback notice; the meter rides the card (#43)', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const docks = registrations.filter(entry => entry.name === 'conversation.composer.dock')
    // The context meter is NOT a dock occupant: the host only mounts
    // `conversation.composer.dock` from inside its InputBar
    // (ui-conversation InputBar.tsx:499-504), so once the takeover hides the
    // fallback the slot is never rendered and any occupant on it is dead
    // (the #43 real-device failure). The meter renders from the card itself,
    // in the card's own dock row below the face. The one-shot fallback
    // notice keeps its seat — it shows exactly when the native bar is back.
    expect(docks).toHaveLength(1)
    expect(docks[0]).toMatchObject({
      id: 'markdown-input-fallback',
      component: FallbackNotice,
      locale: NS,
      key: undefined,
    })
    expect(docks.map(dock => dock.component)).not.toContain(ContextMeterFace)
  })

  it('binds the host conversation copy for the context meter without registering it', () => {
    const { ctx, dictionaries } = recordedContext()
    apply(ctx)
    // The meter's words are the host `conversation` namespace's own keys
    // (`context.*`, `number.*`); the plugin registers NO dictionary under it —
    // a duplicate registration would shadow the host's copy in the locale
    // plugin's merge chain. The card-top workspace row (#42) reads the same
    // seat for its own keys, so it registers nothing either.
    expect(dictionaries.map(entry => entry[0])).not.toContain(CONTEXT_NS)
    expect(CONTEXT_NS).toBe('conversation')
  })

  it('wires the workspace-row verb and the agent-preset roster sources (issue #42)', () => {
    // The hero seats' installers bind lazy resolvers; apply() must wire both —
    // a missed installer latches the row off for the page life, which is
    // indistinguishable from a correct row that found no workspace.
    const uiWorkspace = { startSession: () => {} }
    const agentPresets = { list: () => {}, select: () => {} }
    const { ctx } = recordedContext({ remoteAgentPresets: agentPresets, uiWorkspace })
    apply(ctx)
    expect(typeof workspaceVerbFace()?.startSession).toBe('function')
    expect(agentPresetsRemoteFace()).toBe(agentPresets)
  })

  it('leaves the hero seats hidden when the host lacks ui-workspace or the preset registry', () => {
    const { ctx } = recordedContext()
    apply(ctx)
    expect(workspaceVerbFace()).toBeUndefined()
    expect(agentPresetsRemoteFace()).toBeUndefined()
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
    // seats, and the dock occupant (the fallback notice) are not part of the
    // latch; the context meter rides the card, which the latch covers.
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
    Tooltip: () => null,
    writeClipboard: () => Promise.resolve(true),
    IconCopyOutlineRegular: () => null,
    IconCheckOutlineRegular: () => null,
  }

  it('supports a complete primitives surface', () => {
    expect(userMessageCapability(full).supported).toBe(true)
  })

  it('disables when any probed value is missing', () => {
    for (const key of [
      'MarkdownText', 'projectUserText', 'FileTypeIcon', 'fileSizeText', 'JsonBlock',
      'Tooltip', 'writeClipboard', 'IconCopyOutlineRegular', 'IconCheckOutlineRegular',
    ] as const) {
      const { [key]: _, ...surface } = full
      void _
      const verdict = userMessageCapability(surface)
      expect(verdict.supported, `dropping ${key} must disable`).toBe(false)
      expect(verdict.reason).toContain('Markdown surface')
    }
  })
})
