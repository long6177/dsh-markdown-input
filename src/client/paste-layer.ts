/**
 * L3 paste layer skeleton (issue #14, ADR-0003): rich-text paste converts
 * to clean Markdown (paste-converter.ts) and writes through the host's
 * version-guarded insertion API — one undo step at the caret, while plain
 * text, file, and image pastes keep their native behavior.
 *
 * This ticket (#13) ships the degradation skeleton only: the structural
 * probe over the input face the layer drives. Wiring that face from the
 * conversation service and the paste handler land with #14.
 */
import { probe, type Capability } from './capability.ts'

/**
 * The slice of the rc.2 `InputActions` face the paste layer drives
 * (`captureInsertion` + `insertText`, the version-guarded caret insertion).
 * A structural mirror, not an import: the face reaches this layer as an
 * unknown-shaped value from the conversation service, and a host that
 * dropped the verbs must read as unsupported, not as a type error.
 */
export interface InsertionFace {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

/**
 * Probe one candidate face for the guarded insertion API. A host build
 * that moved or dropped the verbs disables the paste layer (paste stays
 * native); the converter module itself stays import-safe either way.
 * @param face - candidate input face of unknown shape.
 */
export function insertionCapability(face: unknown): Capability {
  return probe(
    () => {
      if (typeof face !== 'object' || face === null) return false
      const candidate = face as Partial<InsertionFace>
      return typeof candidate.captureInsertion === 'function'
        && typeof candidate.insertText === 'function'
    },
    'guarded insertion API (captureInsertion/insertText) unavailable',
  )
}
