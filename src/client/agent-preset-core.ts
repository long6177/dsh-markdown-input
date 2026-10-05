/**
 * Pure decision core of the Agent-preset seat (issue #42, ADR-0006 option B).
 *
 * The native seat is a `conversation.hero.agentPreset` occupant
 * (`ui-agent-preset/src/client/AgentPresetSeat.tsx`) whose package is NOT in
 * this build's dependency graph, so the card rebuilds the control from DATA
 * semantics instead of vendoring the component: the roster is the
 * `agentPresets` remote service's `list()` read (the `remoteExportList` RPC,
 * `preset/agent-preset-registry/src/index.ts:170`), the current value is the
 * `agentPreset` session projection (`seat-store.ts:256-261` reads
 * `session.projectionValues.agentPreset`, a `string | null`), and the switch
 * is the service's `select(sessionId, presetId)` verb.
 *
 * Everything here is a pure function of those two reads plus the display
 * copy, so the seat's three rules — which preset it names, which rows it
 * offers, and whether it exists at all — are pinned by unit tests rather than
 * by a mounted tree.
 *
 * The display copy itself follows the native fold (alpha.12 feedback): a
 * SHIPPED preset whose roster row publishes no name resolves its words through
 * the host `settings.agentPreset` dictionary (`preset/agent-preset-registry/
 * src/display.ts:40-45,63-73`), while a row that names itself owns its copy —
 * user-authored metadata is never translated. `presetDisplayText` replicates
 * that fold; when the host namespace is absent (a build without the
 * ui-agent-preset plugin, whose bound translate echoes the raw key) the fold
 * falls back to the row's own data, which is the pre-feedback behavior.
 */

/** One selectable preset, mirroring the host roster row's client-safe subset (`AgentPresetRow`). */
export interface AgentPresetOption {
  readonly id: string
  /** Display name the preset published; absent means the preset published none. */
  readonly name?: string | undefined
  /** One sentence on what the preset is for. */
  readonly description?: string | undefined
  /** Why this preset cannot compose a session; a broken row is never offered. */
  readonly broken?: string | undefined
  /** Whether a session naming no preset composes this one (the roster's default flag). */
  readonly isDefault?: boolean | undefined
}

/** One roster read, mirroring the host `AgentPresetRoster` payload. */
export interface AgentPresetRosterView {
  readonly presets: readonly AgentPresetOption[]
}

/** The host roster read as the remote face settles it: a value or a reason. */
export type AgentPresetRosterRead =
  | { readonly ok: true; readonly roster: AgentPresetRosterView }
  | { readonly ok: false; readonly error: string }

/**
 * The host roster as the seat's rows: healthy presets only.
 *
 * A broken preset cannot compose a session, so offering it would defer the
 * discovery of that fact to a failed session start — the same filter the
 * native picker applies (`settings-store.ts:108-116`).
 * @param roster - the roster the host answered with.
 */
export function agentPresetOptions(roster: AgentPresetRosterView): AgentPresetOption[] {
  return roster.presets.filter(preset => preset.broken === undefined)
}

/** Inputs of the seat's "which preset does it name" decision. */
export interface AgentPresetCurrentInput {
  /** The `agentPreset` session projection: a preset id, or null when none is recorded. */
  readonly projection: string | null
  /** Healthy options in roster order. */
  readonly options: readonly AgentPresetOption[]
  /**
   * The roster's own default flag per preset (`AgentPresetRow.isDefault`).
   * Not part of the projected value, so it travels beside the options.
   */
  readonly defaults: readonly string[]
}

/**
 * The preset the seat names, following the native seat's precedence
 * (`seat-store.ts:118`): the session's recorded preset when it has one, then
 * the roster's deployment default, then the first option. The recorded value
 * may name a preset the roster no longer carries; the seat still names it —
 * that is what the session actually runs — but the menu simply shows no
 * selected row.
 * @param input - the projection, the healthy options, and the defaults.
 * @returns the id to name, or undefined when the roster offers nothing.
 */
export function agentPresetCurrentId(input: AgentPresetCurrentInput): string | undefined {
  if (input.projection !== null) return input.projection
  return input.defaults[0] ?? input.options[0]?.id
}

