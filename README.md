# dsh-markdown-input

English | [简体中文](README.zh-CN.md)

[![CI](https://github.com/long6177/dsh-markdown-input/actions/workflows/ci.yml/badge.svg)](https://github.com/long6177/dsh-markdown-input/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-markdown-input)](https://www.npmjs.com/package/dsh-markdown-input)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin with one core capability — **live Markdown rendering in the composer** — so that prompts written in dsh are easier to organize and easier to think through.

> **Status: alpha, under active development.** dsh itself is a developer preview with compatibility-breaking changes between versions — see [Compatibility](#compatibility) for what has actually been verified on a real machine.

![Typing Markdown in the composer: headings, bold, lists and code blocks render while you type, and the sent bubble shows the same content](docs/assets/hero-markdown-composer.gif)

## What it does

### Live-rendering composer

A low-priority entry on the host's `conversation.composer` election chain ([ADR-0005](docs/adr/0005-composer-revival.md)) takes the composer over with a bundled CodeMirror 6 editor that renders while you type, Obsidian Live Preview style: bold, italic, inline code and strikethrough take their real styles, and syntax markers fold away once the cursor leaves their line. A toggle switches to source mode, where every marker stays visible. Enter sends (IME-safe), `Shift+Enter` breaks the line, and everything you type mirrors into the host draft, so it survives a page reload.

![The same message in render mode (markers folded, real styles) and source mode (every marker visible)](docs/assets/render-vs-source.png)

### Markdown-rendered user messages

Sent user messages and queued steering messages render as Markdown in the chat history — reusing the host's own rendering pipeline — instead of a wall of plain text. `@`-mentions and skill chips are preserved, and the line breaks you typed are rendered as hard breaks.

![A sent user message rendered as Markdown: heading, list and a syntax-highlighted code block](docs/assets/bubble-markdown.png)

### Paste-to-Markdown

Pasting rich text from a web page or a word processor converts the clipboard's `text/html` into clean Markdown — in the takeover editor at the caret, and on the native composer through the host's version-guarded insertion API. `Ctrl/Cmd+Shift+V` still pastes plain text, and plain-text, file and image pastes keep their native behavior.

![Pasting a rich-text snippet converts it to clean Markdown source in the composer](docs/assets/paste-conversion.png)

### Graceful degradation, face by face

Every surface probes the host before it activates and degrades on its own: built-in takeover panels (approvals, questions, subagents) outrank this plugin and keep the composer whenever they need it; a missing host surface sheds its own feature, never the text face; and a card-level error boundary silently falls back to the native composer with the draft intact.

## Install

Requires dsh with the web UI (the desktop app). Verified against dsh `0.2.0-rc.2` — see the [compatibility matrix](#compatibility) before installing on a newer dsh.

```sh
dsh plugin --profile web add dsh-markdown-input
dsh plugin --profile web add github:long6177/dsh-markdown-input
```

## Compatibility

This project makes no range claims. What it has instead is a tested matrix — combinations actually run on a real machine, with dates and outcomes — and a standing watch on upstream drift.

| dsh version | Plugin versions verified | Last on-device verification | Result |
|---|---|---|---|
| `0.2.0-rc.2` | `0.2.0-alpha.0` → `0.2.0-alpha.20` | 2026-10-07 | Passed |
| `0.2.1-alpha.1` | — | — | **Not verified** |

- Every npm release so far — `0.2.0-alpha.0` (2026-10-02) through `0.2.0-alpha.20` (2026-10-07) — was re-tested on the official desktop client running the `0.2.0-rc.2` kernel. Each release ships an acceptance checklist; the per-version index with dates lives in [docs/release/README.md](docs/release/README.md).
- Upstream has published `0.2.1-alpha.1`. This plugin's peer range is `^0.2.0-rc.2` (see [package.json](package.json)); by semver's prerelease rule, that range does not accept `0.2.1-alpha.1`. Verification of it is triggered by drift watch (below); until it passes, no compatibility is claimed for that version.
- **Drift watch.** A scheduled repository workflow checks four upstream signals every day: the npm registry (new versions and dist-tags), upstream releases and tags, commits touching the contract paths this plugin depends on, and the official contract documentation. A new upstream version triggers the full test suite plus semver checks against it, and one tracking issue per version (labelled `upstream-drift`). The workflow only opens issues — it does not change code and does not declare compatibility on its own.

## Design notes

Four short lines here, deep dives in [docs/design/](docs/design/):

- [Why takeover](docs/design/why-takeover.md) — the composer route's engineering story (paint layer → takeover → revival) and the four precise gaps in the current extension model, each backed by upstream source locations.
- [Extension points](docs/design/extension-points.md) — a source-backed survey of what the dsh web UI lets plugins touch: slots, the composer election chain, message renderers.
- [Native surfaces, rebuilt](docs/design/native-surfaces-rebuild.md) — surface-by-surface specs for the tool-row popups a takeover has to redraw (command menu, permission presets, model selection).
- [Prior art](docs/design/prior-art.md) — how mainstream chat composers handle Markdown input, compiled from first-party sources.

Decision records (editor choice, takeover, release ritual, dev-dependency model) live in [docs/adr/](docs/adr/).

**Upstream wishlist.** The gaps above translate into five concrete interface wishes — view-layer reuse, native seats surviving a takeover, a formal takeover contract with a conformance suite, plugin scaffolding, and a stability or deprecation policy for the preview period. They are written up in [docs/design/why-takeover.md · upstream wishlist](docs/design/why-takeover.md#上游愿望清单) and will be published as a Discussions "Ideas" thread for community upvoting.

<!-- post-publish: swap in the live Discussions URL -->

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers the environment (most work needs no dsh desktop app), what still has to be verified on a real device, and the merge gate: **green tests plus a maintainer's on-device re-test**. Bugs and feature requests go to [Issues](https://github.com/long6177/dsh-markdown-input/issues) (templates provided). The path to becoming a co-maintainer is written down as well — this project is maintained with others, not just by one.

## License

[MIT](./LICENSE). This is a community plugin — not an official DeepSeek product, and not affiliated with or endorsed by DeepSeek.
