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
 * Display copy (alpha.12 feedback): the roster rows resolve through the host
 * `settings.agentPreset` dictionary — `presetDisplayText` in agent-preset-core
 * is the native fold (`agent-preset-registry/src/display.ts:63-73`), so a
 * shipped preset renders its localized name and description instead of the
 * raw id, and the refusal names the picked preset. The host namespace is
 * bound read-only by apply; a build without it falls back to the row's own
 * metadata and the plugin's `agentPreset.*` keys.
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  agentPresetCurrentId, agentPresetDisplayName, agentPresetMenuItems,
  agentPresetOptions, agentPresetProjectionOf, agentPresetRefusal,
  agentPresetSeatVisible, agentPresetVisibleOptions, presetDisplayText,
  type AgentPresetOption, type AgentPresetSeatCopy, type PresetTranslate,
} from './agent-preset-core.ts'
import { useObservable } from './conversation-face.ts'
import type {
  AgentPresetRefreshSubscribe, AgentPresetsRemoteFace, DeveloperToolsStore,
} from './agent-preset-face.ts'
import { developerToolsEnabledOf } from './agent-preset-face.ts'
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
  /**
   * The host `settings.agentPreset` translate, for the shipped presets'
   * dictionary names (alpha.12 feedback: the menu speaks the native words).
   * Undefined keeps the roster rows' own published metadata — the host
   * build without the ui-agent-preset plugin has no dictionary to read.
   */
  readonly translate: PresetTranslate | undefined
  /** The seat's copy: host words when the namespace answers, plugin keys otherwise. */
  readonly copy: AgentPresetSeatCopy
  /** Report a refusal or a roster-read failure through the card's banner. */
  readonly onError: (message: string) => void
  /**
   * The host Developer-tools form (#78), the native gate's signal
   * (`AgentPresetSeat.tsx:32`): the tool presets (`ptc`, `minimal`) leave the
   * menu while it reads off. Undefined (no configForms service) reads off
   * too — the native observable face's own `?? false`.
   */
  readonly developerTools?: DeveloperToolsStore
  /**
   * The roster-refresh subscription (#78): fires the re-read on a transport
   * reset, a preset-registry settings write, and the settings forms' changes
   * — the native apply's four refresh signals. Undefined (no remote event
   * face) keeps the one-mounting-read behavior.
   */
  readonly subscribeRefresh?: AgentPresetRefreshSubscribe
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
  const chipRef = useRef<HTMLButtonElement | null>(null)
  const [roster, setRoster] = useState<RosterState>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const onError = props.onError
  // The roster-refresh clock (#78): every refresh signal bumps the tick and
  // the read effect below re-runs against it — the native apply's refresh
  // loop, shrunk to the one surface this card rebuilds.
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    const subscribe = props.subscribeRefresh
    if (subscribe === undefined) return undefined
    return subscribe(() => { setRefreshTick(tick => tick + 1) })
  }, [props.subscribeRefresh])

  // The menu's placement anchor — the same seam the workspace chip uses:
  // `getAnchorRect` (not the Menu's own wrapper measurement) because the chip
  // is a sibling of the Menu in a flex row and the wrapper span it would
  // measure carries no geometry of its own. Without it the portaled list
  // positions from a zero-geometry wrapper (the alpha.12 real-device finding).
  const getAnchorRect = useCallback(
    () => chipRef.current?.getBoundingClientRect() ?? null,
    [],
  )

  // One roster read per mounting, re-run by every refresh signal (#78): the
  // remote answers with the current declarations, a card remount (session
  // switch, election change) reads again, and a refresh tick reads again on
  // top of whatever the seat already shows (a slow re-read never blanks the
  // seat — the state only swaps when the read settles, the previous run's
  // `live` flag dropping stale answers). A failed read reports once through
  // the card banner and otherwise leaves the seat hidden — a roster that
  // never arrives offers no choice.
  useEffect(() => {
    if (remote === undefined) return undefined
    let live = true
    const fail = (message: string | undefined): void => {
      setRoster({ status: 'failed' })
      if (message !== undefined) onError(message)
    }
    const ready = (presets: readonly AgentPresetOption[]): void => {
      setRoster({
        status: 'ready',
        options: agentPresetOptions({ presets }),
        defaults: presets.filter(preset => preset.isDefault === true).map(preset => preset.id),
      })
    }
    void remote.list().then(
      (result) => {
        if (!live) return
        if (!result.ok) {
          // The optional-service absence is a LEGAL deployment: the native
          // read answers an empty roster and the seat hides silently
          // (`settings-store.ts:76`) — reporting it would turn a quiet host
          // into a recurring false alarm, worst right after a reconnect.
          if (result.error.code === 'gateway/invocation-unavailable') {
            ready([])
            return
          }
          fail(agentPresetRefusal(result.error))
          return
        }
        ready(result.value.presets)
      },
      (error: unknown) => {
        if (!live) return
        // A rejected read is a failure of the same face: report it and stay
        // hidden, so a roster that never arrives never offers a choice.
        fail(error instanceof Error ? error.message : String(error))
      },
    )
    return () => { live = false }
  }, [remote, onError, refreshTick])

  const options = roster.status === 'ready' ? roster.options : []
  const visible = agentPresetSeatVisible(projection, options)
  const currentId = roster.status === 'ready'
    ? agentPresetCurrentId({ projection: projection ?? null, options, defaults: roster.defaults })
    : undefined
  const currentName = agentPresetDisplayName(options, currentId, props.translate)
  // The Developer-tools gate (#78), the native display-layer filter
  // (`AgentPresetSeat.tsx:105-108`): the MENU reads the filtered rows, the
  // chip label and the seat's own visibility keep the full healthy list — a
  // current tool preset still names itself on a chip that no longer offers it.
  const developerTools = developerToolsEnabledOf(useObservable(props.developerTools))
  const visibleOptions = useMemo(
    () => agentPresetVisibleOptions(options, developerTools),
    [options, developerTools],
  )
  const menuItems = useMemo(
    () => agentPresetMenuItems(visibleOptions, props.translate, props.copy.noDescription),
    [visibleOptions, props.translate, props.copy.noDescription],
  )
  // The native close-on-shrink effect (`AgentPresetSeat.tsx:110-112`): the
  // menu closes the moment its last visible row disappears (a Developer-tools
  // flip among them) and stays closed when the rows return.
  useEffect(() => { setOpen(false) }, [developerTools, visibleOptions.length])

  const onSelect = useCallback((id: string) => {
    setOpen(false)
    const sessionId = props.sessionId
    if (remote === undefined || sessionId === undefined) return
    setBusy(true)
    // The refusal names the picked preset the way the chip does — localized
    // for a shipped row, the row's own name otherwise — because the host
    // template interpolates `{name}` (`switchRefused: 'Could not switch to
    // {name}: {reason}'`); the plugin's fallback template carries only
    // `{reason}` and simply never reads the name.
    const name = agentPresetDisplayName(options, id, props.translate) ?? id
    const refuse = (reason: string): void => {
      onError(props.copy.switchRefused.replace(/\{(\w+)\}/gu, (whole, key: string) => key === 'name'
        ? name
        : key === 'reason' ? reason : whole))
    }
    void remote.select(sessionId, id)
      .then((result) => {
        if (!result.ok) refuse(agentPresetRefusal(result.error))
      })
      .catch((error: unknown) => {
        refuse(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setBusy(false) })
  }, [remote, props.sessionId, props.translate, options, props.copy.switchRefused, onError])

  // The `useProjection` call above must stay unconditional (hooks), so the
  // visibility test is the render gate rather than an early return before it.
  if (!visible) return null

  return (
    <div className={css.agentPreset} data-markdown-agent-preset>
      <Menu
        open={open && visibleOptions.length > 0}
        anchor={null}
        getAnchorRect={getAnchorRect}
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
        ref={chipRef}
        type="button"
        className={css.agentPresetChip}
        aria-haspopup="menu"
        aria-expanded={open}
        title={props.copy.seatHint}
        disabled={busy || visibleOptions.length === 0}
        onClick={() => { setOpen(value => !value) }}
      >
        <IconAgentPresetOutlineRegular className={css.agentPresetGlyph} size={16} />
        <span className={css.agentPresetLabel}>{currentName ?? props.copy.seatHint}</span>
        <IconChevronDownOutlineRegular className={css.agentPresetChevron} size={12} />
      </button>
    </div>
  )
}
