/**
 * Seam: the tool-row plan chip as the user sees it (issue #34). The chip is
 * the takeover card's rebuild of the native PlanChip (`ui-plan`, the slot
 * `conversation.input.plan` seat the takeover structurally replaces): it
 * shows while the folded plan projection targets plan mode, and clicking
 * runs the native detached exit line `/plan off` through the command face —
 * a failure reports inline, the chip never throws into the card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { FaceGate } from '../src/client/FaceGate.tsx'
import { resetFaces } from '../src/client/face.ts'
import { PlanChipFace, planFaceDefinition } from '../src/client/PlanChipFace.tsx'
import { commandFaceSupported, resetCommandFace, setCommandSource } from '../src/client/command-face.ts'
import { en } from '../src/client/locales.ts'
import type { PlanProjectionState } from '../src/client/plan-core.ts'

function fakeT(key: keyof typeof en, params?: Record<string, string>): string {
  return en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
}

function chip(): HTMLButtonElement | null {
  return document.querySelector('button[data-markdown-plan-chip]')
}

function chipError(): HTMLElement | null {
  return document.querySelector('[data-markdown-plan-chip-error]')
}

/**
 * Bind a command face whose `execute` records the lines and answers
 * `result`; the forwarded-event face stays absent (the chip needs none).
 */
function bindCommands(executeResult?: unknown) {
  const execute = vi.fn(() => Promise.resolve(executeResult ?? {
    ok: true, value: { result: { kind: 'success' } },
  }))
  setCommandSource(() => ({
    commands: { list: vi.fn(), execute },
    remoteEvents: undefined,
  }) as never)
  return { execute }
}

function mountChip(
  plan: PlanProjectionState | undefined,
  options: { sessionId?: string | undefined; locked?: boolean } = {},
): void {
  render(
    <FaceGate definition={planFaceDefinition(((key: string) =>
      key === 'plan' ? plan : undefined) as unknown)}>
      <PlanChipFace
        useProjection={(key) => (key === 'plan' ? plan : undefined)}
        sessionId={options.sessionId === undefined ? undefined : options.sessionId}
        locked={options.locked ?? false}
        t={fakeT}
      />
    </FaceGate>,
  )
}

afterEach(() => {
  cleanup()
  resetCommandFace()
  resetFaces()
})

describe('PlanChipFace visibility', () => {
  it('renders nothing while the plan projection is absent', () => {
    bindCommands()
    mountChip(undefined, { sessionId: 's1' })
    expect(chip()).toBeNull()
  })

  it('renders the chip while plan mode is active', () => {
    bindCommands()
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    const button = chip()
    expect(button).not.toBeNull()
    expect(button!.textContent).toContain(fakeT('plan.chip.label'))
    expect(button!.getAttribute('aria-label')).toBe(fakeT('plan.chip.on.aria'))
    expect(button!.getAttribute('title')).toBe(fakeT('plan.chip.on.title'))
  })

  it('renders nothing while plan mode is off', () => {
    bindCommands()
    mountChip({ active: false, pending: false }, { sessionId: 's1' })
    expect(chip()).toBeNull()
  })

  it('hides while a pending selection turns plan mode off, shows while it turns it on', () => {
    bindCommands()
    mountChip({ active: true, pending: true }, { sessionId: 's1' })
    expect(chip()).toBeNull()
    cleanup()
    mountChip({ active: false, pending: true }, { sessionId: 's1' })
    expect(chip()).not.toBeNull()
  })

  it('renders nothing when the command face is absent (no exit verb, no seat)', () => {
    setCommandSource(() => undefined)
    expect(commandFaceSupported()).toBe(false)
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    expect(chip()).toBeNull()
  })
})

describe('PlanChipFace exit', () => {
  it('runs the native detached exit line on click', async () => {
    const { execute } = bindCommands()
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    fireEvent.click(chip()!)
    await waitFor(() => {
      expect(execute).toHaveBeenCalledWith('s1', '/plan off', [])
    })
  })

  it('keeps the chip present after a settled exit (the projection drives the hide)', async () => {
    const { execute } = bindCommands()
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    fireEvent.click(chip()!)
    await waitFor(() => expect(execute).toHaveBeenCalled())
    // Native parity: leaving resets after the execution settles; the host
    // projection frame is what removes the chip.
    await waitFor(() => expect(chip()!.disabled).toBe(false))
  })

  it('reports a failed exit inline with the detail as the title', async () => {
    bindCommands({
      ok: true, value: { result: { kind: 'error', text: 'plan mode is not active' } },
    })
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    fireEvent.click(chip()!)
    await waitFor(() => {
      expect(chipError()).not.toBeNull()
    })
    expect(chipError()!.textContent).toBe(fakeT('plan.chip.exitFailed'))
    expect(chipError()!.getAttribute('title')).toBe('plan mode is not active')
  })

  it('disables the chip while locked (session gone) and while a click is in flight', async () => {
    let release: ((value: unknown) => void) | undefined
    const execute = vi.fn(() => new Promise((resolve) => { release = resolve }))
    setCommandSource(() => ({
      commands: { list: vi.fn(), execute }, remoteEvents: undefined,
    }) as never)
    mountChip({ active: true, pending: false }, { sessionId: 's1' })
    expect(chip()!.disabled).toBe(false)
    fireEvent.click(chip()!)
    expect(chip()!.disabled).toBe(true)
    release!({ ok: true, value: { result: { kind: 'success' } } })
    await waitFor(() => expect(chip()!.disabled).toBe(false))

    cleanup()
    mountChip({ active: true, pending: false }, { sessionId: 's1', locked: true })
    expect(chip()!.disabled).toBe(true)
  })
})
