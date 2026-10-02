/**
 * Seam 0 (registration): the client `apply()` is the plugin's whole surface
 * toward the host slot registry, so it is asserted from the outside with a
 * recording `ctx` — the composer stays native (no composer entry at all,
 * ADR-0003), and the chat-node seat is keyed replacement only: exactly the
 * `user` and `steering` keys, gated on the primitives capability probe.
 */
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply, userMessageCapability } from '../src/client/index.ts'
import { MarkdownUserMessage } from '../src/client/UserMessage.tsx'
import { PaintDock } from '../src/client/PaintDock.tsx'
import { PasteDock } from '../src/client/PasteDock.tsx'

interface RecordedRegistration {
  name: string
  key?: string
  id?: string
  priority?: number
  locale?: string
  component: unknown
}

/** A context that runs `inject` thunks eagerly and records registrations. */
function recordedContext(): {
  ctx: ClientContext
  injected: readonly string[]
  registrations: readonly RecordedRegistration[]
  dictionaries: readonly unknown[][]
} {
  const injected: string[] = []
  const registrations: RecordedRegistration[] = []
  const dictionaries: unknown[][] = []
  const ctx = {
    effect(fn: () => unknown): unknown {
      return fn()
    },
    locale: {
      register(...args: unknown[]): () => void {
        dictionaries.push(args)
        return () => {}
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

describe('client apply registration', () => {
  it('leaves the composer native — no composer entry is registered', () => {
    const { ctx, injected, registrations } = recordedContext()
    apply(ctx)
    expect(injected).not.toContain('conversation.composer')
    expect(registrations.filter(entry => entry.name === 'conversation.composer')).toEqual([])
  })

  it('touches only the chat-node slot and the composer dock', () => {
    const { ctx, injected } = recordedContext()
    apply(ctx)
    expect([...new Set(injected)].sort()).toEqual(['conversation.chat.node', 'conversation.composer.dock'])
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

  it('occupies the composer dock with the paste and paint entries', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const docks = registrations.filter(entry => entry.name === 'conversation.composer.dock')
    expect(docks).toHaveLength(2)
    // List-slot occupants: stable ids, default priority (render order is
    // irrelevant for invisible anchors), and no locale of their own. Each
    // dock owns its capability probe — registration is unconditional, the
    // same idiom as the paste layer at HEAD.
    expect(docks.map(entry => entry.id).sort()).toEqual(['markdown-input-paint', 'markdown-input-paste'])
    for (const dock of docks) {
      expect(dock.key).toBeUndefined()
      expect(dock.locale).toBeUndefined()
    }
    expect(docks.find(entry => entry.id === 'markdown-input-paste')?.component).toBe(PasteDock)
    expect(docks.find(entry => entry.id === 'markdown-input-paint')?.component).toBe(PaintDock)
  })

  it('ships no dictionaries of its own — seat copy rides the host chat namespace', () => {
    const { ctx, dictionaries } = recordedContext()
    apply(ctx)
    expect(dictionaries).toEqual([])
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
