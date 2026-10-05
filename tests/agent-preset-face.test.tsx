/**
 * The Agent-preset seat (issue #42, ADR-0006 option B) at the component seam:
 * the chip names the current value, the menu switches it, a refused switch
 * surfaces through the card's banner callback, and the whole face hides when
 * the roster service or the projection is absent.
 *
 * Display copy (alpha.12 feedback): the seat's words are the HOST
 * `settings.agentPreset` dictionary's (the fixture below copies it verbatim),
 * with the plugin's own keys as the fallback a host build without the
 * namespace still speaks.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  AgentPresetFace, agentPresetFaceDefinition,
  type AgentPresetFaceProps,
} from '../src/client/AgentPresetFace.tsx'
import {
  agentPresetsRemoteFace, resetAgentPresetsSource, setAgentPresetsSource,
  type AgentPresetsRemoteFace,
} from '../src/client/agent-preset-face.ts'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'
import type { BuiltInPresetCopyKey } from '../src/client/agent-preset-core.ts'

const copy = {
  seatHint: en['agentPreset.hint'],
  noDescription: en['agentPreset.noDescription'],
  switchRefused: en['agentPreset.switchRefused'],
}

/**
 * The host `settings.agentPreset` dictionary's display copy, verbatim from
 * `ui-agent-preset/src/client/locales.ts` (en) — the very words the native
 * chip renders for a shipped preset whose row publishes no `name`.
 */
export const HOST_DICT: Record<string, string> = {
  presetStandardName: 'Standard mode',
  presetStandardDescription: 'Work with code, files, and information.',
  presetPtcName: 'PTC mode',
  presetPtcDescription: 'Batch tool calls, then filter and summarize.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription: 'Terminal tool only.',
  presetCordisName: 'Creator mode',
  presetCordisDescription: 'Customize DSH through conversation.',
  seatHint: 'Choose the agent preset for your new task',
  noDescription: 'No description.',
  switchRefused: 'Could not switch to {name}: {reason}',
}

export const HOST_T = (key: BuiltInPresetCopyKey): string => HOST_DICT[key] ?? key

const ROSTER: AgentPresetsRemoteFace = {
  list: () => Promise.resolve({
    ok: true,
    value: {
      presets: [
        { id: 'standard', isDefault: true },
        { id: 'cordis', name: 'Creator mode', description: 'Build plugins by talking.' },
        { id: 'broken', broken: 'cannot mount', isDefault: false },
      ],
    },
  }),
  select: () => Promise.resolve({ ok: true, value: undefined }),
}

/** Read one projection key off a table, undefined for any absent key. */
function projection(table: Record<string, unknown>): AgentPresetFaceProps['useProjection'] {
  return ((key: string) => key in table ? table[key] : undefined) as AgentPresetFaceProps['useProjection']
}

function chip(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('[data-markdown-agent-preset] button')
}

function menuRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function renderFace(overrides: {
  projection?: Record<string, unknown>
  remote?: AgentPresetRemote
  sessionId?: string | undefined
  onError?: (message: string) => void
  translate?: ((key: BuiltInPresetCopyKey) => string) | undefined
} = {}) {
  return render(
    <AgentPresetFace
      useProjection={projection(overrides.projection ?? { agentPreset: null })}
      sessionId={overrides.sessionId === undefined ? 's1' : overrides.sessionId}
      remote={overrides.remote === undefined ? ROSTER : overrides.remote as AgentPresetsRemoteFace | undefined}
      translate={overrides.translate}
      copy={copy}
      onError={overrides.onError ?? (() => {})}
    />,
  )
}

/** A roster stub whose `select` settles with the given result. */
type AgentPresetRemote = {
  list: AgentPresetsRemoteFace['list']
  select: AgentPresetsRemoteFace['select']
}

afterEach(() => {
  cleanup()
  resetFaces()
  resetAgentPresetsSource()
})

