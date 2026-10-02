import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    css: false,
  },
  resolve: {
    alias: {
      // The production browser half binds the rc.2 primitives names (Medium/
      // Regular icon variants, FileTypeIcon) through the host module table;
      // the tests run against the 0.1.x-era sibling runtime, so map the
      // renamed symbols onto their 0.1.x equivalents via the shim.
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL('./tests/shims/primitives-rc2-shim.ts', import.meta.url),
      ),
    },
    // The dsh devDependencies link to upstream source checkouts that carry
    // their own react; every react-ish import must hit THIS project's copy
    // or hooks crash with two Reacts.
    dedupe: ['react', 'react-dom', 'react/jsx-runtime'],
  },
})
