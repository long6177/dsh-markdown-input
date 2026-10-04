/**
 * The tool-row plan chip face (issue #34): the takeover card's rebuild of
 * the native PlanChip (`ui-plan` PlanModeControl, the slot
 * `conversation.input.plan` seat the takeover structurally replaces — the
 * native tool row renders that seat beside the access-mode select, so this
 * face mounts beside the permission face). The chip shows while the host
 * plan projection's folded target is plan mode (`pending ? !active : active`,
 * never client optimism) and clicking executes the native detached line
 * `/plan off` through the command face — the same verb the native chip's
 * injected `exitPlanMode` runs. A failed exit reports inline; the projection
 * frame is the one confirmation, so the chip stays until the host logs the
 * mode change. Mounts inside its FaceGate: a probe miss (no projection hook
 * or no command face) hides this face alone, never the card.
 */
import { useState, type ReactNode } from 'react'
import {
  IconCloseCircleFillRegular, IconPlanOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { commandFace, commandFaceSupported } from './command-face.ts'
import type { SessionId } from './conversation-face.ts'
import type { FaceDefinition } from './face.ts'
import { NS } from './locales.ts'
import {
  PLAN_EXIT_LINE, planChipVisible, planExitFailure, planProjectionOf,
} from './plan-core.ts'
import css from './MarkdownComposer.module.css'

/** Face id of the tool-row plan chip in the face framework. */
export const PLAN_FACE_ID = 'tool.plan'

/**
 * The FaceGate definition of the tool-row plan chip: the projection hook
 * (the chip's data plane) and the command face (its exit verb) must both
 * exist — a chip without an exit is pointless, so either miss hides it.
 * @param useProjection - the session projection hook as the chain delivers it.
 */
export function planFaceDefinition(useProjection: unknown): FaceDefinition {
  return {
    id: PLAN_FACE_ID,
    probe: () => typeof useProjection === 'function' && commandFaceSupported(),
  }
}

/** Props of the plan chip as the composer chain delivers them. */
export interface PlanChipFaceProps {
  /**
   * Session projection reader; the `plan` key carries the folded mode
   * state. The reader answers the raw wire value — the chip normalizes it
   * structurally (the key's declaration lives outside this build's
   * dependency graph, so the card widens the keyed hook to deliver here).
   */
  readonly useProjection: (key: 'plan') => unknown
  /** Owning session; undefined has no command surface to execute against. */
  readonly sessionId: SessionId | undefined
  /** Owner lock (session gone) — disables the chip like the native seat. */
  readonly locked: boolean
  readonly t: PropsLocale<typeof NS>['t']
}

/**
 * The plan-mode chip: a labeled pill whose hover glyph announces the exit.
 * @param props - projection reader, session, lock, and copy.
 * @returns the chip, or nothing while plan mode is off or the face is absent.
 */
export function PlanChipFace({ useProjection, sessionId, locked, t }: PlanChipFaceProps): ReactNode {
  const plan = planProjectionOf(useProjection('plan'))
  const [leaving, setLeaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  if (!planChipVisible(plan)) return null

  const exit = (): void => {
    const commands = commandFace()
    if (commands === undefined || sessionId === undefined) return
    setLeaving(true)
    setFailure(null)
    void commands.execute(sessionId, PLAN_EXIT_LINE).then((result) => {
      setLeaving(false)
      const line = planExitFailure(result)
      if (line !== null) setFailure(line)
    })
  }

  return (
    <span className={css.planChipWrap}>
      <button
        type="button"
        className={css.planChip}
        data-markdown-plan-chip
        aria-label={t('plan.chip.on.aria')}
        title={t('plan.chip.on.title')}
        disabled={locked || leaving || sessionId === undefined}
        onClick={exit}
      >
        <span className={css.planChipGlyph} aria-hidden>
          <IconPlanOutlineRegular className={css.planChipRestGlyph} size={14} />
          <IconCloseCircleFillRegular className={css.planChipHoverGlyph} size={14} />
        </span>
        {t('plan.chip.label')}
      </button>
      {failure !== null && (
        <span className={css.planChipError} role="status" data-markdown-plan-chip-error title={failure}>
          {t('plan.chip.exitFailed')}
        </span>
      )}
    </span>
  )
}
