/**
 * The takeover card's goal strip face (issue #34): the card's rebuild of
 * the native GoalBar/GoalDock (`ui-goal`, the `conversation.input.dock`
 * order-10 seat — the dock strip renders inside the composer chain's
 * fallback bar, which the takeover hides whole, so the card rebuilds it
 * above its queue strip, the native dock order). A present, non-complete
 * goal shows the glyph, the phase label (activation-aware), the truncated
 * objective, and the pause/resume/edit/clear icon verbs; goal creation
 * lives on the `/goal` command, not here — loading (undefined), no goal
 * (null), and complete goals render nothing. The durable state rides the
 * `goal` projection (useProjection); the process-local activation rides
 * goal-face.ts (live read + forwarded edges); the verbs ride the session
 * CAS ref read off the projection at call time. Without the verb face the
 * strip keeps rendering and only its buttons shed (the queue-strip rule:
 * actions degrade, visibility never does). Mounts inside its FaceGate — a
 * render exception latches this face off alone, never the card.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutlineRegular, IconCloseOutlineRegular, IconEditOutlineRegular,
  IconGoalOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconTrashOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from './conversation-face.ts'
import type { FaceDefinition } from './face.ts'
import {
  GOAL_NO_CURRENT_RESULT, activationFor, goalRefOf, goalStripVisible,
  type GoalActionResult, type GoalActivationEdge, type GoalPhase,
  type GoalProjectionView,
} from './goal-core.ts'
import { goalFace } from './goal-face.ts'
import { NS } from './locales.ts'
import css from './MarkdownComposer.module.css'

/** Face id of the goal strip in the face framework (the host seat is the input dock's `goal` entry). */
export const GOAL_STRIP_FACE_ID = 'strip.goal'

/**
 * The FaceGate definition of the goal strip: the projection hook is the
 * strip's one hard dependency — the verb surfaces shed buttons alone
 * (queue-strip rule), so they never gate visibility.
 * @param useProjection - the session projection hook as the chain delivers it.
 */
export function goalStripFaceDefinition(useProjection: unknown): FaceDefinition {
  return {
    id: GOAL_STRIP_FACE_ID,
    probe: () => typeof useProjection === 'function',
  }
}

/** Strip label copy per visible phase; complete goals render nothing. */
function phaseLabel(phase: GoalPhase, t: GoalCopy): string | null {
  switch (phase) {
    case 'active': return t('goal.phase.active')
    case 'paused': return t('goal.phase.paused')
    case 'blocked': return t('goal.phase.blocked')
    case 'complete': return null
  }
}

type GoalCopy = PropsLocale<typeof NS>['t']

/** Strip label for an active goal using its process-local activation. */
function activeLabel(activation: GoalActivationEdge['activation'] | undefined, t: GoalCopy): string {
  if (activation === 'disarmed') return t('goal.phase.active.disarmed')
  return t('goal.phase.active')
}

/** Props of the goal strip as the composer chain delivers them. */
export interface GoalStripFaceProps {
  /** Session projection hook; the `goal` key carries the durable state. */
  readonly useProjection: (key: 'goal') => GoalProjectionView | null | undefined
  /** Owning session; the verbs address it — without one the buttons shed. */
  readonly sessionId: SessionId | undefined
  /** The session's running state; a flip re-reads the live activation. */
  readonly running: boolean
  readonly t: GoalCopy
}

/**
 * The goal strip, or null when no goal strip belongs above the composer.
 * @param props - projection hook, session, running state, and copy.
 * @returns the strip, or nothing while loading, unset, or complete.
 */