describe('AgentPresetFace visibility', () => {
  it('renders nothing when the projection key was never contributed', async () => {
    const { container } = renderFace({ projection: {} })
    await waitFor(() => { expect(container).toBeEmptyDOMElement() })
    expect(chip()).toBeNull()
  })

  it('renders nothing when the roster offers no healthy preset', async () => {
    const empty: AgentPresetRemote = {
      list: () => Promise.resolve({ ok: true, value: { presets: [{ id: 'broken', broken: 'x' }] } }),
      select: ROSTER.select,
    }
    const { container } = renderFace({ remote: empty })
    await waitFor(() => { expect(container).toBeEmptyDOMElement() })
    expect(chip()).toBeNull()
  })

  it('renders nothing when the roster service is absent', () => {
    const { container } = renderFace({ remote: undefined, projection: { agentPreset: null } })
    expect(container).toBeEmptyDOMElement()
    expect(chip()).toBeNull()
  })

  it('names the deployment default on a live projection with no recorded preset', async () => {
    renderFace()
    await waitFor(() => { expect(chip()).not.toBeNull() })
    expect(chip()).toHaveTextContent('standard')
    expect(chip()).toHaveAttribute('aria-haspopup', 'menu')
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
    expect(chip()).toHaveAttribute('title', copy.seatHint)
  })

  it('names the recorded preset when the session projection carries one', async () => {
    renderFace({ projection: { agentPreset: 'cordis' } })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    expect(chip()).toHaveTextContent('Creator mode')
  })

  it('reports a failed roster read through the card banner and stays hidden', async () => {
    const onError = vi.fn()
    const failing: AgentPresetRemote = {
      list: () => Promise.resolve({
        ok: false,
        error: { code: 'gateway/error', message: 'roster unavailable' },
      }),
      select: ROSTER.select,
    }
    const { container } = renderFace({ remote: failing, onError })
    await waitFor(() => { expect(onError).toHaveBeenCalledWith('roster unavailable') })
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AgentPresetFace menu', () => {
  it('lists the healthy roster as name over description, with the current row checked', async () => {
    renderFace()
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    const rows = menuRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('standard')
    expect(rows[0]?.textContent).toContain(copy.noDescription)
    expect(rows[1]?.textContent).toContain('Creator mode')
    expect(rows[1]?.textContent).toContain('Build plugins by talking.')
    // The current value carries the trailing check.
    expect(rows[0]?.querySelector('svg')).not.toBeNull()
    expect(rows[1]?.querySelector('svg')).toBeNull()
    expect(chip()).toHaveAttribute('aria-expanded', 'true')
  })

  it('switches through the remote verb and closes the menu', async () => {
    const select = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }))
    const remote: AgentPresetRemote = { list: ROSTER.list, select }
    renderFace({ remote })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    fireEvent.click(menuRows()[1] as HTMLElement)
    expect(select).toHaveBeenCalledWith('s1', 'cordis')
    expect(menuRows()).toHaveLength(0)
  })

  it('surfaces a refused switch through the banner callback with the reason detail', async () => {
    const onError = vi.fn()
    const refusing: AgentPresetRemote = {
      list: ROSTER.list,
      select: () => Promise.resolve({
        ok: false,
        error: {
          code: 'agent-preset/locked',
          message: 'wrapped',
          details: { sessionId: 's1', reason: 'the conversation has started' },
        },
      }),
    }
    renderFace({ remote: refusing, onError })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        copy.switchRefused.replace('{reason}', 'the conversation has started'),
      )
    })
  })

  it('closes the menu on Escape', async () => {
    renderFace()
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    expect(menuRows()).toHaveLength(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menuRows()).toHaveLength(0)
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('AgentPresetFace gate', () => {
  it('renders no seat at all when the remote namespace is missing', () => {
    const { container } = render(
      <FaceGate definition={agentPresetFaceDefinition(projection({ agentPreset: null }), false)}>
        <AgentPresetFace
          useProjection={projection({ agentPreset: null })}
          sessionId="s1"
          remote={undefined}
          translate={undefined}
          copy={copy}
          onError={() => {}}
        />
      </FaceGate>,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders no seat when the projection seat is absent', () => {
    const { container } = render(
      <FaceGate definition={agentPresetFaceDefinition(undefined, true)}>
        <AgentPresetFace
          useProjection={projection({})}
          sessionId="s1"
          remote={undefined}
          translate={undefined}
          copy={copy}
          onError={() => {}}
        />
      </FaceGate>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('resolveAgentPresetsRemote', () => {
  it('resolves the namespace lazily and refuses an incomplete surface', () => {
    setAgentPresetsSource(() => ROSTER)
    expect(agentPresetsRemoteFace()).toBe(ROSTER)
    setAgentPresetsSource(() => undefined)
    expect(agentPresetsRemoteFace()).toBeUndefined()
    // A throwing resolver (sealed globals, exotic host builds) reads as absent.
    setAgentPresetsSource(() => { throw new Error('sealed') })
    expect(agentPresetsRemoteFace()).toBeUndefined()
  })
})

describe('AgentPresetFace host-dictionary copy (alpha.12 feedback #42)', () => {
  it('names a shipped preset through the host dictionary on the chip', async () => {
    renderFace({ translate: HOST_T })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    expect(chip()).toHaveTextContent('Standard mode')
  })

  it('renders the menu rows with the localized name over the localized description, check on the current row', async () => {
    renderFace({ translate: HOST_T })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    const rows = menuRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('Standard mode')
    expect(rows[0]?.textContent).toContain('Work with code, files, and information.')
    // The custom row keeps its own published metadata — never translated.
    expect(rows[1]?.textContent).toContain('Creator mode')
    expect(rows[1]?.textContent).toContain('Build plugins by talking.')
    // The current value carries the trailing check.
    expect(rows[0]?.querySelector('svg')).not.toBeNull()
    expect(rows[1]?.querySelector('svg')).toBeNull()
  })

  it('interpolates {name} into the host refusal template with the picked row display name', async () => {
    const onError = vi.fn()
    const refusing: AgentPresetRemote = {
      list: ROSTER.list,
      select: () => Promise.resolve({ ok: false, error: { code: 'agent-preset/locked', message: 'wrapped' } }),
    }
    render(
      <AgentPresetFace
        useProjection={projection({ agentPreset: null })}
        sessionId="s1"
        remote={refusing as AgentPresetsRemoteFace | undefined}
        translate={HOST_T}
        copy={{ ...copy, switchRefused: HOST_DICT['switchRefused'] ?? copy.switchRefused }}
        onError={onError}
      />,
    )
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    fireEvent.click(menuRows()[1] as HTMLElement)
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Could not switch to Creator mode: wrapped')
    })
  })

  it('anchors the open menu to the chip rect, not the zero-geometry wrapper', async () => {
    renderFace()
    await waitFor(() => { expect(chip()).not.toBeNull() })
    const chipEl = chip() as HTMLButtonElement
    vi.spyOn(chipEl, 'getBoundingClientRect').mockReturnValue({
      x: 42, y: 7, left: 42, top: 7, right: 100, bottom: 35, width: 58, height: 28, toJSON: () => ({}),
    } as DOMRect)
    fireEvent.click(chipEl)
    const list = document.querySelector('[role="menu"]') as HTMLElement | null
    expect(list).not.toBeNull()
    // The portaled list positions from the chip rect (side bottom, align
    // start): left at the chip's left edge, top 4px under its bottom edge.
    expect(list?.style.left).toBe('42px')
    expect(list?.style.top).toBe('39px')
  })
})
