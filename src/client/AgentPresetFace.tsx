/**
 * The Agent-preset seat of the card-top row (issue #42, ADR-0006 option B):
 * the native `conversation.hero.agentPreset` occupant, rebuilt from the data
 * semantics because its UI package is not in this build's dependency graph.
 *
 * Three host surfaces feed it, each resolved lazily per call so boot order
 * stays free and no missing one can throw into the card:
 *
 * - the ROSTER: `ctx.remote.agentPresets.list()` — the `remoteExportList`
 *   RPC of the preset registry (`agent-preset-registry/src/index.ts:170`);
 * - the CURRENT value: the `agentPreset` session projection delivered through
 *   the chain's `useProjection` seat (`seat-store.ts:256-261`);
 * - the SWITCH: `ctx.remote.agentPresets.select(sessionId, presetId)`.
 *
 * A missing remote namespace or a missing projection key hides the face
 * whole; a roster with no healthy preset hides it too (nothing to choose
 * between). A refusal from the host — the registry refuses to re-compose a
 * session whose conversation already started — surfaces through the card's
 * existing banner (`onError`), never a new toast surface.
 *
 * DEVIATION (recorded in the #42 report): the native chip is additionally
 * gated on the Developer-tools setting and on "main view" retention
 * (`AgentPresetSeat.tsx:84-85, :91-92, :134`). Both gates live in packages
 * outside this build's dependency graph (the settings form face and the
 * layout's retain info), so this seat gates on the two conditions it CAN
 * read: a blank session and a non-empty roster. The consequence is a
 * developer-tools-off deployment showing the chip where the native hero would
 * not; the control itself stays correct (its switch is refused by the host
 * exactly as the native one is).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  agentPresetCurrentId, agentPresetDisplayName, agentPresetMenuItems,
  agentPresetOptions, agentPresetProjectionOf, agentPresetRefusal,
  agentPresetSeatVisible, type AgentPresetOption,
} from './agent-preset-core.ts'
import type { AgentPresetsRemoteFace } from './agent-preset-face.ts'
import type { FaceDefinition } from './face.ts'
import css from './MarkdownComposer.module.css'

/** Face id of the agent-preset seat (the host seat is `conversation.hero.agentPreset`). */
export const AGENT_PRESET_FACE_ID = 'hero.agentPreset'

/**
 * The FaceGate definition of the Agent-preset seat: the projections it cannot
 * exist without — the remote verb surface and the projection seat. The roster
 * CONTENT is checked inside the face (it arrives asynchronously, and a probe
 * verdict latches for the page life, so an empty-then-populated roster must
 * not latch the face off).
 * @param useProjection - the session projection hook as the chain delivers it.
 * @param remotePresent - whether `ctx.remote.agentPresets` resolved.
 */
export function agentPresetFaceDefinition(
  useProjection: unknown,
  remotePresent: boolean,
): FaceDefinition {
  return {
    id: AGENT_PRESET_FACE_ID,
    probe: () => remotePresent && typeof useProjection === 'function',
  }
}

/** Props of the Agent-preset seat. */
export interface AgentPresetFaceProps {
  /** The session projection hook; the `agentPreset` key carries the current value. */
  readonly useProjection: (key: 'agentPreset') => unknown
  /** The session the switch addresses; absent means there is nothing to address. */
  readonly sessionId: string | undefined
  /** The roster verb surface, resolved by the card. */
  readonly remote: AgentPresetsRemoteFace | undefined
  /** The seat's own copy (the plugin's `markdown-input` namespace; host keys are not ours). */
  readonly copy: {
    /** The seat's accessible name / hint. */
    readonly seatHint: string
    /** Fallback description row for a preset that published none. */
    readonly noDescription: string
    /** The `{reason}` wrapper a refused switch reports. */
    readonly switchRefused: string
  }
  /** Report a refusal or a roster-read failure through the card's banner. */
  readonly onError: (message: string) => void
}

