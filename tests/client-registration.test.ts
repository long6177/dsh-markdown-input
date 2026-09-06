/**
 * Seam 0 (registration): the client `apply()` is the plugin's whole surface
 * toward the host slot registry, so it is asserted from the outside with a
 * recording `ctx` — the composer takeover lands at its negotiated priority,
 * and the chat-node seat is keyed replacement only: exactly the `user` and
 * `steering` keys, leaving every other node kind to the host's renderer.
 */
import { describe, expect, it } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { MarkdownUserMessage } from '../src/client/UserMessage.tsx'
import { NS } from '../src/client/locales.ts'

interface RecordedRegistration {
  name: string
  key?: string
  priority?: number
  select?: unknown
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
          priority: options.priority as number | undefined,
          select: options.select,
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
  it('touches only the composer and chat-node slots', () => {
    const { ctx, injected } = recordedContext()
    apply(ctx)
    expect([...new Set(injected)].sort()).toEqual(['conversation.chat.node', 'conversation.composer'])
  })

  it('takes over the composer at priority 2 with a constant selector', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const composer = registrations.find(entry => entry.name === 'conversation.composer')
    expect(composer).toBeDefined()
    expect(composer?.priority).toBe(2)
    expect(typeof composer?.select).toBe('function')
    expect(composer?.locale).toBe(NS)
  })

  it('replaces exactly the user and steering chat-node keys', () => {
    const { ctx, registrations } = recordedContext()
    apply(ctx)
    const chatSeats = registrations.filter(entry => entry.name === 'conversation.chat.node')
    // Every chat-node registration carries a key: an unkeyed one would catch
    // all node kinds and displace the host renderers wholesale.
    expect(chatSeats.map(entry => entry.key).sort()).toEqual(['steering', 'user'])
    for (const seat of chatSeats) {
      expect(seat.component).toBe(MarkdownUserMessage)
      expect(seat.locale).toBe('chat')
    }
  })

  it('registers the zh/en dictionaries under the plugin namespace', () => {
    const { ctx, dictionaries } = recordedContext()
    apply(ctx)
    expect(dictionaries).toEqual([[NS, { zh: expect.any(Object), en: expect.any(Object) }]])
  })
})
