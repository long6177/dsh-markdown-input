/**
 * Data plane of the model face (tool row ③, ADR-0005 revival): the catalog,
 * the durable selection, and the select verb all come from the host's
 * `modelDirectories` service — the per-session `ModelDirectoryResolver` the
 * host's ui-model-selection plugin registers on the client root context. The
 * session's shared directory store is the SAME instance the native model
 * seat and the /model popup read, so a switch made here is what the host
 * shows next and vice versa; the write itself is `session.selectModel` as
 * issued by the host directory (effort and model travel in one action).
 *
 * The host's ModelSelect view is not exported, so the face vendors it
 * (ModelSelectFace.tsx); this module is the narrow, capability-detected door
 * to the DATA surface, mirroring permission-face.ts: the resolver is
 * consumed through a local structural type, a missing service or a session
 * whose binding has not materialized degrades to `undefined` (the FaceGate
 * then hides the face), and never throws into the card. The service is
 * deliberately NOT a declared `inject` dependency: a cordis plugin stays
 * pending until every declared name resolves, so a host build without model
 * selection would keep the whole plugin unloaded — a lazy per-call probe
 * degrades this face alone instead.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { registeredFace, type FaceDefinition, type FaceHandle } from './face.ts'
import type { ObservableSource, SessionId } from './conversation-face.ts'

/*
 * Upstream carrier shapes (dsh session-controller/src/types.ts), re-declared
 * structurally: the wire is the host resolver's own objects, these only pin
 * the contract this plugin compiles against.
 */

/** Complete model selection for one session. */
export interface ModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One adapter-owned reasoning effort for an exact model route. */
export interface ModelReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** Selectable reasoning metadata for one exact model route. */
export interface ModelReasoning {
  readonly efforts: readonly ModelReasoningEffort[]
  readonly defaultEffort?: string
}

/** One model displayed inside its provider group. */
export interface ModelCatalogModel {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: ModelReasoning
}

/** One provider and its successfully loaded model catalog. */
export interface ModelProviderGroup {
  readonly id: string
  readonly name: string
  readonly models: readonly ModelCatalogModel[]
}

/** One provider whose model catalog lookup failed. */
export interface ModelCatalogFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

/** Directory snapshot the vendored view renders from (host ModelDirectoryState). */
export interface ModelDirectoryState {
  /** Saved selection, retained even when its provider or model leaves the catalog. */
  readonly current: ModelSelection | null
  /** Saved effort caption retained when the selected model is unavailable. */
  readonly retainedEffort?: string
  /** Whether the current selection is present in the available catalog; null while unresolved. */
  readonly routable: boolean | null
  /** Successfully loaded provider groups (last good load). */
  readonly groups: readonly ModelProviderGroup[]
  /** Provider-local failures from the last load; usable groups stay usable. */
  readonly failures: readonly ModelCatalogFailure[]
  /** Lifecycle of the in-flight operation. */
  readonly status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  /** Selection submitted by the latest `select` until it settles; null otherwise. */
  readonly pending: ModelSelection | null
  /** Whole-request or selection failure text; null when none. */
  readonly error: string | null
}

/** One host RPC outcome (typert-protocol RemoteResult shape). */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The injected business face the vendored ModelSelect renders from (host ModelSelectInjected). */
export interface ModelSelectInjected {
  /** Whether this session supports Agent-bound model inspection and selection. */
  readonly available: boolean
  /** The session's shared directory store (same instance the host entries read). */
  readonly directory: ObservableSource<ModelDirectoryState>
  /** Ensure the shared Host-generation catalog is loaded (errors land on the store). */
  readonly load: () => void
  /**
   * Select a complete provider/model/reasoning selection.
   * @returns the Host outcome, or undefined when this session cannot select a model.
   */
  readonly select: (selection: ModelSelection) => Promise<RemoteResult<void> | undefined>
}

/** One session's shared directory (host ModelDirectory, structural face). */
interface ModelDirectoryFace {
  readonly store: ObservableSource<ModelDirectoryState>
  load(): Promise<ModelDirectoryState>
  select(selection: ModelSelection): Promise<RemoteResult<void>>
}

