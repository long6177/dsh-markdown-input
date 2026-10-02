/**
 * Per-face capability probing and degradation for the takeover card
 * (ADR-0005 hardening #2). The card is a federation of faces — the editor
 * face, one face per tool-row control, one per popup — and alpha.0's lesson
 * is that no single host dependency may take the whole card down. Each face
 * registers here and probes its own host dependencies (injected services,
 * RPC verbs, projection keys); a probe miss or a mid-life failure degrades
 * that face alone, never the card.
 *
 * Registration is the framework's one door: a face declares its id and its
 * probe once, gets back a latched handle, and everything downstream (the
 * FaceGate renderer, tool-row and popup faces from T3–T5 on) reads the same
 * verdict. The editor face is the one escalation: its degradation is the
 * card-level fallback (degrade.ts), not a face-local substitution.
 */
import { probe, type Capability } from './capability.ts'

/** Declaration of one takeover-card face: an id and the feature check. */
export interface FaceDefinition {
  /**
   * Stable face id — `editor` is the text face; tool-row and popup faces
   * use dotted ids (`tool.commands`, `popup.permission`, …).
   */
  readonly id: string
  /**
   * Feature check over the face's own host dependencies. A throw inside the
   * probe (sealed globals, exotic host builds) is a failed verdict, not a
   * crash — probing must be the safest thing a face does.
   */
  readonly probe: () => boolean
}

/** A registered face: lazy one-shot probe, mid-life degrade, events. */
export interface FaceHandle {
  readonly id: string
  /**
   * The face's capability verdict, latched: the probe runs on the first
   * read and the verdict never changes afterwards — host dependencies are
   * structural (a renamed host export does not heal between renders).
   * Safe to call during render; a miss is reported on the console once.
   */
  verdict(): Capability
  /**
   * Latch the face off mid-life (the face's own error path — a caught
   * exception, an RPC that stopped resolving). The first reason wins;
   * a probe-missed face ignores further degrades. Fires the degrade event.
   */
  degrade(reason: string): void
  /**
   * Mid-life degrade event: fires when the face latches off after having
   * been supported (probe misses are visible through `verdict()` instead).
   * Listeners run in subscription order; a throwing listener is contained.
   */
  onDegrade(listener: (verdict: Capability) => void): () => void
}

/** Registered faces, keyed by id. Page-lifetime: the registry resets with the browser half. */
const faces = new Map<string, FaceHandle>()

/**
 * Register a takeover-card face. Idempotent: the first definition for an id
 * wins and later registrations (per-render calls in component bodies) return
 * the same handle — a face's probe verdict is latched for the page life.
 * @param definition - the face id and its capability probe.
 */
export function registerFace(definition: FaceDefinition): FaceHandle {
  const existing = faces.get(definition.id)
  if (existing !== undefined) return existing
  const handle = createFace(definition)
  faces.set(definition.id, handle)
  return handle
}

function createFace(definition: FaceDefinition): FaceHandle {
  let verdict: Capability | undefined
  const listeners = new Set<(verdict: Capability) => void>()
  return {
    id: definition.id,
    verdict(): Capability {
      if (verdict === undefined) {
        verdict = probe(definition.probe, `face "${definition.id}" host dependencies missing`)
        if (!verdict.supported) {
          console.error(`[markdown-input] ${verdict.reason}; degrading the face`)
        }
      }
      return verdict
    },
    degrade(reason: string): void {
      if (verdict !== undefined && !verdict.supported) return
      const failed: Capability = { supported: false, reason }
      console.error(`[markdown-input] face "${definition.id}" degraded mid-life: ${reason}`)
      verdict = failed
      for (const listener of [...listeners]) {
        try {
          listener(failed)
        } catch (listenerError: unknown) {
          console.error('[markdown-input] face degrade listener failed', listenerError)
        }
      }
    },
    onDegrade(listener: (verdict: Capability) => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Read an already-registered face by id WITHOUT registering one. The
 * downstream door for faces whose FaceGate owns the definition: a gated
 * body reads its verdict and latches mid-life degrades through this, and
 * can never latch its own unconditional probe ahead of the gate's — a body
 * rendered without its gate gets undefined, not a false verdict.
 * @param id - the face id the gate registered.
 */
export function registeredFace(id: string): FaceHandle | undefined {
  return faces.get(id)
}

/**
 * Test seam: clear the registry so a fresh test sees fresh probes. Never
 * call in plugin code — a face's verdict is page-lifetime by design.
 */
export function resetFaces(): void {
  faces.clear()
}
