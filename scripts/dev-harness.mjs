/**
 * The development-dependency model switch (ADR-0007): one resolver shared by
 * `vitest.config.ts`, the tests, and this CLI.
 *
 * Two test faces:
 *
 * - **Published mode** (default, zero config): the devDependencies are the
 *   exact npm releases matching upstream tag `dsh-v0.2.0-rc.2`; a plain
 *   `pnpm install && pnpm test` works with no upstream checkout. The two
 *   locale-dictionary tests read the committed snapshots under
 *   `tests/host-locale/`, and the #42 reachability test runs only when an
 *   upstream source checkout is available (see `rendererSourcePath`).
 * - **Fidelity mode** (`DSH_FIDELITY=1`): the suite is pointed back at the
 *   source face of a local upstream checkout — vitest aliases the six client
 *   packages (and their `/client` subpaths) to the checkout's `src/` trees —
 *   and the locale fidelity contract test asserts the committed snapshots
 *   still equal the checkout's dictionaries. Used for pre-release full runs
 *   and by drift monitoring (#58/#59), which supply their own checkout
 *   through `DSH_HARNESS_DIR` (any ref, sparse or full; the directory may
 *   live inside the repo so bare imports inside the checkout resolve from
 *   this project's node_modules).
 *
 * CLI:
 *
 * - `node scripts/dev-harness.mjs` — print the resolved mode and what runs.
 * - `node scripts/dev-harness.mjs test [vitest-args…]` — run the full suite
 *   in fidelity mode (one command, `DSH_HARNESS_DIR` respected).
 * - `node scripts/dev-harness.mjs snapshot` — regenerate the committed
 *   locale snapshots from the checkout (run when the pinned upstream tag
 *   moves; the fidelity contract test verifies them on every enabled run).
 * - `node scripts/dev-harness.mjs sparse-paths` — print the sparse-checkout
 *   face ({@link SPARSE_CHECKOUT_PATHS}), one path per line; `ci.yml` and
 *   `upstream-drift.yml` feed it to `git sparse-checkout set` so both
 *   workflows consume one source of truth.
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Source file inside the checkout whose presence enables the reachability test. */
export const RENDERER_SOURCE_REL = 'packages/client/ui-renderer/src/client/scoped-slots.tsx'

/**
 * Virtual module the #42 reachability test imports to load the renderer's
 * SOURCE (`createSlotRenderer`): vitest.config.ts aliases it to the checkout
 * file under `DSH_HARNESS_DIR`. A virtual specifier keeps the absolute path
 * computation in this module; the import itself only executes behind the
 * checkout guard, so a missing checkout degrades to the printed skip.
 */
export const RENDERER_SOURCE_MODULE = '@dsh-harness/renderer-scoped-slots'

/** Committed snapshot file for one upstream dictionary (see below). */
export const LOCALE_SNAPSHOT_SOURCES = [
  {
    /** Virtual module the fidelity contract test imports the checkout dictionary through. */
    virtualModule: '@dsh-harness/common-en',
    snapshot: 'tests/host-locale/common-en.ts',
    source: 'packages/client/locale/src/locales/en.ts',
    pkg: '@deepseek-ai/dsh-client-locale',
    exportName: 'en',
    namespace: 'common',
  },
  {
    virtualModule: '@dsh-harness/conversation-en',
    snapshot: 'tests/host-locale/conversation-en.ts',
    source: 'packages/client/ui-conversation/src/client/locales.ts',
    pkg: '@deepseek-ai/dsh-client-ui-conversation',
    exportName: 'en',
    namespace: 'conversation',
  },
]

/**
 * The client packages the suite consumes, with their checkout-side source
 * entries. `subpaths` maps exported subpaths onto checkout source files.
 */
export const HARNESS_CLIENT_PACKAGES = [
  { pkg: '@deepseek-ai/dsh-client-locale', dir: 'packages/client/locale', subpaths: { '/client': 'src/client/index.ts' } },
  { pkg: '@deepseek-ai/dsh-client-ui-chat', dir: 'packages/client/ui-chat', subpaths: { '/client': 'src/client/index.ts' } },
  { pkg: '@deepseek-ai/dsh-client-ui-conversation', dir: 'packages/client/ui-conversation', subpaths: { '/client': 'src/client/index.ts' } },
  { pkg: '@deepseek-ai/dsh-client-ui-primitives', dir: 'packages/client/ui-primitives', subpaths: {} },
  { pkg: '@deepseek-ai/dsh-client-ui-renderer', dir: 'packages/client/ui-renderer', subpaths: { '/client': 'src/client/index.ts', '/invariant': 'src/invariant.ts' } },
  { pkg: '@deepseek-ai/dsh-client-ui-slots', dir: 'packages/client/ui-slots', subpaths: {} },
]