/** Narrow face of the host `modelDirectories` resolver service. */
interface ModelDirectoriesFace {
  directoryFor(sessionId: SessionId): ModelDirectoryFace
}

/** The host slot key the model label extension registers on. */
export const MODEL_LABEL_SLOT = 'conversation.input.model.label'

/** One winning model-label entry as the card renders it. */
export interface ModelLabelEntry {
  /** The registered component (function, memo, or forwardRef object). */
  readonly component: unknown
  /** The dictionary namespace the renderer synthesizes a `t` seat from. */
  readonly locale?: string | undefined
}

/**
 * The model-label slot face (issue #80): the one winning entry of the host
 * `conversation.input.model.label` slot, its change subscription, and the
 * namespace-bound translate the renderer would have synthesized. The card is
 * NOT a slot outlet, so it reads the registry directly and renders the
 * component itself.
 *
 * Recorded limitation (the ticket's explicit discretion point): the renderer
 * also synthesizes the standard seats (`useSession`, `useProjection`, …) into
 * every entry; a hand render cannot. The shipped label extension uses only
 * `provider`/`model`/`t`, so it renders faithfully; a third-party label that
 * depends on a standard seat falls back to the catalog name on its own
 * render error (the boundary in ModelSelectFace).
 */
export interface ModelLabelSlotFace {
  /** The winning entry, or undefined when the slot is empty. */
  winner(): ModelLabelEntry | undefined
  /** Subscribe to the slot's registration changes. */
  subscribe(listener: () => void): () => void
  /** Bind one entry's dictionary namespace, or undefined when unavailable. */
  translate(namespace: string): ((key: string, params?: Record<string, unknown>) => string) | undefined
}

export type ModelLabelSlotSource = () => ModelLabelSlotFace | undefined

/** Narrow structural face of the host `slots` registry the label read needs. */
interface SlotRegistryFace {
  entriesOfSlot(key: string): readonly unknown[]
  subscribe(key: string, listener: () => void): () => void
}

let labelSlotSource: ModelLabelSlotSource = () => undefined

/**
 * Bind the model-label slot source (the client apply does this once; tests
 * bind fakes through the same seam).
 * @param resolve - lazy resolver; `undefined` = slot registry absent.
 */
export function setModelLabelSlotSource(resolve: ModelLabelSlotSource): void {
  labelSlotSource = resolve
}

/**
 * Install the host `slots` registry reader for the model label (issue #80).
 * The face is built once (its identity is stable across renders, so the
 * consumer's change subscription does not churn); every read stays inside
 * try/catch — a registry surprise degrades the label to the catalog name,
 * never throws into the card.
 * @param ctx - client root context.
 */
export function installModelLabelSlots(ctx: ClientContext): void {
  try {
    const slots = ctx.slots as Partial<SlotRegistryFace> | undefined
    if (typeof slots?.entriesOfSlot !== 'function' || typeof slots.subscribe !== 'function') return
    const registry = slots as SlotRegistryFace
    const face: ModelLabelSlotFace = {
      winner() {
        try {
          const entries = registry.entriesOfSlot(MODEL_LABEL_SLOT)
          if (!Array.isArray(entries) || entries.length === 0) return undefined
          const entry = entries[0] as { readonly component?: unknown; readonly locale?: unknown } | undefined
          if (entry === undefined || entry.component === undefined || entry.component === null) return undefined
          return {
            component: entry.component,
            locale: typeof entry.locale === 'string' ? entry.locale : undefined,
          }
        } catch {
          return undefined
        }
      },
      subscribe(listener) {
        try {
          return registry.subscribe(MODEL_LABEL_SLOT, listener)
        } catch {
          return () => {}
        }
      },
      translate(namespace) {
        try {
          return ctx.locale.bind(namespace) as unknown as
            (key: string, params?: Record<string, unknown>) => string
        } catch {
          return undefined
        }
      },
    }
    setModelLabelSlotSource(() => face)
  } catch {
    setModelLabelSlotSource(() => undefined)
  }
}

/** The model-label slot face, or undefined while no registry is bound. */
export function modelLabelSlotFace(): ModelLabelSlotFace | undefined {
  try {
    return labelSlotSource()
  } catch {
    return undefined
  }
}

