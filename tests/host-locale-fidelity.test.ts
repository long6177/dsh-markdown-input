/**
 * The fidelity contract for the committed locale snapshots (ADR-0007).
 *
 * The published npm tarballs carry no `src/` and do not re-export their
 * dictionaries from any built entry, so in the default published mode the
 * locale-facing tests read the committed snapshots under
 * `tests/host-locale/` — the host copy at the pinned upstream tag. This test
 * keeps those snapshots honest: whenever an upstream source checkout is
 * available (`DSH_HARNESS_DIR`, default `../deepseek-harness`), it imports
 * the dictionaries straight from the checkout — through the
 * `@dsh-harness/*-en` virtual modules vitest.config.ts resolves to the
 * checkout files — and asserts value equality.
 *
 * A failure here means the checkout's dictionaries moved without the
 * snapshots being regenerated — run `node scripts/dev-harness.mjs snapshot`
 * after a verified upstream bump, and let the drift ticket (#59 flow) decide
 * whether the copy change is wanted. Skipped (with a printed reason) on
 * machines without a checkout; the published face still runs.
 */
import { describe, expect, it } from 'vitest'
import { LOCALE_SNAPSHOT_SOURCES, resolveDevHarness } from '../scripts/dev-harness.mjs'
import { commonEn } from './host-locale/common-en.ts'
import { conversationEn } from './host-locale/conversation-en.ts'

const harness = resolveDevHarness()
if (harness.unavailableReason !== undefined) {
  console.warn(`[skip] host-locale-fidelity: ${harness.unavailableReason}`)
}

const describeWhenSource = harness.unavailableReason === undefined ? describe : describe.skip

describeWhenSource('committed locale snapshots match the upstream checkout', () => {
  // Literal specifiers on purpose: a variable specifier is externalized by
  // the vitest module runner and would bypass the vitest alias resolution.
  it(`${LOCALE_SNAPSHOT_SOURCES[0]!.pkg} en (common) equals the checkout dictionary`, async () => {
    const mod = await import('@dsh-harness/common-en') as { en: Record<string, string> }
    expect(commonEn).toEqual(mod.en)
  })

  it(`${LOCALE_SNAPSHOT_SOURCES[1]!.pkg} en (conversation) equals the checkout dictionary`, async () => {
    const mod = await import('@dsh-harness/conversation-en') as { en: Record<string, string> }
    expect(conversationEn).toEqual(mod.en)
  })
})
