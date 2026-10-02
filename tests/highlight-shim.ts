/**
 * Shared Custom Highlight API shim for the paint-layer test files: jsdom
 * never paints, so assertions read the ranges back out of the shim.
 */
import { vi } from 'vitest'

/** The shimmed Highlight: records the ranges it was built with. */
export class FakeHighlight {
  readonly ranges: readonly Range[]
  constructor(...ranges: Range[]) {
    this.ranges = ranges
  }
}

/** The shimmed `CSS.highlights` registry. */
export class FakeRegistry {
  readonly map = new Map<string, FakeHighlight>()
  set(name: string, highlight: FakeHighlight): this {
    this.map.set(name, highlight)
    return this
  }

  delete(name: string): boolean {
    return this.map.delete(name)
  }

  rangesOf(name: string): readonly Range[] {
    return this.map.get(name)?.ranges ?? []
  }

  textOf(name: string): string[] {
    return this.rangesOf(name).map(range => range.toString())
  }
}

/** Install the API shim; jsdom's `CSS` object takes the registry property. */
export function installHighlightShim(): FakeRegistry {
  vi.stubGlobal('Highlight', FakeHighlight)
  const registry = new FakeRegistry()
  Object.defineProperty(CSS, 'highlights', { value: registry, configurable: true })
  return registry
}

/** Remove every trace of the shim between tests. */
export function removeHighlightShim(): void {
  vi.unstubAllGlobals()
  delete (CSS as unknown as { highlights?: unknown }).highlights
}
