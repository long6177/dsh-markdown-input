/**
 * The takeover card's stats pills (issue #43, alpha.13 retest): the card's
 * rebuild of the native StatsPills — the two readings the native composer
 * dock row shows BEFORE the context meter (the slot's order-0 occupant,
 * `ui-chat/src/client/apply.ts:284-288`). The takeover card hides the whole
 * fallback InputBar and with it the slot's only mount point, so — exactly the
 * context meter's structural gap — the card renders the pills itself, in its
 * dock row, in front of the meter.
 *
 * Vendored from dsh `ui-chat/src/client/chat/StatsPills.tsx` (0.2.0-rc.2,
 * the host component is not exported) in its DETAILED shape: the counts pill
 * (gauge icon, `stats.counts`, the `·`-joined decode throughput when any step
 * carried decode timing) and the usage pill (database icon, the billed-input
 * plus output total in compact tokens, the `·`-joined cache-hit share), the
 * whole row hidden when neither has anything to show (`stats.steps === 0 &&
 * !hasTokens`), each pill gated independently. The compact mode renders the
 * two plain readings alone. The third round (alpha.14 retest) restores the
 * detailed mode's dialogs: both pills are buttons over one exclusive open
 * slot (`StatsPills.tsx:320-321`), each portaling the host stat-dialog panel
 * (`role="dialog"`, anchored above the trigger through the shared
 * `useStatDialog` seat, stat-dialog-face.ts) — the counts dialog listing the
 * session's timed figures, the usage dialog the four billing buckets under an
 * exact grouped total.
 *
 * Recorded deviations from the native component: the native's window-scoped
 * `deriveStats` fallback fold has no counterpart (no chat-snapshot seat on
 * the card), so the counts pill rides the `sessionStats` projection alone;
 * the gauge and database glyphs are vendored SVG paths (no host package
 * import). The figures, gates, geometry, and copy are the host's own.
 */
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useObservable } from './conversation-face.ts'
import type { FaceDefinition } from './face.ts'
import {
  billedInputTokens, cacheHitPercent, compactReadings, exactCount, fillTemplate, formatDuration,
  formatTokens, formatTokensPerSecond, hasTokenActivity, statsPillsVisible, statsStepsOf,
  timeDialogAvailable, tokensPerSecondOf, ttftMeanMs,
  type SessionStatsView, type StatsPillsCopy, type TokenUsageView,
} from './stats-pills-core.ts'
import {
  performanceUsageModeOf, statsSettingsStore,
  type PerformanceUsageMode,
} from './stats-pills-face.ts'
import { MEASURE_STYLE, useStatDialog, type StatDialogSlot } from './stat-dialog-face.ts'
import css from './StatsPillsFace.module.css'
import dialogCss from './StatDialogFace.module.css'

/**
 * Read one stats projection value. The host `useProjection` standard seat is
 * generic over the host's projection-key map; this plugin declares no such
 * dependency, so the seat is typed at the two keys the pills consume and the
 * values are narrowed by the structural views in stats-pills-core.ts.
 */
export type StatsProjectionReader = {
  (key: 'sessionStats'): SessionStatsView | null | undefined
  (key: 'tokenUsage'): TokenUsageView | null | undefined
}

/** Props of the pills as the takeover card's dock row delivers them. */
export interface StatsPillsFaceProps {
  /**
   * The session's projection seat, one hook-style call per key. The card
   * receives it as a chain-prop standard seat and passes it down — the same
   * kit `sessionId` rides, injected into every session-scope entry on this
   * host build.
   */
  readonly useProjection: StatsProjectionReader
  /** The resolved pill copy (host `chat` words, plugin fallbacks — see `resolveStatsCopy`). */
  readonly copy: StatsPillsCopy
}

/** The face id the dock row's FaceGate registers (`face.ts` dotted convention). */
export const STATS_PILLS_FACE_ID = 'dock.statsPills'

