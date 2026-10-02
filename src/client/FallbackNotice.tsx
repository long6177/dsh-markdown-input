/**
 * The one-shot degradation notice (ADR-0005 Q5): a `conversation.composer.
 * dock` occupant — mounted beside the composer card, independent of the
 * takeover election, so it survives the card's unmount — that renders a
 * non-modal light notice when the takeover falls back (fallbackToNative),
 * dismisses itself after a few seconds, and never re-shows: the card-level
 * latch makes the fallback one-shot per page life, and this dock is purely
 * event-driven, so remounts (session switches) stay quiet.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { IconWarningOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { onTakeoverDegrade, takeDegradeNotice, type DegradeEvent } from './degrade.ts'
import { NS } from './locales.ts'
import css from './FallbackNotice.module.css'

/** How long the degradation notice stays before dismissing itself. */
export const DEGRADE_NOTICE_MS = 6000

/**
 * The fallback notice dock: quiet until the takeover degrades, then a
 * single transient status line.
 * @param props - locale share (the dock registration declares the namespace).
 * @returns the notice while it shows; nothing otherwise.
 */
export function FallbackNotice({ t }: PropsLocale<typeof NS>): ReactNode {
  const [event, setEvent] = useState<DegradeEvent | null>(null)
  useEffect(() => {
    // Catch-up first: a fallback that fired before this subscription
    // existed — a first-mount card crash reports during the commit, before
    // passive effects run — left a pending notice; take it exactly once.
    const pending = takeDegradeNotice()
    if (pending !== null) setEvent(pending)
    return onTakeoverDegrade(setEvent)
  }, [])
  useEffect(() => {
    if (event === null) return undefined
    const timer = window.setTimeout(() => {
      setEvent(null)
    }, DEGRADE_NOTICE_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [event])
  if (event === null) return null
  return (
    <div className={css.notice} role="status" data-markdown-fallback-notice>
      <IconWarningOutlineMedium size={14} />
      <span className={css.noticeText}>{t('composer.fallback.notice')}</span>
    </div>
  )
}
