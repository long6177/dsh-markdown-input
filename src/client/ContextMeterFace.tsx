/**
 * The takeover card's context-occupancy meter (issue #43): the card's rebuild
 * of the native ContextMeter, the ring + percentage that the native InputBar
 * renders in its root `.dock` directly below the composer card. The takeover
 * card wins the composer chain and replaces that whole fallback subtree, so
 * the scale vanished with it; this face re-seats it as an occupant of the
 * AMBIENT slot below the card — `conversation.composer.dock`, the same slot
 * the host's own stats pills and this plugin's fallback notice occupy — which
 * is the native position rather than a facsimile inside the card.
 *
 * Vendored from dsh `ui-conversation/src/client/skeleton/ContextMeter.tsx`
 * (0.2.0-rc.2, the host component is not exported): the ring geometry
 * (14px viewBox, 2px stroke, dasharray from the percent), the Tooltip and
 * accessible name (`context.aria`), the portal panel's headline split on a
 * locale-owned reading slot, the `~used / window` compact figures, the
 * heuristic segment bar, the `dl` detail rows, `useAnchoredPosition`
 * (side top) + `useDismissOnOutsidePointer`, Escape close, the capacity-loss
 * auto-close, and `return null` while the occupancy is unknown. The seams the
 * takeover adaptation needs: the two projection keys are read STRUCTURALLY
 * (the host token-meter client types are not in this plugin's dependency
 * graph — see context-occupancy.ts), and the copy is the host `conversation`
 * namespace's own `context.*` / `number.*` keys through the translate seat
 * apply binds (context-meter-face.ts) — zero self-translation.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  Tooltip, useAnchoredPosition, useDismissOnOutsidePointer,
  type TooltipSide,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ContextBreakdownView, ContextPressureView, ContextTranslate,
} from './context-occupancy.ts'
import { contextOccupancy, formatTokens } from './context-occupancy.ts'
import css from './ContextMeterFace.module.css'

/** Ring geometry, verbatim from the host: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Marker the localized occupancy sentence is split on, so the panel headline
 * keeps the reading in its own tone while each locale still owns the word
 * order (`45% of context used` / `上下文已用 45%` — the host's own device).
 */
const READING_SLOT = '\u0000'

/** How long the hover tooltip waits; the host's own 200ms. */
const TOOLTIP_DELAY_MS = 200

/** Bubble placement of the accessible-name tooltip (the host's `side="top"`). */
const TOOLTIP_SIDE: TooltipSide = 'top'

/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
const ROWS = [
  { key: 'systemTokens', label: 'context.system', color: css.colorSystem },
  { key: 'toolsTokens', label: 'context.tools', color: css.colorTools },
  { key: 'messageTokens', label: 'context.messages', color: css.colorMessages },
] as const

/**
 * Read one pressure projection value. The host `useProjection` standard seat
 * is generic over the host's projection-key map; this plugin declares no such
 * dependency, so the seat is typed at the key the meter consumes and the value
 * is narrowed by the structural view in context-occupancy.ts.
 */
export type ContextPressureReader = (
  key: 'contextPressure',
) => ContextPressureView | null | undefined

/** The breakdown half of the same seat (a separate key, a separate value shape). */
export type ContextBreakdownReader = (
  key: 'contextBreakdown',
) => ContextBreakdownView | null | undefined

/** Props of the meter as the `conversation.composer.dock` slot delivers them. */
export interface ContextMeterFaceProps {
  /**
   * The session's projection seat, one hook call per key. A session-scoped
   * slot occupant receives it from the renderer's session standard kit — the
   * same kit `sessionId` rides, injected into every session-scope occupant on
   * this host build (ui-session's `BUILTIN_SOURCE` keyed hook).
   */
  readonly useProjection: ContextPressureReader & ContextBreakdownReader
  /** The `conversation` translate seat the plugin binds in apply. */
  readonly t: ContextTranslate
}

/**
 * The context meter occupant, or null while it has nothing to show.
 * @param props - the projection seat and the conversation translate seat.
 * @returns the ring and its click-open composition panel; nothing when the
 * pressure projection, its capacity, or the translate seat is absent.
 */
export function ContextMeterFace({ useProjection, t }: ContextMeterFaceProps): ReactNode {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const context = contextOccupancy(pressure)
  const available = context !== null
  const position = useAnchoredPosition({
    open: open && available,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: 8,
    margin: 12,
  })
  useDismissOnOutsidePointer(rootRef, open && available, setOpen, panelRef)

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI
  // (native parity: the host's own effect does exactly this).
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  useEffect(() => {
    if (!open || !available) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [available, open])

  if (context === null) return null
  const percent = context.percent
  const reading = `${percent}%`
  // The headline brackets the reading, so a locale that needs no leading (or
  // trailing) text collapses that side through `.headline:empty`.
  const [headBefore = '', headAfter = ''] = t('context.aria', { percent: READING_SLOT })
    .split(READING_SLOT)
    .map(part => part.trim())

  // The bar's overall length stays the provider-exact percent; the heuristic
  // breakdown only proportions its colored parts. A zero-width part is dropped
  // instead of rendered: `.segment`'s min-width keeps a hairline part visible,
  // which at 0% occupancy would draw a filled bar over an empty context.
  const breakdownTotal = breakdown === null || breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const parts = breakdown === null || breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: undefined, width: percent }]
    : ROWS.map(row => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / breakdownTotal }))
  const segments = parts.filter(part => part.width > 0)

  const label = t('context.aria', { percent: reading })

  return (
    <span ref={rootRef} className={css.root} data-context-meter>
      <Tooltip label={label} side={TOOLTIP_SIDE} delayMs={TOOLTIP_DELAY_MS} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.track} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.fill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
          <span>{reading}</span>
        </button>
      </Tooltip>
      {open && createPortal(
        <div
          ref={panelRef}
          className={css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          aria-label={t('context.used')}
          data-context-panel
        >
          <div className={css.header}>
            <span className={css.headline}>{headBefore}</span>
            <span className={css.percent}>{reading}</span>
            <span className={css.headline}>{headAfter}</span>
            {/* `~`: usedTokens prefers projectedTokens, whose surface delta is
                heuristically repriced on top of the provider-anchored sample. */}
            <span className={css.figures}>
              {`~${formatTokens(context.usedTokens, t)} / ${formatTokens(context.contextWindow, t)}`}
            </span>
          </div>
          <div className={css.bar}>
            {segments.map(segment => (
              <div
                key={segment.key}
                data-context-segment={segment.key}
                className={segment.color === undefined ? css.segment : `${css.segment} ${segment.color}`}
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          {breakdown !== null && breakdown !== undefined && (
            <dl className={css.rows}>
              {ROWS.map(row => (
                <div key={row.key} className={css.row}>
                  <dt>
                    <span className={`${css.swatch} ${row.color}`} aria-hidden />
                    {t(row.label)}
                  </dt>
                  <dd data-context-row={row.key}>{`~${formatTokens(breakdown[row.key], t)}`}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}
