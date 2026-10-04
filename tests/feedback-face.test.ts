/**
 * Seam: the `feedbackUi` capability door of the `+` menu and the `/`
 * completion popup (issue #35). The host's ui-message-feedback plugin
 * decorates the `feedback` host command with an action that opens the
 * session feedback dialog, and that decoration outranks the command's
 * `input` claim in the host dispatch table; this plugin owns the row, so it
 * must read the same service (`ctx.get('feedbackUi')`) and call the same
 * verb. The rules pinned here are the face's whole contract: lazy per-call
 * resolution (boot order stays free), a missing or malformed service reads
 * as absent without throwing, a service that dies between assembly and pick
 * is a silent no-op (never a card crash), and `apply()` wires the installer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  feedbackUiSupported, installFeedbackSource, openFeedbackSession,
  resetFeedbackSource, setFeedbackSource,
} from '../src/client/feedback-face.ts'
import { apply } from '../src/client/index.ts'
import { resetTakeoverDegradation } from '../src/client/degrade.ts'

afterEach(() => {
  resetFeedbackSource()
  resetTakeoverDegradation()
})

/** A context whose only interesting read is the `feedbackUi` service. */
function ctxWithFeedback(value: unknown, options: { throwOnRead?: boolean } = {}): ClientContext {
  return {
    get(key: string): unknown {
      if (key !== 'feedbackUi') return undefined
      if (options.throwOnRead === true) throw new Error('service read exploded')
      return value
    },
  } as unknown as ClientContext
}

describe('feedbackUi capability probe', () => {
  it('reads the service as absent before apply binds a source', () => {
    expect(feedbackUiSupported()).toBe(false)
  })

  it('supports the host service shape with its single openSession verb', () => {
    installFeedbackSource(ctxWithFeedback({ openSession: () => {} }))
    expect(feedbackUiSupported()).toBe(true)
  })

  it('degrades when the service is missing, null, or has no openSession', () => {
    for (const value of [undefined, null, {}, { openSession: 'nope' }]) {
      installFeedbackSource(ctxWithFeedback(value))
      expect(feedbackUiSupported(), `value ${JSON.stringify(value)}`).toBe(false)
      resetFeedbackSource()
    }
  })

  it('degrades when the service read itself throws (sealed host builds)', () => {
    installFeedbackSource(ctxWithFeedback(undefined, { throwOnRead: true }))
    expect(feedbackUiSupported()).toBe(false)
  })

  it('resolves per call, so a service that activates after apply is picked up', () => {
    // The decoration owner may activate after this plugin (lazy resolution is
    // the whole reason the service is not a declared inject dependency).
    let service: unknown
    installFeedbackSource(ctxWithFeedback(undefined))
    setFeedbackSource(() => (service === undefined ? undefined : service as { openSession: () => void }))
    expect(feedbackUiSupported()).toBe(false)
    service = { openSession: () => {} }
    expect(feedbackUiSupported()).toBe(true)
  })
})

describe('openFeedbackSession', () => {
  it('calls the host openSession with the owning session id', () => {
    const openSession = vi.fn()
    installFeedbackSource(ctxWithFeedback({ openSession }))
    openFeedbackSession('s1' as never)
    expect(openSession).toHaveBeenCalledExactlyOnceWith('s1')
  })

  it('is a silent no-op without a session or without the service', () => {
    const openSession = vi.fn()
    installFeedbackSource(ctxWithFeedback({ openSession }))
    openFeedbackSession(undefined)
    expect(openSession).not.toHaveBeenCalled()
    // The service vanishes between assembly and pick: no throw, no call.
    resetFeedbackSource()
    expect(() => { openFeedbackSession('s1' as never) }).not.toThrow()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('contains a throwing host verb instead of crashing the card', () => {
    const openSession = vi.fn(() => { throw new Error('dialog exploded') })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      installFeedbackSource(ctxWithFeedback({ openSession }))
      expect(() => { openFeedbackSession('s1' as never) }).not.toThrow()
      expect(openSession).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('client apply wiring (#35)', () => {
  it('installs the feedback source so the feedback row can upgrade', () => {
    // A missed installer would leave the feedback row a claim row on a host
    // whose native decoration opens the dialog — the same wiring-contract
    // rule client-registration.test.ts asserts for the command face.
    const feedbackUi = { openSession: vi.fn() }
    apply(fakeApplyContext(feedbackUi))
    expect(feedbackUiSupported()).toBe(true)
    openFeedbackSession('s9' as never)
    expect(feedbackUi.openSession).toHaveBeenCalledExactlyOnceWith('s9')
  })
})

/** The minimum client context `apply()` touches, with the feedback service seeded. */
function fakeApplyContext(feedbackUi: unknown): ClientContext {
  const noop = (): (() => void) => () => {}
  return {
    get(key: string): unknown {
      return key === 'feedbackUi' ? feedbackUi : undefined
    },
    effect: noop,
    on: () => {},
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
    },
    slots: {
      inject: (_name: string, register: () => void) => { register() },
      register: () => () => {},
    },
  } as unknown as ClientContext
}
