/**
 * The one-shot degradation notice (ADR-0005 Q5): quiet until the takeover
 * falls back, then a single non-modal status line that dismisses itself —
 * and never re-shows, because the card latch makes the fallback one-shot
 * per page life and the dock is purely event-driven.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { FallbackNotice, DEGRADE_NOTICE_MS } from '../src/client/FallbackNotice.tsx'
import { degradeTakeover, resetTakeoverDegradation } from '../src/client/degrade.ts'
import { en, type ComposerKey } from '../src/client/locales.ts'

function noticeProps(): { t: (key: ComposerKey) => string } {
  return { t: (key) => en[key] }
}

afterEach(() => {
  cleanup()
  resetTakeoverDegradation()
  vi.restoreAllMocks()
})

describe('FallbackNotice', () => {
  it('renders nothing before any degradation', () => {
    const { container } = render(<FallbackNotice {...noticeProps()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the non-modal notice when the takeover degrades', () => {
    const { container } = render(<FallbackNotice {...noticeProps()} />)
    act(() => {
      degradeTakeover('editor face probe failed (setDraft missing)')
    })
    const notice = container.querySelector('[data-markdown-fallback-notice]')
    expect(notice).not.toBeNull()
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice?.textContent).toContain(en['composer.fallback.notice'])
  })

  it('catches up on a fallback that fired before the dock mounted', () => {
    // The first-mount crash shape: the card boundary reports during the
    // commit, before this dock's subscription exists — the pending notice
    // is taken at mount time instead.
    act(() => {
      degradeTakeover('editor face probe failed (setDraft missing)')
    })
    const { container } = render(<FallbackNotice {...noticeProps()} />)
    const notice = container.querySelector('[data-markdown-fallback-notice]')
    expect(notice).not.toBeNull()
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice?.textContent).toContain(en['composer.fallback.notice'])
  })

  it('dismisses itself after the notice window', () => {
    vi.useFakeTimers()
    try {
      const { container } = render(<FallbackNotice {...noticeProps()} />)
      act(() => {
        degradeTakeover('editor face probe failed')
      })
      expect(container.querySelector('[data-markdown-fallback-notice]')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(DEGRADE_NOTICE_MS)
      })
      expect(container.querySelector('[data-markdown-fallback-notice]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays quiet on remount: the notice is one-shot per page life', () => {
    const view = render(<FallbackNotice {...noticeProps()} />)
    act(() => {
      degradeTakeover('editor face probe failed')
    })
    expect(view.container.querySelector('[data-markdown-fallback-notice]')).not.toBeNull()
    view.unmount()
    const remounted = render(<FallbackNotice {...noticeProps()} />)
    expect(remounted.container).toBeEmptyDOMElement()
  })
})
