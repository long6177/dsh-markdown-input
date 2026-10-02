/**
 * Seam: the permission pill and its preset popup as the user sees them.
 * The pill's label is the `permissions` projection's preset name (never a
 * static word), the popup is the primitives Menu opening upward through a
 * portal with the trailing-check selection, full access rides the risk
 * confirmation, and a switch writes `/permission <preset>` through the
 * session face with no optimistic commit — the projection frame is the one
 * confirmation, a failed write reverts the display.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  displayPermissionPreset, PermissionSelectFace,
  type PermissionSelectFaceProps,
} from '../src/client/PermissionSelectFace.tsx'
import {
  permissionFaceDefinition, resetPermissionFace, setPermissionSource,
} from '../src/client/permission-face.ts'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'

const CATALOG = {
  options: [
    { value: 'read-only', name: 'read-only' },
    { value: 'workspace-write', name: 'workspace-write' },
    {
      value: 'danger-full-access', name: 'danger-full-access',
      description: 'Full file access without approval prompts.',
    },
  ],
}

function fakeT(key: keyof typeof en, params?: Record<string, string>): string {
  return en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
}

function pill(): HTMLElement {
  return document.querySelector('button[data-permission-pill]') as HTMLElement
}

function menuRows(): HTMLElement[] {
  return [...document.body.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[]
}

/** The pill appears once the mount-time catalog read settles. */
async function whenPill(): Promise<HTMLElement> {
  return vi.waitFor(() => {
    const trigger = pill()
    expect(trigger).not.toBeNull()
    return trigger
  })
}

/**
 * Bind a catalog-serving permission source and build the component props.
 * `projection.current` is the mutable projection frame: the fake hook reads
 * it per render, so a test can push the pushed-back frame and watch the
 * pill follow it.
 */
function mountFace(options: {
  selection?: { currentValue: string } | undefined
  sessionId?: string | undefined
  locked?: boolean
  sessions?: Map<string, { command: ReturnType<typeof vi.fn> }>
  catalogResult?: unknown
} = {}) {
  const onError = vi.fn()
  // `'selection' in options` keeps an explicit undefined (missing projection
  // key) distinct from the default current value.
  const projection = { current: 'selection' in options ? options.selection : { currentValue: 'workspace-write' } }
  const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } }))
  const sessions = options.sessions ?? new Map([['s1', { command }]])
  setPermissionSource(() => ({
    presets: { catalog: vi.fn(() => Promise.resolve(options.catalogResult ?? { ok: true, value: CATALOG })) },
    remoteEvents: { $on: vi.fn(() => () => {}) },
    sessions: { binding: (id: string) => {
      const session = sessions.get(id)
      return session === undefined ? undefined : { session }
    } },
  }))
  const props = {
    useProjection: (() => projection.current) as unknown as PermissionSelectFaceProps['useProjection'],
    sessionId: options.sessionId ?? 's1',
    t: fakeT as unknown as PermissionSelectFaceProps['t'],
    locked: options.locked ?? false,
    onError,
  } as unknown as PermissionSelectFaceProps
  // Production shape: the body renders inside its FaceGate — the gate owns
  // the probe and the face handle the body degrades through.
  const view = render(
    <FaceGate definition={permissionFaceDefinition(props.useProjection)}>
      <PermissionSelectFace {...props} />
    </FaceGate>,
  )
  const rerender = (): void => { view.rerender(<PermissionSelectFace {...props} />) }
  return { view, rerender, onError, projection, command, sessions }
}

afterEach(() => {
  cleanup()
  resetPermissionFace()
  resetFaces()
})