/** One picker row: the shape the primitives `Menu` consumes, with display copy. */
export interface AgentPresetMenuItem {
  readonly id: string
  readonly label: string
  /** Description row the native chip renders under the name; absent when the preset published none. */
  readonly description: string | undefined
}

/** Dictionary keys carrying one shipped preset's display copy (`agent-preset-registry/src/display.ts:13-17`). */
export type BuiltInPresetCopyKey =
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetPtcName' | 'presetPtcDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'

/** Preset roster fields the display fold needs (`display.ts:21-31`). */
export type PresetDisplaySource = Pick<AgentPresetOption, 'id' | 'name' | 'description'>

/** Display copy resolved for the active locale (`display.ts:34-41`). */
export interface PresetDisplayText {
  /** Localized built-in name, or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description, or the preset's own description. */
  readonly description?: string
}

/** The host `settings.agentPreset` translate seat, narrowed to the display keys. */
export type PresetTranslate = (key: BuiltInPresetCopyKey) => string

/** Which dictionary keys carry which shipped preset's copy (`display.ts:46-51`). */
const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, { readonly name: BuiltInPresetCopyKey; readonly description: BuiltInPresetCopyKey }>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
}

/**
 * Whether a roster row is one of the shipped presets whose copy the host
 * dictionaries carry. A shipped preset publishes no `name`; a declaration
 * that names itself owns its copy and is never translated
 * (`display.ts:58-60`).
 * @param preset - roster row.
 */
export function isBuiltInPreset(preset: PresetDisplaySource): boolean {
  return preset.name === undefined && BUILT_IN_PRESET_KEYS[preset.id] !== undefined
}

/**
 * One host-dictionary read as the fold consumes it: the bound translate
 * echoes the raw key when the namespace never resolves it (a host build
 * without the ui-agent-preset plugin — the locale service's `?? key` tail),
 * and an echo reads as "no copy" so the row's own data can answer.
 */
function resolvedCopy<T extends string>(t: (key: T) => string, key: T): string | undefined {
  const value = t(key)
  return value === key ? undefined : value
}

/**
 * Resolve preset display copy without making user-authored metadata
 * translatable (the native fold, `display.ts:63-73`): a shipped preset
 * resolves through the host dictionary, everything else — including a
 * shipped id whose dictionary is absent — resolves from the row itself.
 * @param preset - roster row whose copy is being rendered.
 * @param t - the host `settings.agentPreset` translate; undefined keeps the roster's own metadata.
 */
export function presetDisplayText(preset: PresetDisplaySource, t: PresetTranslate | undefined): PresetDisplayText {
  const keys = t !== undefined && isBuiltInPreset(preset) ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (t !== undefined && keys !== undefined) {
    const name = resolvedCopy(t, keys.name)
    if (name !== undefined) return { name, description: resolvedCopy(t, keys.description) }
  }
  return {
    name: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
  }
}

/**
 * The menu rows: every healthy preset, name over description, in roster order
 * (the native chip's `state.options` order, `AgentPresetSeat.tsx:161-174`).
 * Shipped rows name themselves through the host dictionary; a row whose
 * description resolves nowhere shows the seat's own fallback copy.
 * @param options - healthy options in roster order.
 * @param t - the host `settings.agentPreset` translate; undefined keeps the roster's own metadata.
 * @param noDescription - the seat's own copy for a preset that published none.
 */
export function agentPresetMenuItems(
  options: readonly AgentPresetOption[],
  t: PresetTranslate | undefined,
  noDescription: string,
): AgentPresetMenuItem[] {
  return options.map((option) => {
    const text = presetDisplayText(option, t)
    return { id: option.id, label: text.name, description: text.description ?? noDescription }
  })
}

/**
 * The display name of the named preset, for the chip face: the native fold
 * again — localized through the host dictionary when the row is a shipped
 * one, the roster's own name otherwise, falling back to the id (which is also
 * the host's fallback). A recorded id the roster no longer carries names
 * itself as-is: that is what the session actually runs.
 * @param options - healthy options in roster order.
 * @param id - the id the seat names.
 * @param t - the host `settings.agentPreset` translate; undefined keeps the roster's own metadata.
 */
