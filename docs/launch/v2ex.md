<!--
  状态：草稿，待维护者审阅，未发布（#37 人工节点）。
  渠道：V2EX「分享创造」节点
  发布前：把「素材位」注释替换为 GIF 链接（V2EX 不托管图片，贴仓库托管地址即可）：
  https://raw.githubusercontent.com/long6177/dsh-markdown-input/main/docs/assets/hero-markdown-composer.gif
-->

## 标题

分享一个自己写的 DeepSeek Harness 插件：输入框里实时渲染 Markdown（alpha）

## 节点

分享创造（/go/create）

## 正文

各位好，分享一个最近一直在打磨的小东西。

用 dsh 的 web 界面写提示词时，想加个粗体、列个清单、贴段代码，发送前只能靠脑内预演排版——输入区不渲染 Markdown。所以我写了个插件 dsh-markdown-input，让输入区直接实时渲染：

- 打字即时成型：粗体、斜体、行内代码、删除线都是真的样式，代码块有围栏折叠和语言标签；光标所在行保留原文标记，光标一走标记就折叠（渲染模式），一键切回纯源码（源码模式）；
- 粘贴转换：从网页或 Word 复制过来直接粘贴，自动转成干净的 Markdown；Ctrl/Cmd+Shift+V 仍是纯文本直插；
- 发出去的消息也按 Markdown 渲染（排队插话的 steering 消息同样生效），@提及和技能引用的 chip 都保留；
- 打的字实时镜像进宿主草稿，刷新页面不丢。

<!-- 素材位：此处贴仓库托管链接（V2EX 不托管图片）https://raw.githubusercontent.com/long6177/dsh-markdown-input/main/docs/assets/hero-markdown-composer.gif —— 输入 → 渲染 → 发送 → 气泡 -->

实现方式上有点故事。输入区不是普通文本框：宿主用自带的编辑器、编辑器实例不外借，周边的槽位又改不了文本面本身，所以插件走了官方的 `conversation.composer` 选举链、低优先级「接管」输入区——自带 CodeMirror 6 当编辑面，审批、提问这类内置面板优先级更高、照常抢占，被隐藏的原生控件（工具行、目标栏、统计这些）在卡片里逐个重建。中间还绕过一次「只画不改」的弯路：浏览器的绘制 API 撑不起真加粗，最后回到接管路线、外加两条保险（渲染出错自动退回原生输入区；每个部件先探测再启用，缺谁降谁、不影响打字）。为什么这么选、每条事实的上游出处，都写在仓库的 docs/design/why-takeover.md 里。

安装（npm）：

```sh
dsh plugin --profile web add dsh-markdown-input
```

状态交代：插件是 alpha，积极开发中；dsh 本身处于 developer preview、官方明说会有破坏性变更，所以本插件跟随 0.2.0-rc.x 版本线，0.2.0-rc.2 真机逐项验过（实测矩阵在仓库 README），上游出新版由一个每天跑的漂移监视流程跟踪、一版一票补测试。

仓库（含实现细节和一份写给上游的愿望清单）：
https://github.com/long6177/dsh-markdown-input

欢迎试用、提 issue，也欢迎一起维护。

—— 社区插件，与 DeepSeek 官方无隶属关系。
