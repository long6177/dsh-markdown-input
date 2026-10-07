# Contributing to dsh-markdown-input

Thanks for wanting to help. This is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin: Markdown live rendering in the composer, Markdown-rendered user messages, and rich-text paste conversion.

**Pull requests are welcome here.** The upstream core repository does not accept external PRs at the moment and points ecosystem contributions at plugins instead — this repository *is* one of those plugins, so its own contribution surface is open (see §6 for the upstream policy, quoted verbatim).

## 1. Environment

Requirements:

- **Node** `^22.19.0 || >=24.0.0` (the upstream engines requirement; CI runs Node 24). Check with `node --version`.
- **pnpm** — `corepack enable` picks the version pinned in `packageManager` (`pnpm@11.7.0`), or any pnpm ≥ 11 already on your PATH works.

From zero to a green suite:

```sh
git clone https://github.com/long6177/dsh-markdown-input.git
cd dsh-markdown-input
pnpm install        # ~1 minute: installs the published npm packages pinned in devDependencies
pnpm typecheck
pnpm test
```

No upstream clone, install, or build is needed. The dev dependencies are the exact npm releases matching upstream tag `dsh-v0.2.0-rc.2` — the **published-packages model** described in [ADR-0007](docs/adr/0007-dev-deps-published-packages-with-fidelity-mode.md).

Two honest notes about skips, so nothing looks silently broken:

- The `bundle-contract` suite asserts the **built** bundle and skips when `lib/` does not exist yet. Run `pnpm build` first if your change touches the bundle shape (CI always builds before testing).
- Without an upstream source checkout, 4 more tests skip (slot reachability ×2, locale fidelity contract ×2), each printing a one-line `[skip] …` reason. That is the designed degradation of ADR-0007 — a skip is never silent. `node scripts/dev-harness.mjs status` always shows the resolved mode and which suites run.

**Fidelity mode** — only needed for work that must run against the upstream SOURCE face (for example the slot-reachability proof): point `DSH_HARNESS_DIR` at a local [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) checkout pinned to tag `dsh-v0.2.0-rc.2` (the default location is `../deepseek-harness`), then run `node scripts/dev-harness.mjs test`. Mode resolution and the alias table live in `scripts/dev-harness.mjs`; the full story is in ADR-0007.

## 2. What you can do without the dsh desktop app

The most common wrong assumption: *"I don't have the dsh desktop app installed, so I can't work on this."* For this plugin that is not true. The entire test suite runs under jsdom against the host's published UI packages — no running host involved. That covers:

- **Editor layer** — the CodeMirror 6 live-rendering takeover editor: render/source modes, list continuation and hanging indent, IME-safe Enter dispatch, draft mirroring, the attachment bar states.
- **Paste conversion** — clipboard `text/html` → clean Markdown (paste decision logic + conversion pipeline).
- **Projection layer** — Markdown user-message projection, queue strip, stop arms, plan chip, goal strip, workspace row, agent preset, stats pills, context meter — both data logic and the jsdom-rendered faces.
- **Pure logic and all tests** — capability probing, degradation paths, slot reachability (with a checkout), locale snapshots. `pnpm test` is the whole verification surface for everything above.

Where to start reading: [docs/design/extension-points.md](docs/design/extension-points.md) maps every host extension point this plugin uses, and [docs/adr/](docs/adr/) records why things are built the way they are.

## 3. What must be verified on a real device

Some properties can only be judged against a real running host, and no automated test substitutes for them:

- visual alignment with native panels (spacing, radii, menu/popup shapes, focus rings)
- keyboard behavior under real OS/browser keymaps
- IME composition behavior (Enter during Chinese/Japanese composition, and friends)
- parity of rebuilt native faces (hero row, dock row, dialogs) against the native originals

**Contributors are not expected to self-certify any of this.** The maintainer runs the on-device re-test before every release (the [ADR-0004](docs/adr/0004-npm-release-remote-feedback-loop.md) ritual, `scripts/retest-wizard.sh`). If your change touches one of these surfaces, tick the corresponding PR-template box and describe what should be poked at — that is the whole obligation.

## 4. Pull requests

The PR template loads automatically when you open a PR; fill the checklist honestly. The merge gate is:

**green tests (CI and local) + a maintainer's on-device re-test.**

- CI runs `typecheck → build → test` on every PR — the published-package face plus a sparse checkout of the pinned upstream tag, so the source-face suites really run (see [.github/workflows/ci.yml](.github/workflows/ci.yml)). Keep it green; "it passes on my machine" is the starting point of the discussion, not the end.
- One PR = one topic; small PRs get reviewed faster.
- If user-facing behavior changed, update **both** `README.md` and `README.zh-CN.md` (they mirror each other).

## 5. Becoming a co-maintainer

Straight talk, because "maintained with others, not just by one" is a stated goal of this project: commit access is granted on demonstrated work, and the bar is explicit —

- **a few merged PRs** (order of 3+; fixes, tests, docs, and repro reductions all count the same)
- **sustained, visible participation in triage** — reproducing newly reported bugs, pinning affected versions, answering usage questions, narrowing regressions — over a stretch of weeks, visible in the issue tracker itself

When both are visibly true, commit access is granted — you don't need to ask, but you may. Co-maintainers start by owning issue triage; participation in the release ritual (including the on-device re-test) grows with trust.

Good entry points: issues labelled [`good first issue`](https://github.com/long6177/dsh-markdown-input/labels/good%20first%20issue) (maintainer-marked, well-scoped starter tasks) and freshly reported bugs that need reproduction.

## 6. Channels and conduct

**This repository**

- Bugs and feature requests for *this plugin* → GitHub Issues here (the two templates above). This repo has no Discussions of its own.

**The wider dsh ecosystem** — the upstream project's own policy, quoted verbatim from [upstream CONTRIBUTING.md](https://github.com/deepseek-ai/deepseek-harness/blob/main/CONTRIBUTING.md):

> DeepSeek Harness is still at an early stage and under active development. We are sorry that we cannot accept external pull requests at the moment. However, contributing code to this repository is far from the only way to help.
>
> - Identify and report issues or bugs in GitHub Discussions:
>   - Upvote discussions that you would like to bring to the team's attention. We are a very small team and may not be able to reply to every post, but we monitor them and consider them when allocating resources.
> - Contribute to the ecosystem:
>   - Create a plugin that excites you and share it with others:
>     - Associate your GitHub project with the `dsh-plugin` topic to help others discover your plugin.

In practice:

- Questions about **dsh itself** → upstream [Q&A](https://github.com/deepseek-ai/deepseek-harness/discussions/categories/q-a). Ideas for the upstream core → [Ideas](https://github.com/deepseek-ai/deepseek-harness/discussions/categories/ideas) — upvotes feed the team's prioritization, per the quote above. Showing off your own plugin → [Show Your Plugins!](https://github.com/deepseek-ai/deepseek-harness/discussions/categories/show-your-plugins). Chat → the official [DeepSeek Harness Discord](https://discord.gg/4MrtZUhpxg).
- The [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic is the official discovery mechanism for plugins.
- Scope note: the no-external-PRs policy belongs to the **upstream core repository**. This repository is a plugin — the ecosystem path that policy points to — so PRs here are welcome (§4).

**Conduct.** There is no standalone Code of Conduct file yet; until the community is big enough to need one, the working rule is short: keep the discussion technical, address the code and not the person, assume good faith. When a standalone CoC becomes warranted, the Contributor Covenant will be adopted.
