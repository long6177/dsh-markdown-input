/**
 * Seam 1 (chat side): the rebuilt message actions row — the copy/clock chrome
 * the host's MessageIconActions mounts on every user-style bubble — tested
 * from the outside: clock formatting, copy feedback timing, and the write
 * guard, against the real primitives `writeClipboard` path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { formatMessageClock, MessageActions } from '../src/client/MessageActions.tsx'
import type { MessageActionsProps } from '../src/client/MessageActions.tsx'
import actionsCss from '../src/client/MessageActions.module.css'
import { installClipboardStub } from './clipboard-stub.ts'

const t = vi.fn((key: string) => key)

/** The clipboard stub installers; each test picks its write verdict. */
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve(true))
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function actionsProps(extra: Partial<MessageActionsProps> = {}): MessageActionsProps {
  return { text: 'hello', time: 0, t: t as unknown as MessageActionsProps['t'], ...extra }
}

/** Local-epoch ms for a fixed wall clock so the day cut is deterministic. */
function localMs(y: number, m: number, d: number, hh = 0, mm = 0): number {
  return new Date(y, m - 1, d, hh, mm).getTime()
}

describe('formatMessageClock', () => {
  it('renders HH:mm on the same calendar day', () => {
    const now = localMs(2026, 10, 4, 12, 0)
    const time = localMs(2026, 10, 4, 9, 5)
    expect(formatMessageClock(time, t, now)).toBe('09:05')
    expect(t).not.toHaveBeenCalledWith('clock.md', expect.anything())
  })

  it('uses the clock.md template for earlier days of the current year', () => {
    const now = localMs(2026, 10, 4)
    const time = localMs(2026, 3, 8, 21, 30)
    expect(formatMessageClock(time, t, now)).toBe('clock.md 21:30')
    expect(t).toHaveBeenCalledWith('clock.md', { y: 2026, m: 3, d: 8 })
  })

  it('uses the clock.ymd template for other years', () => {
    const now = localMs(2026, 10, 4)
    const time = localMs(2025, 12, 31, 23, 59)
    expect(formatMessageClock(time, t, now)).toBe('clock.ymd 23:59')
    expect(t).toHaveBeenCalledWith('clock.ymd', { y: 2025, m: 12, d: 31 })
  })
})

describe('MessageActions', () => {
  let restoreClipboard: () => void
  beforeEach(() => {
    restoreClipboard = installClipboardStub(writeText)
  })
  afterEach(() => {
    restoreClipboard()
  })

  it('renders the copy button and the start-position clock', () => {
    const { container, getByRole } = render(<MessageActions {...actionsProps({ time: localMs(2026, 10, 4, 9, 5) })} />)
    expect(getByRole('button', { name: 'copy' })).toBeInTheDocument()
    const row = container.querySelector('[data-message-actions]')
    expect(row).not.toBeNull()
    expect(row?.querySelector(`.${actionsCss.timeStart}`)?.textContent).toBe('09:05')
  })

  it('omits the clock without a time', () => {
    const { container } = render(<MessageActions {...actionsProps({ time: undefined })} />)
    expect(container.querySelector('[data-message-actions]')?.children).toHaveLength(1)
  })

  it('swaps the icon to the check for one second after a successful write', async () => {
    vi.useFakeTimers()
    const view = render(<MessageActions {...actionsProps()} />)
    const button = view.getByRole('button', { name: 'copy' })
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(view.getByRole('button', { name: 'copied' })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(view.getByRole('button', { name: 'copy' })).toBeInTheDocument()
  })

  it('keeps the copy icon when the write is refused', async () => {
    writeText.mockReturnValue(Promise.reject(new Error('denied')))
    const view = render(<MessageActions {...actionsProps()} />)
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'copy' }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(view.getByRole('button', { name: 'copy' })).toBeInTheDocument()
    expect(view.queryByRole('button', { name: 'copied' })).toBeNull()
  })

  it('does not re-write while the copied window is open', async () => {
    vi.useFakeTimers()
    const view = render(<MessageActions {...actionsProps()} />)
    const button = view.getByRole('button', { name: 'copy' })
    await act(async () => {
      fireEvent.click(button)
      await Promise.resolve()
      await Promise.resolve()
    })
    fireEvent.click(view.getByRole('button', { name: 'copied' }))
    fireEvent.click(view.getByRole('button', { name: 'copied' }))
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
