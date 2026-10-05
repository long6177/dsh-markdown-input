/**
 * The takeover card's context meter (issue #43) at the component seam.
 *
 * Two groups:
 *
 * 1. `ContextMeterFace` with the props the card delivers — the two
 *    projection values and the `conversation` translate seat — covering the
 *    acceptance rules: nothing while either projection or the capacity is
 *    missing, ring + percentage when present, the click-open composition
 *    panel (segments, compact figures, `dl` rows), Escape close, and the
 *    capacity-loss auto-close on a model switch.
 *
 * 2. the card-tree seam the meter actually lives in now: the takeover card
 *    renders the face ITSELF, in a dock row directly below the bordered card
 *    face (issue #43's root cause was that the occupant sat on
 *    `conversation.composer.dock`, a slot the host only mounts from inside
 *    its InputBar — hidden by the takeover, so the occupant never rendered).
 *    These tests render the real `MarkdownComposer` tree and assert the
 *    native-parity placement (outside the card face, sibling below it), the
 *    degraded rows, and that the #41 card hit area does not reach the row.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en as conversationEn } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ContextMeterFace, type ContextMeterFaceProps } from '../src/client/ContextMeterFace.tsx'
import { MarkdownComposer, MARKDOWN_TAKEOVER, type MarkdownComposerProps } from '../src/client/MarkdownComposer.tsx'
import type { ContextBreakdownView, ContextPressureView } from '../src/client/context-occupancy.ts'
import { resetContextLocale, setContextLocale } from '../src/client/context-meter-face.ts'
import { resetFaces } from '../src/client/face.ts'
import { en } from '../src/client/locales.ts'

/** The seat the host delivers: the conversation dictionary over the shared common one. */
const dictionary: Record<string, string> = { ...commonEn, ...conversationEn }

/** The host `conversation` translate seat, expanded from the host dictionaries. */
const t: ContextMeterFaceProps['t'] = (key, params) => {
  const template = dictionary[key] ?? key
  return template.replaceAll(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name] ?? `{${name}}`))
}

const FULL_PRESSURE: ContextPressureView = {
  pressureTokens: 20_000,
  projectedTokens: 24_000,
  contextWindow: 128_000,
}

const BREAKDOWN: ContextBreakdownView = {
  systemTokens: 4_000,
  toolsTokens: 8_000,
  messageTokens: 12_000,
}

/** Read one key off a projection table, undefined for any absent key. */
function projection(table: {
  pressure?: ContextPressureView
  breakdown?: ContextBreakdownView
}): ContextMeterFaceProps['useProjection'] {
  return ((key: string) => {
    if (key === 'contextPressure') return table.pressure
    if (key === 'contextBreakdown') return table.breakdown
    return undefined
  }) as unknown as ContextMeterFaceProps['useProjection']
}

function meter(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-context-meter]')
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-context-panel]')
}

function trigger(): HTMLElement {
  const button = meter()?.querySelector('button')
  if (button === null || button === undefined) throw new Error('meter trigger is not mounted')
  return button
}

afterEach(() => {
  cleanup()
  resetContextLocale()
  resetFaces()
})

describe('ContextMeterFace visibility', () => {
  it('renders nothing when neither projection is present', () => {
    const { container } = render(<ContextMeterFace useProjection={projection({})} t={t} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the pressure projection has no capacity', () => {
    const { container } = render(
      <ContextMeterFace useProjection={projection({ pressure: { projectedTokens: 500 } })} t={t} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when capacity exists but no used count does', () => {
    const { container } = render(
      <ContextMeterFace useProjection={projection({ pressure: { contextWindow: 128_000 } })} t={t} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the ring, the percent, and the accessible name once capacity is known', () => {
    render(<ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE })} t={t} />)
    const root = meter()
    expect(root).not.toBeNull()
    // 24000 / 128000 = 18.75% → 19%.
    expect(root?.textContent).toContain('19%')
    const button = trigger()
    expect(button).toHaveAttribute('aria-label', conversationEn['context.aria'].replace('{percent}', '19%'))
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    // Ring geometry: 14px viewBox, 5.5 radius, dasharray from the percent.
    const circles = root?.querySelectorAll('circle')
    expect(circles).toHaveLength(2)
    const fill = circles?.[1]
    const circumference = 2 * Math.PI * 5.5
    expect(fill?.getAttribute('stroke-dasharray'))
      .toBe(`${circumference * 19 / 100} ${circumference}`)
    expect(fill?.getAttribute('transform')).toBe('rotate(-90 7 7)')
  })
})

