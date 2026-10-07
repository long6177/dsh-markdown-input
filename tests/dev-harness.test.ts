/**
 * The sparse-checkout face exported by `scripts/dev-harness.mjs` — the single
 * source both workflows (`ci.yml`, `upstream-drift.yml`) feed to
 * `git sparse-checkout set`. Pure constant assertions: no network, no
 * checkout needed.
 */
import { describe, expect, it } from 'vitest'
import {
  HARNESS_CLIENT_PACKAGES,
  SPARSE_CHECKOUT_PATHS,
  SPARSE_SUPPORT_PATHS,
  main,
} from '../scripts/dev-harness.mjs'

describe('SPARSE_CHECKOUT_PATHS', () => {
  it('covers every fidelity-alias client package dir (the 8822095 failure class)', () => {
    // A sparse checkout missing one of these dirs makes the aliased source
    // face unresolvable and whole suites fail at import time.
    for (const { dir } of HARNESS_CLIENT_PACKAGES) {
      expect(SPARSE_CHECKOUT_PATHS).toContain(dir)
    }
  })

  it('is the deduplicated union of the alias dirs and the tsconfig support closure', () => {
    expect(SPARSE_CHECKOUT_PATHS).toEqual([
      ...new Set([...HARNESS_CLIENT_PACKAGES.map(entry => entry.dir), ...SPARSE_SUPPORT_PATHS]),
    ])
    expect(new Set(SPARSE_CHECKOUT_PATHS).size).toBe(SPARSE_CHECKOUT_PATHS.length)
    expect(SPARSE_CHECKOUT_PATHS.length).toBeGreaterThan(0)
  })

  it('sparse-paths prints one path per line, matching the exported list', async () => {
    // The CLI command the workflows consume; run through the exported `main`
    // with console.log captured (subprocess spawning is unavailable in tests).
    const lines: string[] = []
    const original = console.log
    console.log = (line: unknown) => { lines.push(String(line)) }
    try {
      await main(['sparse-paths'])
    } finally {
      console.log = original
    }
    expect(lines).toEqual(SPARSE_CHECKOUT_PATHS)
  })
})
