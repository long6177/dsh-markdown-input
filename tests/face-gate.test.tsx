/**
 * The React door of the face framework: FaceGate renders a face's body only
 * while the face is supported — a probe miss or a mid-life render exception
 * degrades that face alone into the fallback slot, and the rest of the card
 * keeps rendering. This is the containment T3–T5 mount their faces inside.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'

afterEach(() => {
  cleanup()
  resetFaces()
  vi.restoreAllMocks()
})

describe('FaceGate', () => {
  it('renders the body while the probe supports the face', () => {
    const { getByText } = render(
      <FaceGate definition={{ id: 'tool.test', probe: () => true }}>
        <span>face body</span>
      </FaceGate>,
    )
    expect(getByText('face body')).toBeInTheDocument()
  })

  it('swaps in the fallback and skips the body on a probe miss', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getByText, queryByText } = render(
      <FaceGate
        definition={{ id: 'tool.test', probe: () => false }}
        fallback={<span>native control</span>}
      >
        <span>face body</span>
      </FaceGate>,
    )
    expect(getByText('native control')).toBeInTheDocument()
    expect(queryByText('face body')).toBeNull()
  })

  it('renders nothing when degraded and no fallback is given', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <FaceGate definition={{ id: 'tool.test', probe: () => false }}>
        <span>face body</span>
      </FaceGate>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('a render exception in the body degrades that face alone', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bomber(): never {
      throw new Error('face exploded')
    }
    const { getByText, queryByText } = render(
      <div>
        <FaceGate
          definition={{ id: 'tool.bomb', probe: () => true }}
          fallback={<span>bomb fallback</span>}
        >
          <Bomber />
        </FaceGate>
        <FaceGate definition={{ id: 'tool.sibling', probe: () => true }}>
          <span>sibling body</span>
        </FaceGate>
      </div>,
    )
    expect(getByText('bomb fallback')).toBeInTheDocument()
    expect(getByText('sibling body')).toBeInTheDocument()
    expect(consoleError.mock.calls.some(call => String(call[0]).includes('tool.bomb'))).toBe(true)
    expect(queryByText('face body')).toBeNull()
  })

  it('a degraded face stays degraded on remount (latched verdict)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Bomber(): never {
      throw new Error('face exploded')
    }
    const gate = (
      <FaceGate
        definition={{ id: 'tool.bomb', probe: () => true }}
        fallback={<span>bomb fallback</span>}
      >
        <Bomber />
      </FaceGate>
    )
    const first = render(gate)
    expect(first.getByText('bomb fallback')).toBeInTheDocument()
    first.unmount()
    const second = render(gate)
    expect(second.getByText('bomb fallback')).toBeInTheDocument()
  })
})
