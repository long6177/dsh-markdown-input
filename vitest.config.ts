import { defineConfig } from 'vitest/config'

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
  },
})
