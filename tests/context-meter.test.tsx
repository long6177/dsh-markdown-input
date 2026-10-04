/**
 * The dock context meter (issue #43) at the component seam.
 *
 * Two groups:
 *
 * 1. `ContextMeterFace` with the props a real slot delivers — the two
 *    projection values and the `conversation` translate seat — covering the
 *    acceptance rules: nothing while either projection or the capacity is
 *    missing, ring + percentage when present, the click-open composition
 *    panel (segments, compact figures, `dl` rows), Escape close, and the
 *    capacity-loss auto-close on a model switch.
 *
 * 2. the REACHABILITY proof #43 demanded before implementing: a real
 *    ui-renderer slot tree (the host's own `createSlotRenderer` over a
 *    session-scope adapter whose binding carries ui-session's `BUILTIN_SOURCE`
 *    shape) renders the registered dock occupant, and the occupant must
 *    receive the `useProjection` seat and the session id from the session
 *    standard kit — the mechanism that makes the native below-the-card
 *    position possible at all.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  ScopedStandardSourceBinding, SlotRendererHost, SlotScopeAdapter, StandardSourceBinding, StoredEntry,
} from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
// The renderer's SOURCE, not its built entry: the published `lib/client.js`
// is a host module-loader bundle (its uSES import would load a second React;
// see vitest.config.ts), while the source is plain ESM the test transform can
// wire to this project's React.
import { createSlotRenderer } from '@deepseek-ai/dsh-client-ui-renderer/src/client/scoped-slots.tsx'
// The host's own dictionaries, read from upstream source: the meter's copy is
// NOT this plugin's, so the test proves parity against the very words the host
// seat renders. `conversationEn` carries `context.*`; `commonEn` carries the
// shared compact-number templates (`number.thousand` / `number.million`),
// which live in the shared `common` vocabulary the namespace-bound translate
// consults after its own dictionary misses.
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en as conversationEn } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ContextMeterFace, type ContextMeterFaceProps } from '../src/client/ContextMeterFace.tsx'
import { ContextMeterOccupant } from '../src/client/ContextMeterOccupant.tsx'
import type { ContextBreakdownView, ContextPressureView } from '../src/client/context-occupancy.ts'
import { resetContextLocale, setContextLocale } from '../src/client/context-meter-face.ts'

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
 * Reachability proof: the real renderer delivers the session standard
 * kit to a `conversation.composer.dock` occupant.
 * ------------------------------------------------------------------ */