/** Loaded roster state: absent while loading, then either options or a reason. */
type RosterState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly options: readonly AgentPresetOption[]; readonly defaults: readonly string[] }
  | { readonly status: 'failed' }

/**
 * Render the Agent-preset chip and its roster menu, or nothing while the seat
 * has no projection key, no roster, or no verbs.
 * @param props - projection seat, session identity, roster verbs and copy.
 * @returns the chip and its menu, or null.
 */
export function AgentPresetFace(props: AgentPresetFaceProps): ReactNode {
  const rawProjection = props.useProjection('agentPreset')
  const projection = agentPresetProjectionOf(rawProjection)
  const remote = props.remote
  const [roster, setRoster] = useState<RosterState>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const onError = props.onError

  // One roster read per mounting: the remote answers with the current
  // declarations, and a card remount (session switch, election change) reads
  // again. A failed read reports once through the card banner and otherwise
  // leaves the seat hidden — a roster that never arrives offers no choice.
  useEffect(() => {
    if (remote === undefined) return undefined
    let live = true
    const fail = (message: string | undefined): void => {
      setRoster({ status: 'failed' })
      if (message !== undefined) onError(message)
    }
    void remote.list().then(
      (result) => {
        if (!live) return
        if (!result.ok) {
          fail(agentPresetRefusal(result.error))
          return
        }
        const presets = result.value.presets
        setRoster({
          status: 'ready',
          options: agentPresetOptions({ presets }),
          defaults: presets.filter(preset => preset.isDefault === true).map(preset => preset.id),
        })
      },
      (error: unknown) => {
        if (!live) return
        // A rejected read is a failure of the same face: report it and stay
        // hidden, so a roster that never arrives never offers a choice.
        fail(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { live = false }
  }, [remote, onError])

  const options = roster.status === 'ready' ? roster.options : []
  const visible = agentPresetSeatVisible(projection, options)
  const currentId = roster.status === 'ready'
    ? agentPresetCurrentId({ projection: projection ?? null, options, defaults: roster.defaults })
    : undefined
  const currentName = agentPresetDisplayName(options, currentId)
  const menuItems = useMemo(
    () => agentPresetMenuItems(options, props.copy.noDescription),
    [options, props.copy.noDescription],
  )

  const onSelect = useCallback((id: string) => {
    setOpen(false)
    const sessionId = props.sessionId
    if (remote === undefined || sessionId === undefined) return
    setBusy(true)
    void remote.select(sessionId, id)
      .then((result) => {
        if (result.ok) return
        onError(props.copy.switchRefused.replace('{reason}', agentPresetRefusal(result.error)))
      })
      .catch((error: unknown) => {
        onError(props.copy.switchRefused.replace('{reason}', error instanceof Error ? error.message : String(error)))
      })
      .finally(() => { setBusy(false) })
  }, [remote, props.sessionId, props.copy.switchRefused, onError])

  // The `useProjection` call above must stay unconditional (hooks), so the
  // visibility test is the render gate rather than an early return before it.
  if (!visible) return null

  return (
    <div className={css.agentPreset} data-markdown-agent-preset>
      <Menu
        open={open}
        anchor={null}
        items={menuItems.map(item => ({
          id: item.id,
          label: (
            <span className={css.agentPresetItem}>
              <span className={css.agentPresetItemName}>{item.label}</span>
              <span className={css.agentPresetItemDesc}>{item.description}</span>
            </span>
          ),
        }))}
        selectedId={currentId}
        onSelect={onSelect}
        onClose={() => { setOpen(false) }}
        side="bottom"
        portal
      />
      <button
        type="button"
        className={css.agentPresetChip}
        aria-haspopup="menu"
        aria-expanded={open}
        title={props.copy.seatHint}
        disabled={busy}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconAgentPresetOutlineRegular className={css.agentPresetGlyph} size={16} />
        <span className={css.agentPresetLabel}>{currentName ?? props.copy.seatHint}</span>
        <IconChevronDownOutlineRegular className={css.agentPresetChevron} size={12} />
      </button>
    </div>
  )
}
