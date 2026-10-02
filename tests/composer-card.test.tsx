/**
 * Card-level crash containment (ADR-0005): a render exception inside the
 * takeover card must never escape into the host shell. The boundary
 * swallows the frame and funnels into the unified fallback (degrade.ts),
 * which reports the reason, latches the takeover off for the page life,
 * fires the one-shot notice event, and — through the action the apply
 * installed — disposes the `conversation.composer` entry, so the chain's
 * election collapses and the native composer tops back in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import {
  bindComposerCrash, fallbackToNative, onTakeoverDegrade,
  resetTakeoverDegradation, takeoverDegraded,
} from '../src/client/degrade.ts'
import { TakeoverCard } from '../src/client/composer-card.tsx'
import type { MarkdownComposerProps } from '../src/client/MarkdownComposer.tsx'

/** A context that runs inject thunks eagerly and records register disposers. */
function recordedContext(): { ctx: ClientContext, disposers: readonly ReturnType<typeof vi.fn>[] } {
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  const ctx = {
    effect(fn: () => unknown): unknown {
      return fn()
    },
    locale: {
      register(): () => void {
        return () => {}
      },
    },
    slots: {
      inject(_name: string, register: () => void): void {
        register()
      },
      register(): () => void {
        const dispose = vi.fn()
        disposers.push(dispose)
        return dispose
      },
    },
  } as unknown as ClientContext
  return { ctx, disposers }
}

/**
 * Props that crash the takeover card mid-render with a fault the editor
 * face probe cannot see coming (the manually injected fault the acceptance
 * criteria call for): the runtime faces are present, so the probe passes
 * and the card mounts — then the input hook explodes at first call.
 */
function crashingProps(): MarkdownComposerProps {
  return {
    matched: { kind: 'markdown' },
    useInput: (): never => {
      throw new Error('host input face exploded')
    },
    inputActions: { setDraft: (): void => {}, submit: (): void => {} },
  } as unknown as MarkdownComposerProps
}

afterEach(() => {
  cleanup()
  bindComposerCrash(undefined)
  resetTakeoverDegradation()
  vi.restoreAllMocks()
})

describe('composer card crash containment', () => {
  it('swallows a render exception: null render, console report, crash callback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCrash = vi.fn()
    bindComposerCrash(onCrash)
    const { container } = render(<TakeoverCard {...crashingProps()} />)
    expect(container).toBeEmptyDOMElement()
    expect(onCrash).toHaveBeenCalledTimes(1)
    expect(onCrash.mock.calls[0]?.[0]).toBeInstanceOf(Error)
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('takeover card crashed')))
      .toBe(true)
  })

  it('apply wires the crash callback to disposing the composer chain entry', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx, disposers } = recordedContext()
    apply(ctx)
    // The composer entry is the first registration apply makes.
    const composerDispose = disposers[0]
    expect(composerDispose).toBeDefined()
    render(<TakeoverCard {...crashingProps()} />)
    expect(composerDispose).toHaveBeenCalledTimes(1)
    // A second crash must not re-dispose: the latch is one-way per entry.
    render(<TakeoverCard {...crashingProps()} />)
    expect(composerDispose).toHaveBeenCalledTimes(1)
  })

  it('a disposed entry stops disposing: re-registration restarts fresh', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx, disposers } = recordedContext()
    apply(ctx)
    const [, chatNodeDispose] = disposers
    render(<TakeoverCard {...crashingProps()} />)
    // Only the composer entry's disposer ran; the chat-node and dock
    // registrations stay untouched by the card crash.
    expect(chatNodeDispose).not.toHaveBeenCalled()
  })

  it('a caught crash latches the takeover degraded and announces it once', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const events: string[] = []
    const unsubscribe = onTakeoverDegrade((event) => {
      events.push(event.reason)
    })
    bindComposerCrash(vi.fn())
    render(<TakeoverCard {...crashingProps()} />)
    unsubscribe()
    expect(takeoverDegraded()).toBe(true)
    expect(events).toEqual([expect.stringContaining('takeover card crashed')])
  })
})

describe('unified card fallback (degrade.ts)', () => {
  it('the editor-face fallback path disposes the entry through the same action', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { ctx, disposers } = recordedContext()
    apply(ctx)
    fallbackToNative('editor face probe failed (setDraft missing)')
    expect(disposers[0]).toHaveBeenCalledTimes(1)
    expect(takeoverDegraded()).toBe(true)
  })
})
