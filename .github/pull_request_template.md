## What & why

<!-- One short paragraph. Link the issue it closes: "Fixes #<n>" / "Closes #<n>". -->

## How to verify

<!-- Exact commands or steps a reviewer can run. Most changes verify with `pnpm typecheck && pnpm test` and no running host (CONTRIBUTING.md §2). -->

## Checklist

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes — without an upstream checkout, 4 tests are expected to skip with a printed `[skip]` reason, and the `bundle-contract` suite needs `pnpm build` first (CONTRIBUTING.md §1); anything else skipping is not green
- [ ] Does **not** touch on-device acceptance surfaces (visual alignment with native panels, keyboard behavior, IME composition, native-surface parity — CONTRIBUTING.md §3). If it does, describe what the maintainer should re-test:
      <!-- … -->
- [ ] If user-facing behavior changed: both `README.md` and `README.zh-CN.md` are updated