/**
 * Sparse-checkout support paths beyond the client package dirs themselves:
 * the tsconfig `references` closure that vite's transform follows from the
 * checkout files' nearest tsconfigs (ui-renderer's references plus
 * ui-primitives', which pulls in the two util packages). Drill-verified
 * against upstream tags: a missing tsconfig crashes the transform at
 * import/parse time and every face test fails — environment, not drift
 * (commit 8822095's 24-file fake failure). Sources here stay inert in
 * published mode: those packages import from node_modules, the checkout only
 * satisfies the source-face import graph.
 */
export const SPARSE_SUPPORT_PATHS = [
  'packages/client/store',
  'packages/runtime-diagnostics/invariants',
  'packages/util/code-language',
  'packages/util/workspace-path',
  'vendor/cordis',
  'vendor/cosmokit',
  'vendor/schemastery',
]

/**
 * The full sparse-checkout face BOTH workflows consume (`ci.yml` at the
 * pinned base tag, `upstream-drift.yml` at the judged target ref): every
 * fidelity-alias client package dir — derived from
 * {@link HARNESS_CLIENT_PACKAGES}, so a package added there can never be
 * missed by a sparse checkout again — plus the tsconfig reference closure
 * ({@link SPARSE_SUPPORT_PATHS}). Printed by `node scripts/dev-harness.mjs
 * sparse-paths` for the workflows' `git sparse-checkout set` step; the union
 * is safe for both faces (extra dirs stay inert in published mode).
 */
export const SPARSE_CHECKOUT_PATHS = [
  ...new Set([...HARNESS_CLIENT_PACKAGES.map(entry => entry.dir), ...SPARSE_SUPPORT_PATHS]),
]

/**
 * Vitest aliases pointing the six client packages (and their exported
 * subpaths) at the checkout's SOURCE face — the fidelity mode (ADR-0007).
 * Everything aliased here resolves through the checkout's own dependency
 * graph; the react/react-dom pins in vitest.config.ts stay in charge, so the
 * aliased modules and the components under test still share one React.
 * @param harnessDir - absolute checkout directory ({@link resolveDevHarness}).
 * @returns alias entries to prepend to vitest's `resolve.alias`.
 */
export function fidelityPackageAliases(harnessDir) {
  return HARNESS_CLIENT_PACKAGES.flatMap(({ pkg, dir, subpaths }) => {
    const escaped = pkg.replaceAll('/', '\\/')
    const root = join(harnessDir, dir)
    return [
      { find: new RegExp(`^${escaped}$`), replacement: join(root, 'src/index.ts') },
      ...Object.entries(subpaths).map(([subpath, file]) => ({
        find: new RegExp(`^${escaped}${subpath.replaceAll('/', '\\/')}$`),
        replacement: join(root, file),
      })),
    ]
  })
}

/**
 * Resolve the test face from the environment. Pure and cheap: no I/O beyond
 * two `existsSync` calls, safe to call from the vitest config and from tests.
 * @param [env] - environment to read (defaults to `process.env`).
 * @returns the resolved mode, checkout paths, and the skip reason when the
 *   checkout source is unavailable.
 */
export function resolveDevHarness(env = process.env) {
  const fidelity = env.DSH_FIDELITY === '1' || env.DSH_FIDELITY === 'true'
  const declared = env.DSH_HARNESS_DIR ?? '../deepseek-harness'
  const harnessDir = isAbsolute(declared) ? declared : resolve(REPO_ROOT, declared)
  const rendererSourcePath = join(harnessDir, RENDERER_SOURCE_REL)
  const sourceAvailable = existsSync(rendererSourcePath)
  return {
    /** `'fidelity'` when the suite is pointed at the checkout source face. */
    mode: fidelity ? 'fidelity' : 'published',
    /** Whether `DSH_FIDELITY` asked for the source face. */
    fidelity,
    /** Absolute checkout directory (declared value resolved against the repo root). */
    harnessDir,
    /** Absolute renderer source file — the reachability test's import target. */
    rendererSourcePath,
    /** Whether that file exists (the checkout is usable for source-face runs). */
    sourceAvailable,
    /**
     * One-line reason the reachability test skips, or undefined when it runs.
     * Printed by the test and by `status` so a skip is never silent.
     */
    unavailableReason: sourceAvailable
      ? undefined
      : `upstream checkout with ${RENDERER_SOURCE_REL} not found at ${harnessDir} `
        + `(set DSH_HARNESS_DIR, see ADR-0007 / scripts/dev-harness.mjs)`,
  }
}