export function GoalStripFace({ useProjection, sessionId, running, t }: GoalStripFaceProps): ReactNode {
  const projection = useProjection('goal')
  const goal = projection?.goal ?? null
  const visible = goalStripVisible(projection)
  // The mutation handlers read the LATEST projection at event time through
  // this mirror (the card's inputRef idiom): the hook can only run during
  // render, and the CAS ref must be read at call time — no staleness
  // fence, the RPC's CAS is the guard (native refOf parity).
  const projectionRef = useRef(projection)
  projectionRef.current = projection

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<string | null>(null)
  const [activationEdge, setActivationEdge] = useState<GoalActivationEdge>({})
  const [resetEpoch, setResetEpoch] = useState(0)
  const pendingRef = useRef(false)

  // The goal face resolves per call: its verbs and subscriptions shed
  // alone (capability detection), the strip's visibility never rides them.
  const goals = goalFace()
  const actions = goals !== undefined && sessionId !== undefined

  // A new goal identity (cleared/completed/replaced externally) invalidates
  // the local edit/error/tombstone state: without the reset a surviving
  // draft's Enter would write over the NEW goal (native parity).
  const goalId = goal?.id
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])

  const activation = goal !== null
    ? activationFor(activationEdge, goal)
    : undefined

  // The activation edges: live events deliver, transport resets re-read.
  useEffect(() => {
    if (goals === undefined || sessionId === undefined) return undefined
    const disposeEdge = goals.subscribeActivation(sessionId, (edge) => {
      setActivationEdge(edge ?? {})
    })
    const disposeReset = goals.subscribeReset(() => { setResetEpoch((epoch) => epoch + 1) })
    return () => {
      disposeEdge()
      disposeReset()
    }
  }, [goals, sessionId])

  // The live activation read: an active goal's process-local arm arrives
  // once per goal revision (the CAS ref), a running flip (the agent process
  // may arm/disarm around a turn), and a transport reset. A failed read
  // leaves the held edge — the events correct it.
  const activeRefId = goal?.phase === 'active' ? goal.id : undefined
  const activeRefRevision = goal?.phase === 'active' ? goal.revision : undefined
  useEffect(() => {
    if (goals === undefined || sessionId === undefined) return
    if (activeRefId === undefined || activeRefRevision === undefined) return
    let cancelled = false
    void goals.readActivation(sessionId).then((edge) => {
      if (!cancelled && edge !== undefined) setActivationEdge(edge)
    })
    return () => { cancelled = true }
  }, [goals, sessionId, activeRefId, activeRefRevision, running, resetEpoch])

  // React state disables the controls on the next render; the ref closes
  // the same-render window so rapid clicks cannot submit the same CAS twice
  // (native runAction parity).
  const runAction = async (action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }

  if (!visible || goal === null || goal.id === clearedGoalId) return null

  const mutate = (verb: 'pause' | 'resume' | 'clear'): void => {
    if (goals === undefined || sessionId === undefined) return
    const ref = goalRefOf(projectionRef.current)
    void runAction(() => ref === undefined
      ? Promise.resolve(GOAL_NO_CURRENT_RESULT)
      : goals[verb](sessionId, ref))
      .then((result) => {
        if (verb === 'clear' && result?.ok === true) setClearedGoalId(goal.id)
      })
  }

  const handleEdit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '' || goals === undefined || sessionId === undefined) return
    const ref = goalRefOf(projectionRef.current)
    void runAction(() => ref === undefined
      ? Promise.resolve(GOAL_NO_CURRENT_RESULT)
      : goals.edit(sessionId, ref, trimmed))
      .then((result) => { if (result?.ok === true) setEditing(false) })
  }

  if (editing) {
    return (
      <div className={css.goal} data-markdown-goal>
        <div className={css.goalBar} data-markdown-goal-bar>
          <input
            className={css.goalInput}
            type="text"
            data-markdown-goal-input
            aria-label={t('goal.objective.aria')}
            value={draft}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                handleEdit()
              }
              if (event.key === 'Escape') setEditing(false)
            }}
            autoFocus
          />
          {actionError !== null && (
            <span className={css.goalError} role="alert" data-markdown-goal-error>{actionError}</span>
          )}
          <div className={css.goalActions}>
            <button type="button" className={css.goalAction} data-markdown-goal-save
              aria-label={t('goal.action.save')} title={t('goal.action.save')}
              disabled={pending || draft.trim() === ''}
              onClick={() => { handleEdit() }}>
              <IconCheckOutlineRegular size={14} />
            </button>
            <button type="button" className={css.goalAction}
              aria-label={t('goal.action.cancel')} title={t('goal.action.cancel')}
              disabled={pending}
              onClick={() => { setEditing(false) }}>
              <IconCloseOutlineRegular size={14} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined
  // `complete` never reaches here (the visibility gate above), so the label
  // is always present.
  const label = goal.phase === 'active' ? activeLabel(activation, t) : phaseLabel(goal.phase, t) ?? ''
  const showResume = goal.phase === 'paused' || (goal.phase === 'active' && activation === 'disarmed')

  return (
    <div className={css.goal} data-markdown-goal>
      <div className={css.goalBar} data-markdown-goal-bar title={title}>
        <span className={css.goalGlyph} aria-hidden><IconGoalOutlineRegular size={14} /></span>
        <span className={css.goalLabel}>{label}</span>
        <span className={css.goalObjective} data-markdown-goal-objective>{goal.objective}</span>
        {actionError !== null && (
          <span className={css.goalError} role="alert" data-markdown-goal-error>{actionError}</span>
        )}
        {actions && (
          <div className={css.goalActions}>
            {goal.phase === 'active' && activation === 'armed' && (
              <button type="button" className={css.goalAction}
                aria-label={t('goal.action.pause')} title={t('goal.action.pause')}
                disabled={pending} onClick={() => { mutate('pause') }}>
                <IconPauseOutlineRegular size={14} />
              </button>
            )}
            {showResume && (
              <button type="button" className={css.goalAction}
                aria-label={t('goal.action.resume')} title={t('goal.action.resume')}
                disabled={pending} onClick={() => { mutate('resume') }}>
                <IconPlayOutlineRegular size={14} />
              </button>
            )}
            <button type="button" className={css.goalAction}
              aria-label={t('goal.action.edit')} title={t('goal.action.edit')}
              disabled={pending}
              onClick={() => { setDraft(goal.objective); setEditing(true) }}>
              <IconEditOutlineRegular size={14} />
            </button>
            <button type="button" className={css.goalAction}
              aria-label={t('goal.action.clear')} title={t('goal.action.clear')}
              disabled={pending} onClick={() => { mutate('clear') }}>
              <IconTrashOutlineRegular size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