/**
 * The dock row's face definition: the projection seat must be callable (the
 * copy always resolves — the plugin's fallback templates stand in for an
 * unbound `chat` namespace). Registration is idempotent per id, so the inline
 * per-render definition object is safe.
 * @param useProjection - the chain-prop projection seat, probed structurally.
 * @returns the face definition for the pills' FaceGate.
 */
export function statsPillsFaceDefinition(useProjection: unknown): FaceDefinition {
  return {
    id: STATS_PILLS_FACE_ID,
    probe: () => typeof useProjection === 'function',
  }
}

/** The gauge glyph of the counts pill, the host `IconGaugeOutlineRegular` artwork vendored (16×16, one-pixel regular stroke). */
function IconGaugeOutlineRegular(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1}>
      <path d="M3.4041 13.096C2.49514 12.187 1.87614 11.0288 1.62537 9.76798C1.37459 8.50716 1.50331 7.20028 1.99525 6.01261C2.48719 4.82494 3.32025 3.80981 4.3891 3.09557C5.45795 2.38134 6.71458 2.00008 8.0001 2C9.28563 2.00008 10.5423 2.38134 11.6111 3.09557C12.68 3.80981 13.513 4.82494 14.005 6.01261C14.4969 7.20028 14.6256 8.50716 14.3748 9.76798C14.1241 11.0288 13.5051 12.187 12.5961 13.096" stroke="currentColor" />
      <path d="M8 8.49994L11.6114 4.88855" stroke="currentColor" />
      <path d="M8 9.75C8.69036 9.75 9.25 9.19036 9.25 8.5C9.25 7.80964 8.69036 7.25 8 7.25C7.30964 7.25 6.75 7.80964 6.75 8.5C6.75 9.19036 7.30964 7.25 8 9.75Z" fill="currentColor" />
    </svg>
  )
}

/** The database glyph of the usage pill, the host `IconDatabaseOutlineRegular` artwork vendored (16×16, one-pixel regular stroke). */
function IconDatabaseOutlineRegular(): ReactNode {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" strokeWidth={1}>
      <path d="M13.1967 5.1869C13.7232 4.77378 14.0003 4.30517 14.0001 3.82819C14.0003 3.3512 13.7232 2.88259 13.1967 2.46947C12.6702 2.05635 11.9128 1.71328 11.0006 1.47475C10.0885 1.23621 9.05371 1.11062 8.00039 1.1106C6.94707 1.11057 5.9123 1.23612 5.00009 1.47461C4.08742 1.71301 3.32948 2.05604 2.80249 2.46919C2.2755 2.88235 1.99805 3.35106 1.99805 3.82819C1.99805 4.30531 2.2755 4.77402 2.80249 5.18718C3.32948 5.60033 4.08742 5.94336 5.00009 6.18176C5.9123 6.42025 6.94707 6.5458 8.00039 6.54578C9.05371 6.54575 10.0885 6.42016 11.0006 6.18163C11.9128 5.94309 12.6702 5.60002 13.1967 5.1869Z" stroke="currentColor" />
      <path d="M2 3.80371V11.7848" stroke="currentColor" />
      <path d="M14 3.80371V11.7848" stroke="currentColor" />
      <path d="M2 7.81396C2 8.60524 2.63214 9.36411 3.75736 9.92363C4.88258 10.4832 6.4087 10.7975 8 10.7975C9.5913 10.7975 11.1174 10.4832 12.2426 9.92363C13.3679 9.36411 14 8.60524 14 7.81396" stroke="currentColor" />
      <path d="M2 11.7847C2 12.6081 2.63214 13.3977 3.75736 13.98C4.88258 14.5622 6.4087 14.8893 8 14.8893C9.5913 14.8893 11.1174 14.5622 12.2426 13.98C13.3679 13.3977 14 12.6081 14 11.7847" stroke="currentColor" />
    </svg>
  )
}

/** The separator dot between a pill's two readings (host `.sep`, tertiary-on-separator color). */
function Sep(): ReactNode {
  return <span className={css.sep} aria-hidden>·</span>
}

