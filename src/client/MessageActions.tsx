/**
 * The message actions row for the Markdown user-message seat: the copy /
 * clock chrome the host's `MessageIconActions` mounts on every user-style
 * bubble (#33). The host component is not on the public client surface, so
 * this rebuild mirrors its behavior against exported primitives — the
 * clipboard write with a one-second check swap and re-click guard, and the
 * start-position clock. The hover-reveal CSS keys off the host flow wrappers
 * (`data-chat-flow-kind`), which carry the native reveal contract (a later
 * user/steering row suppresses earlier rows' actions until hover/focus) to
 * this seat.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconCheckOutlineRegular, IconCopyOutlineRegular, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MessageActions.module.css'

/** The copy/clock share of the chat dictionary the row consumes. */
export type MessageActionsTranslate = Translate<'copy' | 'copied' | 'clock.md' | 'clock.ymd'>

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Midnight (ms) of the local calendar day `ms` falls into. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Delay until the next local midnight after `ms` (at least 1ms). */
function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/**
 * Compact local timestamp, the host clock: same calendar day → `HH:mm`;
 * earlier this year → the `clock.md` date template + clock; other years →
 * the `clock.ymd` template + clock. The date templates arrive through the
 * caller's locale seat.
 * @param time - Unix epoch ms from the source session event.
 * @param t - translate seat supplying the date templates.
 * @param now - Reference instant for the day/year cut (defaults to wall clock).
 */
export function formatMessageClock(
  time: number,
  t: Translate<'clock.md' | 'clock.ymd'>,
  now: number = Date.now(),
): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  return `${d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)} ${clock}`
}

/**
 * Local calendar-day epoch that advances at each local midnight — memoized
 * message rows keep stable props across the boundary, so the clock needs a
 * day seat that re-fires there.
 */
function useCalendarDay(): number {
  const [day, setDay] = useState(() => startOfLocalDay(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const arm = (): void => {
      const now = Date.now()
      setDay(startOfLocalDay(now))
      timer = setTimeout(arm, msUntilNextLocalMidnight(now))
    }
    timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()))
    return () => { clearTimeout(timer) }
  }, [])
  return day
}

/** Props of the rebuilt user-bubble actions row. */
export interface MessageActionsProps {
  /** Plain text the copy action writes (the message's raw wire text). */
  readonly text: string
  /** Unix epoch ms for the clock label; omitted hides the clock. */
  readonly time?: number | undefined
  /** The owning view's locale seat (the chat dictionary's copy/clock keys). */
  readonly t: MessageActionsTranslate
}

/**
 * The copy + start-clock row mounted under every Markdown user/steering
 * bubble. Copy success swaps the glyph to a check for one second — the same
 * guard as the host row: re-clicks during the window neither re-copy nor
 * stack timers, and a pending write outliving the row is dropped.
 * @param props - copy text, node time, and the chat locale seat.
 * @returns the actions row element.
 */
export function MessageActions({ text, time, t }: MessageActionsProps) {
  const day = useCalendarDay()
  const [copied, setCopied] = useState(false)
  const copyPending = useRef(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copyEpoch = useRef(0)
  useEffect(() => () => {
    copyEpoch.current += 1
    copyPending.current = false
    if (copyTimer.current !== null) clearTimeout(copyTimer.current)
  }, [])
  const onCopy = useCallback(() => {
    if (copied || copyPending.current) return
    const epoch = copyEpoch.current
    copyPending.current = true
    void writeClipboard(text).then((ok) => {
      if (epoch !== copyEpoch.current) return
      copyPending.current = false
      if (!ok) return
      setCopied(true)
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null
        setCopied(false)
      }, 1000)
    })
  }, [copied, text])
  const clockEl = time === undefined ? null : (
    <span className={css.timeStart}>{formatMessageClock(time, t, day)}</span>
  )
  return (
    <div className={css.actions} data-message-actions>
      {clockEl}
      <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
        <button type="button" className={css.action} aria-label={copied ? t('copied') : t('copy')} onClick={onCopy}>
          {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
        </button>
      </Tooltip>
    </div>
  )
}
