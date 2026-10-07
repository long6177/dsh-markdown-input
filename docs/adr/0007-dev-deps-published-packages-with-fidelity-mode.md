# 开发依赖模型：默认发布包 + 保真模式

#64 的起点：7 个开发依赖全部 `link:../deepseek-harness/...`，任何贡献者或 CI 要跑 `typecheck`/`test` 都必须先克隆上游（261MB 工作树）、在上游 `pnpm install`（约 2GB node_modules）、再构建 client 包。这是贡献者漏斗上最大的洞，也让 CI 冷启动以十计分钟。本 ADR 把测试面改成两层：**默认发布包**（零上游、分钟级）+ **保真模式**（可选，指回本地 checkout 的源码面，供发布前全量与漂移监视使用）。

## 切换中核实的事实（修正票面假设）

1. **发布 tarball 含 `lib/` + 类型 + README，不含 `src/`**；`./src/*` 导出子路径在 exports map 里存在，但指向不存在的文件——只对源码检出成立。
2. **locale 词典无法从包根等价导入**（修正票面「可由包根导入等价替代」）：`@deepseek-ai/dsh-client-locale` 与 `@deepseek-ai/dsh-client-ui-conversation` 的构建入口（`lib/index.js`、`lib/client.js`）都**不**再导出 `en`/`zh` 词典——词典只在插件 `apply()` 时注册进 `LocaleRuntime`。两个 locale 测试改为读**入库快照**（下述）。
3. **可达性测试真需要渲染器源码**：`createSlotRenderer` 不在渲染器任何构建入口的导出里，且构建入口是绕过 react 别名的 host module-loader bundle；`tests/hero-seats-reachability.test.tsx` 通过虚拟模块从 checkout 源码加载，并以 `DSH_HARNESS_DIR` 守卫。
4. **发布包系统性缺运行时依赖声明**（workspace 模型的遗留）：`@deepseek-ai/dsh-client-ui-primitives` 的构建产物静态 import 约 21 个未声明的包（clsx、anser、diff、katex、simple-icons、shiki、@shikijs/langs、micromark-* 、mdast-util-*，以及同为发布包的 `dsh-client-store` 与两个 `dsh-util-*`）；`dsh-client-store` 又静态 import 未声明的 `zustand`、`immer`。本仓 devDependencies 按上游该 tag 的版本范围补齐这批缺口。
5. **registry 依赖默认被 vite-node 外部化**，Node 的 ESM loader 不能加载发布产物内的 `.css` import（`link:` 时代 vite 隐式处理了这些包）。`vitest.config.ts` 显式 inline 整个 `@deepseek-ai/` 作用域，让 vite 管线接手（`css: false` 下 CSS 以桩替身）。

## Decision

- **默认发布包模式**：devDependencies 用与上游 tag 对应的精确版本；干净环境 `pnpm install && pnpm test` 分钟级完成，不需要任何上游检出。版本对应规则见下。
- **保真模式**：`DSH_FIDELITY=1`（或一条命令 `node scripts/dev-harness.mjs test`）+ `DSH_HARNESS_DIR`（默认 `../deepseek-harness`）。vitest 把六个 client 包（及其 `/client`、`/invariant` 子路径）alias 到 checkout 的 `src/` 树——整套测试跑在**源码面**上；react/react-dom 钉死在本仓副本，别名模块与被测组件共享一个 React。模式解析、别名表、CLI 都集中在 `scripts/dev-harness.mjs`（`resolveDevHarness` 同时被 vitest.config 与测试引用，#58/#59 直接复用：CI 把 `DSH_HARNESS_DIR` 指向仓内稀疏检出即可让可达性测试真跑；漂移监视按上游 ref 换检出目录，机制不硬编码任何版本/路径）。
- **可达性守卫**：`tests/hero-seats-reachability.test.tsx` 读 `DSH_HARNESS_DIR`；检出或 `packages/client/ui-renderer/src/client/scoped-slots.tsx` 缺失时**跳过并打印一行明确原因**（`[skip] hero-seats-reachability: …`），绝不静默。
- **locale 词典快照**：`tests/host-locale/common-en.ts`、`tests/host-locale/conversation-en.ts` 入库（`0.2.0-rc.2` 的逐键快照，由 `node scripts/dev-harness.mjs snapshot` 从 checkout 生成）；两个 locale 测试读快照。保真契约测试 `tests/host-locale-fidelity.test.ts` 在检出可用时把快照与 checkout 源词典逐键比对（published 模式也会跑），保证快照不失真；检出缺失时跳过并打印原因。
- **虚拟模块边界**：checkout 源文件一律通过 `@dsh-harness/*` 虚拟模块（vitest.config.ts alias 到 `DSH_HARNESS_DIR` 下的真实文件）访问；检出缺失时 alias 落到 `tests/harness-source-stub.ts`（执行即抛错）——import-analysis 必须能解析这些字面量动态 import，守卫才能以「跳过 + 原因」而不是「解析崩溃」降级。