/** Run one entry of {@link LOCALE_SNAPSHOT_SOURCES} through the checkout import. */
async function importDictionary(sourcePath, exportName) {
  const mod = await import(pathToFileURL(sourcePath).href)
  const dict = mod[exportName]
  if (typeof dict !== 'object' || dict === null) {
    throw new Error(`${sourcePath} has no "${exportName}" dictionary export`)
  }
  return dict
}

/** Regenerate one committed snapshot from the checkout dictionary. */
async function writeSnapshot(entry, harnessDir) {
  const { writeFileSync } = await import('node:fs')
  const { basename } = await import('node:path')
  const dict = await importDictionary(join(harnessDir, entry.source), entry.exportName)
  const body = JSON.stringify(dict, null, 2)
  const header = [
    `/**`,
    ` * Committed snapshot of the ${entry.pkg} \`${entry.exportName}\` dictionary`,
    ` * (${entry.namespace} namespace) — the host copy the locale-facing tests`,
    ` * assert against in published mode, where the npm tarball ships no \`src/\`.`,
    ` *`,
    ` * Mirrors: \`${entry.source}\` in the upstream checkout (default tag:`,
    ` * \`dsh-v0.2.0-rc.2\`). Values are verified against the checkout by the`,
    ` * fidelity contract test (\`tests/host-locale-fidelity.test.ts\`) on every`,
    ` * run with the source available. Regenerate after a verified upstream`,
    ` * bump: \`node scripts/dev-harness.mjs snapshot\` (ADR-0007).`,
    ` */`,
    `export const ${entry.namespace}En: Record<string, string> = ${body}`,
    '',
  ].join('\n')
  writeFileSync(join(REPO_ROOT, entry.snapshot), header, 'utf8')
  return Object.keys(dict).length
}

function printStatus() {
  const resolved = resolveDevHarness()
  const lines = [
    `mode:              ${resolved.mode}${resolved.mode === 'published' ? ' (default)' : ''}`,
    `DSH_HARNESS_DIR:   ${resolved.harnessDir}`,
    `checkout source:   ${resolved.sourceAvailable ? 'available' : 'missing'}`,
    `reachability test: ${resolved.sourceAvailable ? 'runs' : `skips — ${resolved.unavailableReason}`}`,
    `locale contract:   ${resolved.sourceAvailable ? 'runs (snapshot vs checkout)' : `skips — ${resolved.unavailableReason}`}`,
  ]
  for (const line of lines) console.log(line)
}

async function runFidelityTest(extraArgs) {
  const resolved = resolveDevHarness({ ...process.env, DSH_FIDELITY: '1' })
  if (!resolved.sourceAvailable) {
    console.error(`fidelity mode needs the upstream source checkout: ${resolved.unavailableReason}`)
    process.exitCode = 2
    return
  }
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(command, ['test', ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, DSH_FIDELITY: '1' },
    cwd: REPO_ROOT,
    // Windows cannot spawn .cmd shims without a shell (Node EINVAL guard);
    // the args are test-file filters, so naive joining stays safe.
    shell: process.platform === 'win32',
  })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}

/** Exported for tests; the direct-invocation guard below calls the same. */
export async function main(argv) {
  const [command, ...rest] = argv
  if (command === undefined || command === 'status') {
    printStatus()
    return
  }
  if (command === 'test') {
    await runFidelityTest(rest)
    return
  }
  if (command === 'snapshot') {
    const resolved = resolveDevHarness()
    if (!resolved.sourceAvailable) {
      console.error(`snapshot needs the upstream source checkout: ${resolved.unavailableReason}`)
      process.exitCode = 2
      return
    }
    for (const entry of LOCALE_SNAPSHOT_SOURCES) {
      const count = await writeSnapshot(entry, resolved.harnessDir)
      console.log(`wrote ${entry.snapshot} (${count} keys from ${entry.pkg})`)
    }
    return
  }
  if (command === 'sparse-paths') {
    for (const path of SPARSE_CHECKOUT_PATHS) console.log(path)
    return
  }
  console.error(`unknown command "${command}" — expected status | test [args…] | snapshot | sparse-paths`)
  process.exitCode = 2
}

const invokedDirectly = process.argv[1] !== undefined
  && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (invokedDirectly) await main(process.argv.slice(2))