/**
 * The counts pill (host `TimePill`, StatsPills.tsx:137-233): the turns/steps
 * reading with the `·`-joined throughput. A pill over a window with at least
 * one timed figure is a button portaling the session-stat dialog; without
 * any, the dialog would render zero rows, so the pill stays the native static
 * span form (:160-171).
 */
function TimePill({ stats, copy, dialog }: {
  stats: SessionStatsView
  copy: StatsPillsCopy
  dialog: StatDialogSlot
}): ReactNode {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const counts = fillTemplate(copy.counts, { turns: stats.turns, steps: stats.steps })
  const tps = tokensPerSecondOf(stats) !== null
    ? fillTemplate(copy.tokensPerSecond, {
      tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
    })
    : null
  const label = (
    <span className={css.label}>
      {counts}
      {tps !== null && (
        <>
          <Sep />
          {tps}
        </>
      )}
    </span>
  )
  // A window without one timed figure has no dialog rows to show, so the pill
  // stays a plain reading instead of a button opening an empty dialog.
  if (!timeDialogAvailable(stats)) {
    return (
      <span className={css.anchor}>
        <span className={css.pill}>
          <IconGaugeOutlineRegular />
          {label}
        </span>
      </span>
    )
  }
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={tps === null ? counts : `${counts} · ${tps}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconGaugeOutlineRegular />
        {label}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={copy.dialogTitle}
          style={pos ?? MEASURE_STYLE}
          data-session-stats-dialog
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconGaugeOutlineRegular />
              {copy.dialogTitle}
            </span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          {/* Missing figures drop their row instead of rendering a placeholder
              (host StatsPills.tsx:200-227 — conditional rendering, no `0s`). */}
          <dl className={dialogCss.details} data-session-stats-details>
            {stats.llmMs > 0 && (
              <>
                <dt>{copy.dialogLlmTime}</dt>
                <dd>{formatDuration(stats.llmMs, copy)}</dd>
              </>
            )}
            {stats.toolMs > 0 && (
              <>
                <dt>{copy.dialogToolTime}</dt>
                <dd>{formatDuration(stats.toolMs, copy)}</dd>
              </>
            )}
            {stats.ttftSteps > 0 && (
              <>
                <dt>{copy.dialogTtft}</dt>
                <dd>{formatDuration(ttftMeanMs(stats) ?? 0, copy)}</dd>
              </>
            )}
            {stats.decodeMs > 0 && tps !== null && (
              <>
                <dt>{copy.dialogSpeed}</dt>
                <dd>{tps}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

/**
 * The usage pill (host `UsagePill`, StatsPills.tsx:235-314): the compact
 * total with the `·`-joined cache-hit share, always a button — its four
 * billing buckets always fill the dialog; a session that never billed input
 * just drops the cache-hit row and the pill reads the pure total (:253).
 */
function UsagePill({ usage, copy, dialog }: {
  usage: TokenUsageView
  copy: StatsPillsCopy
  dialog: StatDialogSlot
}): ReactNode {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  // Same aggregate as the native: every prompt-side billing bucket plus
  // output (host StatsPills.tsx:241-242). The pill LABEL stays the compact
  // scale (:243); the exact grouped count is the dialog headline's twin.
  const total = billedInputTokens(usage) + usage.outputTokens
  const totalText = fillTemplate(copy.turnUsageCount, {
    count: formatTokens(total, { thousand: copy.thousand, million: copy.million }),
  })
  const totalExact = exactCount(total, copy)
  const cacheHit = cacheHitPercent(usage)
  const cacheHitText = cacheHit !== null ? fillTemplate(copy.cacheHit, { percent: cacheHit }) : null
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutlineRegular />
        <span className={css.label}>
          {totalText}
          {cacheHitText !== null && (
            <>
              <Sep />
              {cacheHitText}
            </>
          )}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={copy.dialogUsageTitle}
          style={pos ?? MEASURE_STYLE}
          data-session-usage-dialog
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}>
              <IconDatabaseOutlineRegular />
              {copy.dialogUsageTitle}
            </span>
            {/* The headline value is the EXACT grouped total, the compact
                pill reading's unrounded twin (host StatsPills.tsx:280). */}
            <span className={dialogCss.titleValue}>{totalExact}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          {/* A session that never wrote cache drops the row; input, read and
              output are always present (host StatsPills.tsx:288-307). */}
          <dl className={dialogCss.details} data-session-stats-usage>
            {cacheHit !== null && (
              <>
                <dt>{copy.turnUsageCacheHit}</dt>
                <dd>{`${cacheHit}%`}</dd>
              </>
            )}
            <dt>{copy.turnUsageInput}</dt>
            <dd>{exactCount(usage.uncachedInputTokens, copy)}</dd>
            <dt>{copy.turnUsageCacheRead}</dt>
            <dd>{exactCount(usage.cacheReadTokens, copy)}</dd>
            {usage.cacheWriteTokens !== 0 && (
              <>
                <dt>{copy.turnUsageCacheWrite}</dt>
                <dd>{exactCount(usage.cacheWriteTokens, copy)}</dd>
              </>
            )}
            <dt>{copy.turnUsageOutput}</dt>
            <dd>{exactCount(usage.outputTokens, copy)}</dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

/**
 * The stats pills occupant, or null while it has nothing to show.
 * @param props - the projection seat and the resolved pill copy.
 * @returns the two readings in the native order (counts, then usage); the
 * compact mode's plain readings instead when the setting says so; nothing
 * when neither plane answers with activity.
 */
export function StatsPillsFace({ useProjection, copy }: StatsPillsFaceProps): ReactNode {
  // The presentation mode rides the `ui-chat` settings form's live snapshot
  // (native parity: the injected `usePerformanceUsage` hook); an absent
  // service reads as the host default (detailed).
  const settings = useObservable(statsSettingsStore())
  const mode: PerformanceUsageMode = performanceUsageModeOf(settings)
  const stats = useProjection('sessionStats')
  const usage = useProjection('tokenUsage')
  // One exclusive slot for both dialogs: opening either pill closes the other
  // (host StatsPills.tsx:320-321). The slot is owned here, above the mode
  // branches, so the hook order stays flat across both presentations.
  const [openPill, setOpenPill] = useState<'time' | 'usage' | null>(null)

  // Compact mode: two plain readings, speed and cache hit, no counts
  // (host StatsPills.tsx:332-345). Either alone justifies the row.
  if (mode === 'compact') {
    const { speedTps, cacheHit } = compactReadings(stats, usage)
    if (speedTps === null && cacheHit === null) return null
    return (
      <div className={css.root} data-composer-stats>
        {speedTps !== null && (
          <span className={css.pill}>
            <IconGaugeOutlineRegular />
            {fillTemplate(copy.tokensPerSecond, { tps: formatTokensPerSecond(speedTps) })}
          </span>
        )}
        {cacheHit !== null && (
          <span className={css.pill}>
            <IconDatabaseOutlineRegular />
            {fillTemplate(copy.cacheHit, { percent: cacheHit })}
          </span>
        )}
      </div>
    )
  }

  // Detailed mode: the counts pill and the usage pill, each gated
  // independently (host StatsPills.tsx:347-371); the whole row hides when
  // neither has anything to show. The pills are buttons over the row's one
  // exclusive dialog slot.
  const steps = statsStepsOf(stats)
  const hasTokens = hasTokenActivity(usage)
  if (!statsPillsVisible(stats, usage)) return null
  return (
    <div className={css.root} data-composer-stats>
      {steps > 0 && stats !== undefined && stats !== null && (
        <TimePill
          stats={stats}
          copy={copy}
          dialog={{
            open: openPill === 'time',
            setOpen: (open: boolean) => { setOpenPill(open ? 'time' : null) },
          }}
        />
      )}
      {hasTokens && usage !== undefined && usage !== null && (
        <UsagePill
          usage={usage}
          copy={copy}
          dialog={{
            open: openPill === 'usage',
            setOpen: (open: boolean) => { setOpenPill(open ? 'usage' : null) },
          }}
        />
      )}
    </div>
  )
}