describe('PermissionSelectFace pill', () => {
  it('names the projection\'s current preset, not a static word', async () => {
    mountFace({ selection: { currentValue: 'workspace-write' } })
    const trigger = await whenPill()
    expect(trigger).toHaveTextContent('Workspace Write')
    expect(trigger).toHaveAttribute('aria-label', 'Access mode, current: Workspace Write')
  })

  it('renders nothing while the projection key is missing', async () => {
    const { view } = mountFace({ selection: undefined })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(view.container).toBeEmptyDOMElement()
  })

  it('renders nothing while the catalog has no value (failed read included)', async () => {
    const { view } = mountFace({ catalogResult: { ok: false, error: { code: 'x', message: 'no' } } })
    await new Promise((resolve) => { setTimeout(resolve, 10) })
    expect(view.container).toBeEmptyDOMElement()
  })

  it('disables the pill while locked', async () => {
    mountFace({ locked: true })
    expect(await whenPill()).toBeDisabled()
  })

  it('carries the host description of the current preset as its tooltip', async () => {
    mountFace({ selection: { currentValue: 'danger-full-access' } })
    expect(await whenPill()).toHaveAttribute('title', 'Full file access without approval prompts.')
  })
})

describe('PermissionSelectFace popup', () => {
  it('opens the three-preset menu upward through a portal with a trailing check on the current row', async () => {
    mountFace({ selection: { currentValue: 'workspace-write' } })
    await whenPill()
    expect(document.querySelector('[role="menu"]')).toBeNull()
    fireEvent.click(pill())
    const menu = document.body.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    const rows = menuRows()
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      'Read Only', 'Workspace Write', 'Full access',
    ])
    // Selection is the trailing check only: the selected row carries its
    // glyph + check (two svgs), every other row just its glyph (one).
    const svgCounts = rows.map((row) => row.querySelectorAll('svg').length)
    expect(svgCounts).toEqual([1, 2, 1])
  })

  it('Escape closes the popup', async () => {
    mountFace()
    await whenPill()
    fireEvent.click(pill())
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('PermissionSelectFace switching', () => {
  it('writes /permission <token> with the preset id through the live session', async () => {
    const { command } = mountFace()
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => expect(command).toHaveBeenCalledWith('/permission read-only'))
  })

  it('does not rewrite the current value (same pick is a no-op)', async () => {
    const { command } = mountFace()
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[1] as HTMLElement)
    expect(command).not.toHaveBeenCalled()
  })

  it('never commits the pick locally: an unsettled write disables the pill, a settled one without a projection frame reverts', async () => {
    let settle: ((value: unknown) => void) | undefined
    const pending = vi.fn(() => new Promise((resolve) => { settle = resolve }))
    mountFace({ sessions: new Map([['s1', { command: pending }]]) })
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => expect(pending).toHaveBeenCalled())
    // In flight: the pill shows the pick and is busy-disabled.
    expect(pill()).toBeDisabled()
    expect(pill()).toHaveTextContent('Read Only')
    // The write settles, but no projection frame pushed yet — the display
    // reverts to the projection's value and the pill re-enables.
    settle?.({ ok: true, value: { matched: true } })
    await waitFor(() => expect(pill()).not.toBeDisabled())
    expect(pill()).toHaveTextContent('Workspace Write')
  })

  it('follows the pushed projection frame once it arrives', async () => {
    const { projection, rerender } = mountFace()
    await whenPill()
    projection.current = { currentValue: 'read-only' }
    rerender()
    expect(pill()).toHaveTextContent('Read Only')
  })

  it('a failed write surfaces the error through the card banner and keeps the pill', async () => {
    const failing = vi.fn(() => Promise.resolve({
      ok: false, error: { code: 'permission/unknown', message: 'unknown preset "x"' },
    }))
    const { onError } = mountFace({ sessions: new Map([['s1', { command: failing }]]) })
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith('Permission switch failed: permission/unknown: unknown preset "x"')
    })
    expect(pill()).not.toBeNull()
    expect(pill()).not.toBeDisabled()
  })

  it('an unmatched write hides the face (the command surface is gone)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const unmatched = vi.fn(() => Promise.resolve({ ok: true, value: { matched: false } }))
    mountFace({ sessions: new Map([['s1', { command: unmatched }]]) })
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => expect(pill()).toBeNull())
  })

  it('a session without a live binding reports the failure instead of crashing', async () => {
    const { onError } = mountFace({ sessions: new Map() })
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[0] as HTMLElement)
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(pill()).not.toBeDisabled()
  })
})