export function agentPresetDisplayName(
  options: readonly AgentPresetOption[],
  id: string | undefined,
  t: PresetTranslate | undefined,
): string | undefined {
  if (id === undefined) return undefined
  const row = options.find(option => option.id === id)
  if (row === undefined) return id
  return presetDisplayText(row, t).name
}

/** The three seat strings the host `settings.agentPreset` dictionary also carries. */
export type AgentPresetSeatHostKey = 'seatHint' | 'noDescription' | 'switchRefused'

/** The seat's resolved copy: host words when the namespace answers, plugin words otherwise. */
export interface AgentPresetSeatCopy {
  /** The chip's accessible name / hint. */
  readonly seatHint: string
  /** Fallback description row for a preset that published none. */
  readonly noDescription: string
  /** The refusal wrapper a failed switch reports; interpolates `{name}` and `{reason}`. */
  readonly switchRefused: string
}

/**
 * The seat copy: host words first, the plugin's own `markdown-input` keys as
 * fallback. Before the alpha.12 feedback the seat shipped only its own words
 * (the host namespace was not ours to bind); the maintainer's acceptance of
 * the binding makes the host dictionary the first read, with the raw-key echo
 * of an absent namespace (and the absent binding itself) falling back to the
 * plugin's paraphrase — so a build without the ui-agent-preset plugin still
 * speaks, in the same words it spoke yesterday.
 * @param hostT - the bound `settings.agentPreset` translate; undefined = not bound.
 * @param own - the plugin's own copy.
 */
export function resolveAgentPresetCopy(
  hostT: ((key: AgentPresetSeatHostKey) => string) | undefined,
  own: AgentPresetSeatCopy,
): AgentPresetSeatCopy {
  if (hostT === undefined) return own
  const resolved = (key: AgentPresetSeatHostKey): string | undefined => resolvedCopy(hostT, key)
  return {
    seatHint: resolved('seatHint') ?? own.seatHint,
    noDescription: resolved('noDescription') ?? own.noDescription,
    switchRefused: resolved('switchRefused') ?? own.switchRefused,
  }
}

/**
 * Whether the seat exists: the projection KEY is actually contributed AND the
 * roster has something to choose between.
 *
 * The distinction matters and is the ticket's rule: a projection that reads
 * `undefined` means the hosting build never contributed the `agentPreset`
 * key (the projection plugin is absent), and a roster with no healthy preset
 * means there is nothing to pick (a deployment composing no presets) — in
 * both cases the whole face hides, never a dead control. A projection that
 * reads `null` is a live key with no recorded preset, which is the ordinary
 * blank-session state: the seat then names the deployment default.
 * @param projection - the raw `useProjection('agentPreset')` value.
 * @param options - healthy options in roster order.
 */
export function agentPresetSeatVisible(
  projection: string | null | undefined,
  options: readonly AgentPresetOption[],
): boolean {
  return projection !== undefined && options.length > 0
}

/**
 * Normalize the raw projection read into the seat's `string | null` decision
 * value. The key is widened structurally on the card side (the `plan` key
 * precedent), so the wire value is `unknown`: a string is a recorded preset,
 * a live `null` is "none recorded", and anything else is treated as absent.
 * @param raw - the raw projection value.
 */
export function agentPresetProjectionOf(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  return typeof raw === 'string' ? raw : undefined
}

/**
 * The refusal text one failed switch reports, mirroring the native seat
 * (`seat-store.ts:231-241`): the `reason` detail when the failure carries
 * one, the wrapped `message` otherwise. Read by the detail rather than by the
 * error code, because every refusal with a cause to give names it the same
 * way.
 * @param error - the failed `select` result's error.
 */
export function agentPresetRefusal(error: {
  readonly code?: string
  readonly message?: string
  readonly details?: unknown
}): string {
  const details = error.details
  if (typeof details === 'object' && details !== null && 'reason' in details) {
    const reason = (details as { readonly reason?: unknown }).reason
    if (typeof reason === 'string' && reason !== '') return reason
  }
  return error.message ?? error.code ?? 'agent preset switch failed'
}
