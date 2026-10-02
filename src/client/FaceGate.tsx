/**
 * The React door of the face framework (face.ts): one gate per face of the
 * takeover card. A face's body renders only when its probe verdict is
 * supported; a probe miss or a mid-life render exception inside the body
 * degrades that face alone — the fallback (default: nothing) takes its
 * place and the rest of the card stays up. Tool-row and popup faces (T3–T5)
 * each mount inside their own gate, so a rebuilt face can never take the
 * card down the way alpha.0 did.
 */
import { Component, type ReactNode } from 'react'
import { registerFace, type FaceDefinition, type FaceHandle } from './face.ts'

/** Props of one face gate. */
export interface FaceGateProps {
  /**
   * The face definition. Registration is idempotent per id — the first
   * mount's definition wins and the verdict latches for the page life, so
   * an inline definition object is safe here.
   */
  readonly definition: FaceDefinition
  /** What takes the face's place when it degrades; nothing by default. */
  readonly fallback?: ReactNode
  /** The face body — its probe-met, exception-contained contents. */
  readonly children: ReactNode
}

/**
 * Gate one face of the takeover card: probe verdict outside, per-face
 * error boundary inside.
 * @param props - face definition, fallback slot, face body.
 * @returns the face body, or the fallback once the face has degraded.
 */
export function FaceGate(props: FaceGateProps): ReactNode {
  const face = registerFace(props.definition)
  if (!face.verdict().supported) return props.fallback ?? null
  return <FaceBoundary face={face} fallback={props.fallback}>{props.children}</FaceBoundary>
}

interface FaceBoundaryState {
  readonly degraded: boolean
}

/**
 * The per-face boundary: a render exception inside one face latches that
 * face off (framework degrade path, console report included) and swaps in
 * the fallback — the frames in between render nothing, exactly like the
 * card-level boundary but scoped to the face.
 */
class FaceBoundary extends Component<{ face: FaceHandle; fallback?: ReactNode; children: ReactNode }, FaceBoundaryState> {
  override state: FaceBoundaryState = { degraded: false }

  static getDerivedStateFromError(): FaceBoundaryState {
    return { degraded: true }
  }

  override componentDidCatch(error: unknown): void {
    this.props.face.degrade(error instanceof Error ? error.message : String(error))
  }

  override render(): ReactNode {
    return this.state.degraded ? this.props.fallback ?? null : this.props.children
  }
}
