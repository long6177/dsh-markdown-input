import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { RENDERER_SOURCE_MODULE, LOCALE_SNAPSHOT_SOURCES, fidelityPackageAliases, resolveDevHarness } from './scripts/dev-harness.mjs'

/**
 * The dev-dependency model switch (ADR-0007, `scripts/dev-harness.mjs`):
 *
 * - **Published mode** (default): the dsh devDependencies are exact npm
 *   releases; no alias below touches them and a plain `pnpm install && pnpm
 *   test` needs no upstream checkout. The reachability test resolves its
 *   renderer source through the virtual `@dsh-harness/renderer-scoped-slots`
 *   module — only when a checkout exists (`DSH_HARNESS_DIR`), and skips with
 *   a printed reason otherwise.
 * - **Fidelity mode** (`DSH_FIDELITY=1`, e.g. `node scripts/dev-harness.mjs
 *   test`): the six client packages are aliased to the checkout's `src/`
 *   trees, so the whole suite exercises the source face of
 *   `DSH_HARNESS_DIR` — the release-prep full run and the drift monitor
 *   (#58/#59) supply their own checkout through that variable.
 */
const HARNESS = resolveDevHarness()

/**
 * The upstream `use-sync-external-store` package ships only a CJS `require`
 * shim (no ESM entry, no exports map), and that shim loads react through the
 * HOST checkout's pnpm store — a second React instance in this project's test
 * process, which crashes every hook the moment the real ui-renderer suite is
 * imported (#43's reachability test mounts a real slot tree). The alias below
 * maps the subpath to a five-line ESM shim in this repo that composes the
 * platform hook with THIS project's react, so the renderer suite's uSES bridge
 * rides the same React as the components under test. The reachability test
 * imports the renderer's SOURCE through `@dsh-harness/renderer-scoped-slots`
 * (resolved from `DSH_HARNESS_DIR`): its built entry is a host module-loader
 * bundle that bypasses this alias.
 */
const USES_SHIM = fileURLToPath(new URL('./tests/use-sync-external-store-shim.ts', import.meta.url))
const REACT = fileURLToPath(new URL('./node_modules/react', import.meta.url))
const REACT_DOM = fileURLToPath(new URL('./node_modules/react-dom', import.meta.url))

/**
 * Stand-in for the `@dsh-harness/*` virtual modules when no checkout exists:
 * import-analysis must RESOLVE the guarded dynamic imports even then, or the
 * suites would crash at transform time instead of skipping with a printed
 * reason. The stub throws on execution, so an unguarded import fails loudly.
 */
const HARNESS_SOURCE_STUB = fileURLToPath(new URL('./tests/harness-source-stub.ts', import.meta.url))
/** The real checkout file when available, the never-executed stub otherwise. */
const harnessSource = (file: string) => (HARNESS.sourceAvailable ? join(HARNESS.harnessDir, file) : HARNESS_SOURCE_STUB)

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    css: false,
    server: {
      deps: {
        // The dsh packages ship `.css` imports inside their built bundles.
        // As `link:` deps (#64's previous model) vite processed them
        // implicitly; as registry deps they are externalized by default and
        // Node's ESM loader cannot load `.css`. Inline the whole
        // `@deepseek-ai/` scope so vite's pipeline (CSS stubs under
        // `css: false`) handles them — published and aliased-checkout faces
        // alike (ADR-0007).
        inline: [/@deepseek-ai\//u],
      },
    },
  },
  resolve: {
    // Every react-ish import must hit THIS project's copy or hooks crash
    // with two Reacts: the dsh packages (published, or aliased into the
    // linked checkout) otherwise resolve react through their own tree.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    alias: [
      {
        find: /^@dsh-harness\/renderer-scoped-slots$/u,
        replacement: harnessSource('packages/client/ui-renderer/src/client/scoped-slots.tsx'),
      },
      // The checkout-face locale dictionaries, imported only by the fidelity
      // contract test (tests/host-locale-fidelity.test.ts) behind its checkout
      // guard — like the renderer module above, unresolvable targets never
      // execute when the checkout is absent.
      ...LOCALE_SNAPSHOT_SOURCES.map(entry => ({
        find: new RegExp(`^${entry.virtualModule.replaceAll('/', '\\/')}$`, 'u'),
        replacement: harnessSource(entry.source),
      })),
      // Fidelity mode: point the client packages at the checkout's source
      // face (ADR-0007). Absent in published mode, where the devDependencies
      // are the published packages themselves.
      ...(HARNESS.fidelity ? fidelityPackageAliases(HARNESS.harnessDir) : []),
      {
        find: /^use-sync-external-store\/shim\/with-selector$/u,
        replacement: USES_SHIM,
      },
      // `dedupe` is not enough once a module's specifiers are rewritten by the
      // aliased checkout: a module under the checkout tree resolves bare
      // `react` from the HOST'S copy. Pinning the bare specifiers at this
      // project's copies is what keeps the renderer suite and the components
      // under test on one React (#43's reachability proof is the first test
      // here to mount an upstream source module).
      { find: /^react$/u, replacement: REACT },
      { find: /^react\/jsx-runtime$/u, replacement: `${REACT}/jsx-runtime.js` },
      { find: /^react-dom$/u, replacement: REACT_DOM },
      { find: /^react-dom\/client$/u, replacement: `${REACT_DOM}/client.js` },
    ],
  },
})
