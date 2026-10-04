import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * The upstream `use-sync-external-store` package ships only a CJS `require`
 * shim (no ESM entry, no exports map), and that shim loads react through the
 * HOST checkout's pnpm store — a second React instance in this project's test
 * process, which crashes every hook the moment the real ui-renderer suite is
 * imported (#43's reachability test mounts a real slot tree). The alias below
 * maps the subpath to a five-line ESM shim in this repo that composes the
 * platform hook with THIS project's react, so the renderer suite's uSES bridge
 * rides the same React as the components under test. The reachability test
 * imports the renderer's SOURCE (`@deepseek-ai/dsh-client-ui-renderer/src/…`,
 * an export the package publishes) because its built entry is a host
 * module-loader bundle that bypasses this alias.
 */
const USES_SHIM = fileURLToPath(new URL('./tests/use-sync-external-store-shim.ts', import.meta.url))
const REACT = fileURLToPath(new URL('./node_modules/react', import.meta.url))
const REACT_DOM = fileURLToPath(new URL('./node_modules/react-dom', import.meta.url))

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    css: false,
  },
  resolve: {
    // The dsh devDependencies link to upstream source checkouts that carry
    // their own react; every react-ish import must hit THIS project's copy
    // or hooks crash with two Reacts.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
    alias: [
      {
        find: /^use-sync-external-store\/shim\/with-selector$/u,
        replacement: USES_SHIM,
      },
      // `dedupe` is not enough once a module's specifiers are rewritten by the
      // linked checkout: the renderer's own source sits under the host tree,
      // so its bare `react` import resolves to the HOST'S copy. Pinning the
      // bare specifiers at this project's copies is what keeps the renderer
      // suite and the components under test on one React (#43's reachability
      // proof is the first test here to mount an upstream source module).
      { find: /^react$/u, replacement: REACT },
      { find: /^react\/jsx-runtime$/u, replacement: `${REACT}/jsx-runtime.js` },
      { find: /^react-dom$/u, replacement: REACT_DOM },
      { find: /^react-dom\/client$/u, replacement: `${REACT_DOM}/client.js` },
    ],
  },
})