function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: (next: T) => {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** The session standard kit's `useProjection` seat, as the host binding carries it. */
type UseProjectionProp = (key: string) => unknown

/** One dock occupant's recorded props, in render order. */
interface RenderedProps {
  readonly useProjection: unknown
  readonly sessionId: unknown
  /** What the seat answered INSIDE the rendering component (hooks are render-scoped). */
  readonly pressure: unknown
  readonly ghost: unknown
}

/**
 * A host tree shaped exactly like the host's own ui-renderer suite: the root
 * entry declares ONE session-scope child slot, the session scope adapter
 * resolves a binding per Session reference, and that binding carries
 * ui-session's `BUILTIN_SOURCE` members — `hooks.session`,
 * `keyedHooks.projection`, `props.sessionId` (ui-session/src/client/index.ts:
 * 259-271). Whatever the renderer adds to an occupant of a session-scope slot
 * through its standard kit is therefore visible exactly as on a real host.
 */
function makeHost(): {
  host: SlotRendererHost
  rendered: RenderedProps[]
  cells: Map<string, ReturnType<typeof observable<unknown>>>
  select: (id: string) => void
} {
  const scopeCtx = new Context()
  const absent: StandardSourceBinding = {
    key: undefined,
    hooks: { session: undefined },
    keyedHooks: { projection: undefined },
    props: { sessionId: undefined },
  }
  const absentCell = { getSnapshot: () => undefined, subscribe: () => () => {} }
  const cells = new Map<string, ReturnType<typeof observable<unknown>>>()
  const rendered: RenderedProps[] = []
  const current = observable<StandardSourceBinding>(absent)

  const sessionFor = (id: string): ScopedStandardSourceBinding => ({
    key: id,
    ctx: scopeCtx,
    hooks: { session: { getSnapshot: () => ({ sid: id }), subscribe: () => () => {} } },
    keyedHooks: { projection: key => cells.get(key) ?? absentCell },
    props: { sessionId: id },
  })

  const rootEntry: StoredEntry = {
    // The renderer hands every root component `renderSlot`; this one only
    // needs to expose the session-scope child, so its component is a pass
    // through. The session scope comes from the adapter's CURRENT binding
    // (installed by `select`, which runs before the render).
    component: (props: { renderSlot: (key: string, owner: object) => React.ReactNode }) =>
      props.renderSlot('probe.dock', {}),
    options: {},
    children: { 'probe.dock': { kind: 'single', scope: 'session' } },
  }

  const sessionEntry: StoredEntry = {
    component: (props: Record<string, unknown>) => {
      const useProjection = props['useProjection'] as UseProjectionProp | undefined
      // The seat is a HOOK seat: it may only be called from a component body,
      // which is exactly what this probe does — the same call the meter makes.
      rendered.push({
        useProjection,
        sessionId: props['sessionId'],
        pressure: typeof useProjection === 'function' ? useProjection('contextPressure') : undefined,
        ghost: typeof useProjection === 'function' ? useProjection('contextGhost') : undefined,
      })
      return <ContextMeterOccupant useProjection={useProjection} />
    },
    options: {},
  }

  const sessionAdapter: SlotScopeAdapter = {
    current,
    bindingSource: reference => (reference === undefined
      ? observable<StandardSourceBinding>(absent)
      : observable<StandardSourceBinding>(sessionFor(reference.sessionId))),
    renderArea: (scopeBinding, { empty, children }) => (scopeBinding.key === undefined
      ? <>{empty?.() ?? null}</>
      : <>{children}</>),
  }

  const host: SlotRendererHost = {
    subscribe: () => () => {},
    getVersion: () => 0,
    entriesOf: key => (key === 'root' ? [rootEntry] : [sessionEntry]),
    entriesOfSlot: key => (key === 'root' ? [rootEntry] : [sessionEntry]),
    reportEntryError: () => {},
    reportFactoryError: () => {},
    specOf: key => {
      if (key === 'probe.dock') return { kind: 'single', scope: 'session' }
      return undefined
    },
    isLive: () => true,
    storeOf: () => undefined,
    factoryStoreOf: () => undefined,
    retainFactoryOccurrence: () => () => {},
    subscribeFactory: () => () => {},
    getFactoryVersion: () => 0,
    factoryOf: () => undefined,
    isFactoryLive: () => false,
    root: observable<StandardSourceBinding>({ key: undefined, hooks: {}, keyedHooks: {}, props: {} }),
    scopeRevision: observable(0),
    scope: () => sessionAdapter,
  }

  return {
    host,
    rendered,
    cells,
    select: (id: string) => { current.set(sessionFor(id)) },
  }
}

describe('conversation.composer.dock occupant reachability', () => {
  it('delivers useProjection and sessionId to a session-scope dock occupant', () => {
    const harness = makeHost()
    harness.cells.set('contextPressure', observable<unknown>(FULL_PRESSURE))
    setContextLocale(t)
    harness.select('s1')
    render(createSlotRenderer().renderRoot(harness.host, {}))
    // The renderer injected the seat: the occupant received the hook and the
    // session identity from the session standard kit…
    const seen = harness.rendered.at(-1)
    expect(typeof seen?.useProjection).toBe('function')
    expect(seen?.sessionId).toBe('s1')
    // …and the hook answered the projected value inside the component body,
    // undefined for a key the host never contributed.
    expect(seen?.pressure).toEqual(FULL_PRESSURE)
    expect(seen?.ghost).toBeUndefined()
    // …and the meter itself mounted in that session's own subtree, which is
    // what puts it BELOW the card in the native dock position (#43).
    expect(meter()).not.toBeNull()
    expect(meter()?.textContent).toContain('19%')
  })

  it('renders nothing when the renderer injects no projection seat', () => {
    setContextLocale(t)
    const { container } = render(<ContextMeterOccupant useProjection={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the host copy is unbound', () => {
    resetContextLocale()
    const { container } = render(<ContextMeterOccupant useProjection={projection({ pressure: FULL_PRESSURE })} />)
    expect(container).toBeEmptyDOMElement()
  })
})
