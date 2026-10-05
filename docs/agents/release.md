# Release publishing: the npm sequence

Policy (remote feedback loop, maintainer-owned OTP, checklist ≤8) lives in [ADR-0004](../adr/0004-npm-release-remote-feedback-loop.md). This doc is the operational sequence: the two flags npm demands, the two lags to expect after publishing, and the credential-failure shapes that masquerade as registry errors (alpha.12). Every command runs from the repo root.

## Sequence

1. **Release commit.** Raise `version` in `package.json` along the `0.2.0-alpha.x` line, add the acceptance checklist `docs/release/<version>-checklist.md` (≤8 items; the previous checklist is the template, the retest main item on top), commit as `chore: release <version>, <one-line summary>`. Done when the commit carries both the bump and the checklist.
2. **Build.** `npm run build`. `lib/` is gitignored, so the tarball packs the local build — a stale `lib/` ships a stale plugin. Done when the log ends `Build complete`.
3. **Publish — both flags, every time:**

   ```bash
   npm publish --tag latest --registry=https://registry.npmjs.org/   # OTP prompt answers to the maintainer
   ```

   - `--registry=https://registry.npmjs.org/` — the dev machine's default registry is the npmmirror mirror; a publish must name the official registry or it never reaches npmjs.
   - `--tag latest` — the version is a prerelease, so npm refuses to publish without an explicit tag; and the tag must be `latest` because the desktop plugin UI upgrades from `latest` — any other tag lands the version where the UI never looks.
   - A dry-run first (`--tag latest --dry-run --registry=…`) shows the version and the tarball contents. Done when npm prints `+ dsh-markdown-input@<version>`.

4. **Confirm landing; wait out propagation.** `npm view dsh-markdown-input@latest version --registry=https://registry.npmjs.org/` may still answer the previous version for a minute or two — dist-tags ride CDN cache. Landing itself is proven by HTTP 200 from `https://registry.npmjs.org/dsh-markdown-input/<version>`. Done when `npm view … dist-tags --prefer-online` shows `latest: <version>`; lag resolves by re-checking, never by re-publishing (the same version cannot publish twice).
5. **Check the mirror.** Query `https://registry.npmmirror.com/dsh-markdown-input/latest` (plain `curl`): serving the new version means the desktop plugin UI can upgrade directly; still stale means trigger a manual sync at `https://npmmirror.com/sync/dsh-markdown-input` (alpha.6 lesson: the UI lists whatever the mirror serves).
6. **Real-host retest.** The maintainer walks the checklist in the desktop app; record the results as `outputs/retest-YYYYMMDD-<version>.md` — `outputs/` stays uncommitted — and turn confirmed gaps into issues.

## Troubleshooting: credential failures (alpha.12 lesson)

Both shapes below look like registry problems; both are credential problems. The npm console output lies — read the newest debug log under `%LOCALAPPDATA%\npm-cache\_logs\*-debug-0.log` before concluding anything.

- **Publish answers 404 on a package that demonstrably exists.** Real meaning: npm does not recognize the credentials. Cause in alpha.12: a stale `//registry.npmjs.org/:_authToken` line in the user-level `%USERPROFILE%\.npmrc` (the repo has no `.npmrc` and must never gain one). Confirmed by `npm whoami --registry=https://registry.npmjs.org/` erroring E401. Fix: `npm login --auth-type=web --registry=https://registry.npmjs.org/`, then require `whoami` to print the account name before any retry.
- **Login succeeds and `whoami` prints the account, yet publish still answers 401.** The web login is not actually finished — npm is waiting on the browser step (2FA / authorization approval). Debug-log signature: `PUT … → 401` accompanied by a stream of `GET /-/v1/done?authId=…` polls. Complete the flow in the browser and republish; a second login is not needed.

Pre-publish self-check, every time: `npm whoami --registry=https://registry.npmjs.org/` must print the account name. If it errors, stop there — `npm publish` will not report the true cause. Tokens and OTPs stay in the OS credential store, out of this repo, chat transcripts, and logs.