describe('PermissionSelectFace full-access gate', () => {
  async function openConfirmation() {
    const mounted = mountFace()
    await whenPill()
    fireEvent.click(pill())
    fireEvent.click(menuRows()[2] as HTMLElement)
    return mounted
  }

  it('opens the risk confirmation instead of writing', async () => {
    const { command } = await openConfirmation()
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.body.textContent).toContain('Enable Full access?')
    expect(command).not.toHaveBeenCalled()
  })

  it('keeps the confirm action unavailable until the acknowledgement is checked', async () => {
    await openConfirmation()
    const confirm = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'Enable Full access') as HTMLButtonElement
    expect(confirm).toBeDisabled()
    fireEvent.click(document.body.querySelector('input[type="checkbox"]') as HTMLElement)
    expect(confirm).not.toBeDisabled()
  })

  it('cancel closes the confirmation without writing', async () => {
    const { command } = await openConfirmation()
    const cancel = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'Cancel') as HTMLButtonElement
    fireEvent.click(cancel)
    expect(document.body.textContent).not.toContain('Enable Full access?')
    expect(command).not.toHaveBeenCalled()
    expect(pill()).not.toBeDisabled()
  })

  it('acknowledge + confirm writes the full-access preset', async () => {
    const { command } = await openConfirmation()
    fireEvent.click(document.body.querySelector('input[type="checkbox"]') as HTMLElement)
    const confirm = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'Enable Full access') as HTMLButtonElement
    fireEvent.click(confirm)
    await waitFor(() => expect(command).toHaveBeenCalledWith('/permission danger-full-access'))
    expect(document.body.textContent).not.toContain('Enable Full access?')
  })

  it('gates the experimental auto preset with the EXP badge and its own confirmation copy', async () => {
    const autoCatalog = {
      options: [...CATALOG.options, { value: 'auto', name: 'auto' }],
    }
    const { command } = mountFace({ catalogResult: { ok: true, value: autoCatalog } })
    await whenPill()
    fireEvent.click(pill())
    const rows = menuRows()
    expect(rows).toHaveLength(4)
    expect(rows[3]?.textContent).toContain('Auto review')
    expect(rows[3]?.textContent).toContain('EXP')
    fireEvent.click(rows[3] as HTMLElement)
    expect(document.body.textContent).toContain('Enable Auto review (experimental)?')
    fireEvent.click(document.body.querySelector('input[type="checkbox"]') as HTMLElement)
    const confirm = [...document.body.querySelectorAll('button')]
      .find((button) => button.textContent === 'Enable Auto review') as HTMLButtonElement
    expect(confirm).not.toBeUndefined()
    fireEvent.click(confirm)
    await waitFor(() => expect(command).toHaveBeenCalledWith('/permission auto'))
  })
})

describe('displayPermissionPreset', () => {
  it('localizes the built-in product presets', () => {
    expect(displayPermissionPreset('read-only', 'read-only', fakeT)).toBe('Read Only')
    expect(displayPermissionPreset('workspace-write', 'workspace-write', fakeT)).toBe('Workspace Write')
    expect(displayPermissionPreset('danger-full-access', 'danger-full-access', fakeT)).toBe('Full access')
  })

  it('keeps the EN default-name match so customized labels stay host copy', () => {
    expect(displayPermissionPreset('read-only', 'Read Only', fakeT)).toBe('Read Only')
    expect(displayPermissionPreset('read-only', 'ReadOnly Corp', fakeT)).toBe('ReadOnly Corp')
  })

  it('title-cases other kebab-case host presets and passes non-kebab copy through', () => {
    expect(displayPermissionPreset('team-shared', 'team-shared', fakeT)).toBe('Team Shared')
    expect(displayPermissionPreset('custom', 'Everything allowed', fakeT)).toBe('Everything allowed')
  })
})