## 版本对应规则

- **六个 client 包 + 三个支撑包**（locale、ui-chat、ui-conversation、ui-primitives、ui-renderer、ui-slots；store、util-code-language、util-workspace-path）：精确 `0.2.0-rc.2`。上游按版本 lockstep 整套发布，npm dist-tag `next` 指向它（`latest` 多停在上一个产品线，不能作为对应依据）。
- **`@deepseek-ai/cordis`**：精确 `4.0.4`。对应依据：上游 checkout 在 tag `dsh-v0.2.0-rc.2` 的 `vendor/cordis/package.json` 即 `4.0.4`。cordis 有 dsh 版本化 dist-tag（如 `dsh-0-2-1-alpha-1` → `4.0.5-alpha.1`），但**没有** `dsh-0-2-0-rc-2` tag，因此规则定为「随上游该 tag 的 vendor 版本」，不猜 dist-tag。
- **运行时缺口包**（事实 4 的约 23 个）：取上游该 tag 各包 `package.json` 的 devDependency 范围（`simple-icons` 上游钉死 `16.31.0`，照搬精确）；这是「上游构建产物运行时实际需要」的忠实记录，也是漂移监视的复核点之一。

## 对发布仪式与 CI 的影响

- **发布仪式**（[ADR-0004](0004-npm-release-remote-feedback-loop.md)）不变：npm 发版、双 flag、OTP 人工、真机重测照旧。新增前置：发布前全量在**保真模式**下对准上游 tag 跑一遍（`node scripts/dev-harness.mjs test`），替代昔日「link: 依赖即源码面」的默认等价。
- **CI**（#58）：单级流水线跑发布包模式；如需让可达性测试真跑，把上游稀疏检出放进仓内并设 `DSH_HARNESS_DIR`——稀疏检出内部的裸导入会解析到本仓 node_modules（事实 4 补的依赖正是为此兜底）。
- **漂移监视**（#59）：每个新上游版本 → 新检出 + `DSH_HARNESS_DIR` 指向它 → 保真全量 + semver 检查 → 一版一票。同步动作：升级 devDeps 精确版本、`node scripts/dev-harness.mjs snapshot` 重生成快照、逐项核对缺口包清单。

## Consequences

- 贡献者漏斗补上最大缺口：克隆本仓 + `pnpm install` + `pnpm test`，不再依赖上游克隆/安装/构建；devDependencies 体积上升（shiki、simple-icons 等），换取的是发布产物的真实运行面。
- 两个 locale 测试断言的是**入库快照**里的宿主文案而非实时检出——快照由契约测试与漂移流程背书，篡改或漂移会在下次带检出的运行中暴露。
- 上游发布包的 `./src/*` 子路径是死导出（tarball 无文件），本仓测试不得再引用；保真模式经 vitest alias 走源码，不经包 specifier。
- 三个 `@dsh-harness/*` 虚拟模块与 `tests/harness-source-stub.ts` 是 vitest 专属机制；`scripts/dev-harness.mjs status` 随时可查当前模式、检出可用性与各套件的运行/跳过状态。
- 可达性测试在「无检出」环境（典型：CI 干净克隆）跳过属预期行为，跳过原因固定打印；「带检出」的默认运行仍然真跑（本仓开发机即如此）。
