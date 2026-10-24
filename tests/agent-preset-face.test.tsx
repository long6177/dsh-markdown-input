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
  agentPresetsRemoteFace, developerToolsEnabledOf, developerToolsStore,
  DEVELOPER_TOOLS_NAMESPACE, installDeveloperToolsSource, resetAgentPresetsSource,
  resetDeveloperToolsSource, setAgentPresetsSource,
  type AgentPresetsRemoteFace, type DeveloperToolsSnapshot,
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
  developerTools?: DeveloperToolsStore | undefined
} = {}) {
  return render(
    <AgentPresetFace
      useProjection={projection(overrides.projection ?? { agentPreset: null })}
      sessionId={overrides.sessionId === undefined ? 's1' : overrides.sessionId}
      remote={overrides.remote === undefined ? ROSTER : overrides.remote as AgentPresetsRemoteFace | undefined}
      translate={overrides.translate}
      copy={copy}
      onError={overrides.onError ?? (() => {})}
      developerTools={overrides.developerTools}
    />,
  )
}

/** A roster stub whose `select` settles with the given result. */
type AgentPresetRemote = {
  list: AgentPresetsRemoteFace['list']
  select: AgentPresetsRemoteFace['select']
}

/** A settable Developer-tools form double (the shape configForms hands out). */
function devToolsStore(enabled: boolean | undefined): DeveloperToolsStore & {
  set: (enabled: boolean | undefined) => void
} {
  let snapshot: DeveloperToolsSnapshot | undefined = { value: { enabled } }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: boolean | undefined) => {
      snapshot = { value: { enabled: next } }
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A roster carrying the two tool presets plus the standard trio of the other fixtures. */
const TOOL_ROSTER: AgentPresetRemote = {
  list: () => Promise.resolve({
    ok: true,
    value: {
      presets: [
        { id: 'standard', isDefault: true },
        { id: 'ptc' },
        { id: 'minimal' },
        { id: 'cordis', name: 'Creator mode', description: 'Build plugins by talking.' },
        { id: 'mine' },
      ],
    },
  }),
  select: ROSTER.select,
}

afterEach(() => {
  cleanup()
  resetFaces()
  resetAgentPresetsSource()
  resetDeveloperToolsSource()
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

describe('AgentPresetFace developer-tools gate (#78)', () => {
  it('hides the tool presets from the menu when developer tools are off, keeping the rest', async () => {
    renderFace({ remote: TOOL_ROSTER, developerTools: devToolsStore(false) })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    const labels = menuRows().map(row => row.textContent)
    expect(labels).toHaveLength(3)
    expect(labels.some(text => text?.includes('standard'))).toBe(true)
    expect(labels.some(text => text?.includes('Creator mode'))).toBe(true)
    expect(labels.some(text => text?.includes('mine'))).toBe(true)
    expect(labels.some(text => text?.includes('ptc'))).toBe(false)
    expect(labels.some(text => text?.includes('minimal'))).toBe(false)
  })

  it('offers every healthy row while developer tools are on', async () => {
    renderFace({ remote: TOOL_ROSTER, developerTools: devToolsStore(true) })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    expect(menuRows()).toHaveLength(5)
  })

  it('keeps the current mode named on a disabled chip without opening a picker when all options are hidden', async () => {
    // Upstream `components.client.spec.tsx:121`: the current tool preset still
    // labels the chip (unfiltered list), but the menu never opens.
    const toolsOnly: AgentPresetRemote = {
      list: () => Promise.resolve({ ok: true, value: { presets: [{ id: 'ptc' }, { id: 'minimal' }] } }),
      select: ROSTER.select,
    }
    renderFace({
      remote: toolsOnly,
      projection: { agentPreset: 'minimal' },
      developerTools: devToolsStore(false),
    })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    expect(chip()).toHaveTextContent('minimal')
    expect(chip()).toBeDisabled()
    fireEvent.click(chip() as HTMLButtonElement)
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
    expect(menuRows()).toHaveLength(0)
  })

  it('keeps a named custom row overriding a development id when developer tools are off', async () => {
    const override: AgentPresetRemote = {
      list: () => Promise.resolve({ ok: true, value: { presets: [{ id: 'ptc', name: 'My workflow' }] } }),
      select: ROSTER.select,
    }
    renderFace({ remote: override, developerTools: devToolsStore(false) })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    expect(menuRows()).toHaveLength(1)
    expect(menuRows()[0]?.textContent).toContain('My workflow')
  })

  it('closes the menu immediately when developer tools turn off', async () => {
    const tools = devToolsStore(true)
    renderFace({ remote: TOOL_ROSTER, developerTools: tools })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    expect(menuRows()).toHaveLength(5)
    tools.set(false)
    await waitFor(() => { expect(menuRows()).toHaveLength(0) })
    expect(chip()).toHaveAttribute('aria-expanded', 'false')
    // Turning them back on does not re-open the menu by itself.
    tools.set(true)
    expect(menuRows()).toHaveLength(0)
  })

  it('reads an absent developer-tools store as off (the native ?? false)', async () => {
    renderFace({ remote: TOOL_ROSTER, developerTools: undefined })
    await waitFor(() => { expect(chip()).not.toBeNull() })
    fireEvent.click(chip() as HTMLButtonElement)
    expect(menuRows()).toHaveLength(3)
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

describe('developer tools settings source (the native gate signal, #78)', () => {
  /** A configForms service double carrying the given namespaces. */
  function configForms(forms: Record<string, unknown>): { get(namespace: string): unknown } {
    return { get: (namespace: string) => forms[namespace] }
  }

  /** A snapshot-store form double (the shape configForms hands out). */
  function storeForm(snapshot: DeveloperToolsSnapshot | undefined) {
    let current = snapshot
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next: DeveloperToolsSnapshot) => {
        current = next
        for (const listener of [...listeners]) listener()
      },
    }
  }

  it('reads the enabled field off the snapshot, defaulting to off (the native ?? false)', () => {
    expect(developerToolsEnabledOf(undefined)).toBe(false)
    expect(developerToolsEnabledOf({})).toBe(false)
    expect(developerToolsEnabledOf({ value: undefined })).toBe(false)
    expect(developerToolsEnabledOf({ value: { enabled: true } })).toBe(true)
    expect(developerToolsEnabledOf({ value: { enabled: false } })).toBe(false)
  })

  it('resolves the ui-settings form through configForms, capability-detected', () => {
    const form = storeForm({ value: { enabled: true } })
    installDeveloperToolsSource({ get: (key: string) =>
      key === 'configForms' ? configForms({ [DEVELOPER_TOOLS_NAMESPACE]: form }) : undefined } as never)
    expect(developerToolsStore()).toBe(form)
    resetDeveloperToolsSource()
    expect(developerToolsStore()).toBeUndefined()
  })

  it('reads an absent service, an absent form, or a half-shaped form as absent', () => {
    // No configForms service at all.
    installDeveloperToolsSource({ get: () => undefined } as never)
    expect(developerToolsStore()).toBeUndefined()
    // The service answers, the namespace has no form.
    installDeveloperToolsSource({ get: (key: string) =>
      key === 'configForms' ? configForms({}) : undefined } as never)
    expect(developerToolsStore()).toBeUndefined()
    // A form without the snapshot-store face is not a form.
    installDeveloperToolsSource({ get: (key: string) =>
      key === 'configForms' ? configForms({ [DEVELOPER_TOOLS_NAMESPACE]: { getSnapshot: () => undefined } }) : undefined } as never)
    expect(developerToolsStore()).toBeUndefined()
    // Sealed globals: a throwing probe is absence, never a crash.
    installDeveloperToolsSource({ get: () => { throw new Error('sealed') } } as never)
    expect(developerToolsStore()).toBeUndefined()
    // Uninstalled (the fresh-page shape).
    resetDeveloperToolsSource()
    expect(developerToolsStore()).toBeUndefined()
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
