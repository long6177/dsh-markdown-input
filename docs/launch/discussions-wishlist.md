<!--
  状态：草稿，待维护者审阅，未发布（#37 人工节点）。
  渠道：deepseek-ai/deepseek-harness 官方 Discussions
  分类：Ideas
  发布序：介绍帖之后错开 1–2 天；五条各自可独立成帖，如需拆分按条目自取
  发布后：把线上链接回填到 docs/design/why-takeover.md 的愿望清单小节
-->

## 标题

Composer-takeover wishlist: five interface expectations from building a composer plugin

## 分类

Ideas（deepseek-ai/deepseek-harness Discussions）

## 正文

Hi all,

I maintain dsh-markdown-input, a community plugin that takes the composer over through the `conversation.composer` election chain to live-render Markdown as the user types. While building it, I kept notes on places where a plugin author's work multiplies for structural reasons rather than conceptual ones. This post condenses those notes into five interface expectations — each described as the interface it would open and why it would matter to plugin authors.

None of this is a complaint. The documented slot system, the election chain with `overlay` semantics, the public `InputActions` API, and the runtime inspection tooling carried this plugin a long way; every item below starts from something that already works.

### 1. A view-layer toolkit: reuse the native controls

The tool-row seats and their popups are composed from view components that stay package-internal: `MenuView` (the slash/command menu), `PopupSelectView`, `PermissionSelect`, and `ModelSelect` are not on their packages' `./client` export surfaces — what exports today is the data layer (`remote.commands.list/execute`, the `permissions` projection, `ctx.modelDirectories`) plus type definitions. A view-layer toolkit — the composed controls exported, or a sanctioned native-faces package — would let a takeover composer reuse the native controls instead of redrawing each popup's layout, anchoring, keyboard handling, and degradation semantics.

**Why this matters to plugin authors:** today each takeover implementer re-derives the same popups by reading host source, and every upstream visual change multiplies across every independent re-implementation. Reusing the real components would keep third-party composers consistent with the host across versions.

### 2. Native seats rendered through the takeover owner

Seats that live inside the fallback subtree — the todo dock and goal strip (`conversation.input.dock`, rendered inside the fallback stack), the context meter (a fixed component inside `InputBar`), the stats pills (`conversation.composer.dock`, mounted only by `InputBar`), the hero workspace row, and the plan chip — disappear from the interface when a takeover is elected, because the fallback is kept mounted but hidden. Child-slot declaration is exclusive to the component that owns and renders that location, so the takeover owner cannot host them. A channel that would let these seats render from, or attach to, the elected composer — for example, seat components a takeover can mount, or a set of standard seats the chain owner may host — would keep a takeover from structurally hiding functionality the user could see a moment earlier.

**Why this matters to plugin authors:** without it, every takeover rebuilds each seat from scratch and re-aligns the rebuild on every upstream preview release; with it, a takeover could stay a thin text-surface replacement and inherit the rest.

### 3. A formal takeover contract with a conformance suite

Composer takeovers are an established pattern — the host's own approval, question, and subagent panels elect through the same chain — but the obligations of a takeover (draft mirroring, IME behavior, submit semantics, chip passthrough, degradation when a face is missing) currently live across documentation pages and individual implementations. A written takeover contract, plus a conformance suite a third party can run against their own composer, would make "a correct takeover" a checkable property rather than a manual re-testing ritual.

**Why this matters to plugin authors:** the contract would turn per-version upkeep from on-device re-verification of everything into running a suite, and it would give the shared chain vocabulary to reviews and discussions of new takeover plugins.

### 4. A scaffold/template for the npm-distributed UI plugin shape

What exists today: the extension cookbook (whose snippets are explicitly not copy-paste-complete), a file-by-file checklist for packages inside the upstream monorepo, and an agent skill with two minimal workspace-bundle templates. What would complete the picture: a scaffold or template repository for the npm-distributed, dual-half UI plugin — the `dsh.client` manifest, TypeScript build, `lib/client.js` entry, one working slot registration and locale registration, installable through `dsh plugin ... add`.

**Why this matters to plugin authors:** that engineering shell is identical for every UI plugin and carries none of a plugin's own value. A first-party scaffold would let contributors start from the extension point instead of from build configuration, and would likely raise the floor of what ships to the ecosystem.

### 5. Contract stability or a deprecation policy for preview releases

The README states plainly that there will be compatibility-breaking changes, and an upgrade-guide mechanism exists for externally observable breaks. Extending that discipline to the client-side surfaces plugins consume — slot keys, projections, remote services, events, theme tokens — would help: either a per-release statement of which client surfaces are stable, or an upgrade-guide entry whenever one of those surfaces changes shape, with the migration collected in one place.

**Why this matters to plugin authors:** plugin authors re-test per release today. Knowing which surfaces are covered by a stability statement — and where the migration notes land — would let us scope each re-test and keep a plugin compatible on the day a release ships, instead of discovering the deltas on device.

---

Happy to elaborate on any item with our working notes, and to test-drive anything that comes out of this against a real takeover plugin.

Community plugin — not affiliated with or endorsed by DeepSeek.