describe('ContextMeterFace panel', () => {
  it('opens the composition panel with headline, progress bar and compact figures', () => {
    render(<ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE })} t={t} />)
    expect(panel()).toBeNull()
    fireEvent.click(trigger())
    const open = panel()
    expect(open).not.toBeNull()
    expect(open).toHaveAttribute('role', 'dialog')
    expect(open).toHaveAttribute('aria-label', conversationEn['context.used'])
    // The headline brackets the reading with the locale's own word order.
    expect(open?.textContent).toContain('19%')
    expect(open?.textContent).toContain('of context used')
    // `~used / window` in the host's compact numbers: 24000 → 24K, 128000 → 128K.
    expect(open?.textContent).toContain('~24K / 128K')
    // Without a breakdown the bar is the single full-length segment.
    const segments = open?.querySelectorAll('[data-context-segment]')
    expect(segments).toHaveLength(1)
    expect(segments?.[0]?.getAttribute('data-context-segment')).toBe('total')
    expect(open?.querySelector('dl')).toBeNull()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('renders the heuristic segments and the detail rows when a breakdown is present', () => {
    render(
      <ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE, breakdown: BREAKDOWN })} t={t} />,
    )
    fireEvent.click(trigger())
    const open = panel()
    const segments = open!.querySelectorAll<HTMLElement>('[data-context-segment]')
    expect(segments).toHaveLength(3)
    expect([...segments].map(segment => segment.getAttribute('data-context-segment')))
      .toEqual(['systemTokens', 'toolsTokens', 'messageTokens'])
    // Proportions of the heuristic total (4k/8k/12k of 24k) scaled by the
    // provider-exact 19%.
    expect([...segments].map(segment => segment.style.width))
      .toEqual(['3.1666666666666665%', '6.333333333333333%', '9.5%'])
    const rows = open!.querySelectorAll('[data-context-row]')
    expect(rows).toHaveLength(3)
    expect(open?.textContent).toContain(conversationEn['context.system'])
    expect(open?.textContent).toContain(conversationEn['context.tools'])
    expect(open?.textContent).toContain(conversationEn['context.messages'])
    expect(open?.textContent).toContain('~4K')
    expect(open?.textContent).toContain('~8K')
    expect(open?.textContent).toContain('~12K')
  })

  it('closes on Escape', () => {
    render(<ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE })} t={t} />)
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(panel()).toBeNull()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on an outside pointerdown', () => {
    render(<ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE })} t={t} />)
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    // The dismissal rides the primitive's document-level pointerdown listener;
    // jsdom's PointerEvent is used directly so the listener's `event.target`
    // is a real node outside the meter root.
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    expect(panel()).toBeNull()
  })

  it('auto-closes an open panel when the route loses capacity (model switch)', () => {
    const view = render(
      <ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE })} t={t} />,
    )
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    // A model switch can strip `contextWindow` while the component stays
    // mounted: the panel must not survive on stale numbers.
    view.rerender(
      <ContextMeterFace useProjection={projection({ pressure: { projectedTokens: 24_000 } })} t={t} />,
    )
    expect(panel()).toBeNull()
    expect(meter()).toBeNull()
  })

  it('drops the panel and the seat when both projections disappear', () => {
    const view = render(
      <ContextMeterFace useProjection={projection({ pressure: FULL_PRESSURE, breakdown: BREAKDOWN })} t={t} />,
    )
    fireEvent.click(trigger())
    expect(panel()).not.toBeNull()
    view.rerender(<ContextMeterFace useProjection={projection({})} t={t} />)
    expect(panel()).toBeNull()
    expect(meter()).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Card-tree seam: the takeover card renders the meter itself, in a
 * dock row directly below the card face (issue #43).
 * ------------------------------------------------------------------ */

/** The plugin `markdown-input` translate seat, expanded from the plugin dictionary. */
const cardT = ((key: keyof typeof en, params?: Record<string, string>) =>
  en[key].replaceAll(/\{(\w+)\}/gu, (_, name: string) => params?.[name] ?? `{${name}}`)
) as unknown as MarkdownComposerProps['t']

/**
 * Chain props for one card render, with the meter's two projection keys on
 * the seat. The rest of the shape mirrors the other card suites: a selector
 * `useInput`, the machine verbs, and no conversation service (the attachment
 * and notice faces hide; the meter does not depend on them).
 */
function cardProps(table: {
  pressure?: ContextPressureView
  breakdown?: ContextBreakdownView
} = {}): MarkdownComposerProps {
  const inputState = {
    draft: '',
    phase: 'plain',
    attachmentIds: [] as string[],
    draftRev: 0,
    occurrences: [],
    queue: [],
    claim: undefined,
  }
  const projectionValues: Record<string, unknown> = {
    goal: null,
    plan: undefined,
    contextPressure: table.pressure,
    contextBreakdown: table.breakdown,
  }
  return {
    matched: MARKDOWN_TAKEOVER,
    sessionId: 's1',
    useInput: (selector: (state: typeof inputState) => unknown) => selector(inputState),
    inputActions: {
      setDraft: vi.fn(),
      submit: vi.fn(),
      addAttachments: vi.fn(),
      removeAttachment: vi.fn(),
      pruneAttachments: vi.fn(),
    } as unknown as MarkdownComposerProps['inputActions'],
    useProjection: ((key: string, selector?: (value: unknown) => unknown) => {
      const value = projectionValues[key]
      return selector !== undefined ? selector(value) : value
    }) as MarkdownComposerProps['useProjection'],
    t: cardT,
  } as unknown as MarkdownComposerProps
}

function meterEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-context-meter]')
}

/** The CodeMirror text surface, for the focus assertions the hit-area test makes. */
function content(): HTMLElement {
  return document.querySelector('.cm-content') as HTMLElement
}

describe('takeover card dock row (issue #43)', () => {
  it('renders the meter in a dock row directly below the card face, outside it', () => {
    setContextLocale(t)
    render(<MarkdownComposer {...cardProps({ pressure: FULL_PRESSURE })} />)
    const meter = meterEl()
    expect(meter).not.toBeNull()
    expect(meter?.textContent).toContain('19%')
    // Native parity: the row is a SIBLING after the bordered card face —
    // the meter is not swallowed into the card and not a slot occupant the
    // takeover hides.
    const face = document.querySelector('[data-markdown-composer]')
    const dock = document.querySelector('[data-markdown-dock]')
    expect(face).not.toBeNull()
    expect(dock).not.toBeNull()
    expect(meter?.closest('[data-markdown-composer]')).toBeNull()
    expect(meter?.closest('[data-markdown-dock]')).toBe(dock)
    expect(face?.nextElementSibling).toBe(dock)
    expect(dock?.parentElement).toBe(face?.parentElement)
  })

  it('renders no meter and an empty row while the projections are absent', () => {
    setContextLocale(t)
    render(<MarkdownComposer {...cardProps()} />)
    expect(meterEl()).toBeNull()
    // 整面隐藏: the row keeps no dead seat and no reserved strip content.
    expect(document.querySelector('[data-markdown-dock]')?.childElementCount).toBe(0)
  })

  it('renders no meter while the capacity is unknown (no contextWindow)', () => {
    setContextLocale(t)
    render(<MarkdownComposer {...cardProps({ pressure: { projectedTokens: 24_000 } })} />)
    expect(meterEl()).toBeNull()
  })

  it('hides the face whole while the host conversation copy is unbound', () => {
    // No setContextLocale: a composition that never bound the namespace has
    // no copy to show, and the card renders nothing in the row.
    render(<MarkdownComposer {...cardProps({ pressure: FULL_PRESSURE })} />)
    expect(meterEl()).toBeNull()
    expect(document.querySelector('[data-markdown-dock]')?.childElementCount).toBe(0)
  })

  it('opens the composition panel with the degraded single segment when no breakdown exists', () => {
    setContextLocale(t)
    render(<MarkdownComposer {...cardProps({ pressure: FULL_PRESSURE })} />)
    fireEvent.click(trigger())
    const open = panel()
    expect(open).not.toBeNull()
    const segments = open?.querySelectorAll('[data-context-segment]')
    expect(segments).toHaveLength(1)
    expect(segments?.[0]?.getAttribute('data-context-segment')).toBe('total')
  })

  it('does not turn a dock-row mousedown into an editor focus (the #41 hit area ends at the card face)', () => {
    setContextLocale(t)
    render(<MarkdownComposer {...cardProps({ pressure: FULL_PRESSURE })} />)
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    try {
      const dock = document.querySelector('[data-markdown-dock]') as HTMLElement
      fireEvent.mouseDown(dock)
      expect(focus).not.toHaveBeenCalled()
      expect(document.activeElement).not.toBe(content())
    } finally {
      focus.mockRestore()
    }
  })
})
