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

/**
 * The menu rows: every healthy preset, name over description, in roster order
 * (the native chip's `state.options` order, `AgentPresetSeat.tsx:161-174`).
 * @param options - healthy options in roster order.
 * @param noDescription - the seat's own copy for a preset that published none.
 */
export function agentPresetMenuItems(
  options: readonly AgentPresetOption[],
  noDescription: string,
): AgentPresetMenuItem[] {
  return options.map(option => ({
    id: option.id,
    label: option.name ?? option.id,
    description: option.description ?? noDescription,
  }))
}

/**
 * The display name of the named preset, for the chip face: the roster's own
 * name, falling back to the id (which is also the host's fallback).
 * @param options - healthy options in roster order.
 * @param id - the id the seat names.
 */
export function agentPresetDisplayName(
  options: readonly AgentPresetOption[],
  id: string | undefined,
): string | undefined {
  if (id === undefined) return undefined
  return options.find(option => option.id === id)?.name ?? id
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