/** The subagent share of the session snapshot as the composer chain carries it. */
export type SubagentShare = { readonly address: unknown } | null | undefined

/** The host service surfaces the face needs, resolved per call. */
export type ModelSource = () => ModelDirectoriesFace | undefined

let source: ModelSource = () => undefined
let localeT: TranslateNS<typeof MODEL_NS> | undefined

/** Locale namespace owning the vendored picker's copy (this plugin's own; the host `model` namespace stays untouched). */
export const MODEL_NS = 'markdown-input.model'

/** Face id of the tool-row model control in the face framework. */
export const MODEL_FACE_ID = 'tool.model'

/**
 * Bind the model source (the client apply does this once; the thunk resolves
 * per call so boot order stays free — the resolver materializes when its
 * plugin fiber activates, after sessions and remote exist).
 * @param resolve - lazy resolver; `undefined` = service absent.
 */
export function setModelSource(resolve: ModelSource): void {
  source = resolve
}

/**
 * Install the gateway on the client root context (called once from the
 * plugin apply). The single service read is its own capability check — a
 * host build without model selection reads as absent, never a throw.
 * @param ctx - client root context.
 */
export function installModelSource(ctx: ClientContext): void {
  setModelSource(() => {
    try {
      const directories = ctx.get('modelDirectories') as Partial<ModelDirectoriesFace> | undefined
      if (directories === undefined || directories === null || typeof directories.directoryFor !== 'function') {
        return undefined
      }
      return directories as ModelDirectoriesFace
    } catch {
      return undefined
    }
  })
}

/**
 * Structural probe of the model face: is the host resolver present? Pure —
 * safe to call from a FaceGate probe (no directory creation).
 */
export function modelFaceSupported(): boolean {
  try {
    return source() !== undefined
  } catch {
    return false
  }
}

/**
 * The FaceGate definition of the tool-row model face.
 */
export function modelFaceDefinition(): FaceDefinition {
  return { id: MODEL_FACE_ID, probe: modelFaceSupported }
}

/**
 * The downstream door to the face handle the FaceGate registered: a lookup,
 * never a registration — the gated body reads the verdict and latches
 * mid-life degrades through it.
 */
export function modelFaceHandle(): FaceHandle | undefined {
  return registeredFace(MODEL_FACE_ID)
}

/**
 * The vendored picker's translate function, bound once in apply.
 * @param t - the `MODEL_NS` translate seat.
 */
export function setModelLocale(t: TranslateNS<typeof MODEL_NS>): void {
  localeT = t
}

/** The vendored picker's translate function, or undefined before apply binds it. */
export function modelLocale(): TranslateNS<typeof MODEL_NS> | undefined {
  return localeT
}

/**
 * The session's injected model face, mirroring the host seat's inject: the
 * shared directory resolves through the host resolver (which fails loud for
 * a session binding that has not materialized — read as face-absent so a
 * composer frame rendering before the shell retries on a later render), and
 * an addressed subagent session resolves it but exposes no verbs (the
 * component then hides; Agent-bound RPCs must not activate persisted
 * history outside the direct-parent continuation path).
 * @param sessionId - owning session.
 * @param subagent - the session snapshot's subagent share (null = ordinary session).
 */
export function modelSeatFace(sessionId: SessionId, subagent: SubagentShare): ModelSelectInjected | undefined {
  let directory: ModelDirectoryFace
  try {
    directory = source()?.directoryFor(sessionId) as ModelDirectoryFace
  } catch {
    return undefined
  }
  if (directory === undefined || directory === null) return undefined
  const available = subagent == null
  return {
    available,
    directory: directory.store,
    load: () => {
      if (available) void directory.load().catch(() => { /* surfaced on the store */ })
    },
    select: (selection: ModelSelection) => available
      ? directory.select(selection)
      : Promise.resolve(undefined),
  }
}

/**
 * Test seam: drop the singleton, the source, and the bound locale so a fresh
 * test sees fresh surfaces. Never call in plugin code — the face is
 * page-lifetime by design.
 */
export function resetModelFace(): void {
  source = () => undefined
  localeT = undefined
  labelSlotSource = () => undefined
}
