/**
 * Stand-in target for the `@dsh-harness/*` virtual modules when no upstream
 * checkout is available (vitest.config.ts aliases these to checkout files
 * under `DSH_HARNESS_DIR`; import-analysis must be able to RESOLVE the
 * specifiers even then, or the guarded suites would crash at transform time
 * instead of skipping with a printed reason — ADR-0007).
 *
 * This module is never meant to EXECUTE: every consumer imports it behind a
 * checkout guard. A top-level throw turns an unguarded import into a loud
 * error instead of a silently passing test.
 */
throw new Error(
  'dsh harness source is not available; this import must sit behind the '
  + 'DSH_HARNESS_DIR guard (ADR-0007, scripts/dev-harness.mjs)',
)

export {}
