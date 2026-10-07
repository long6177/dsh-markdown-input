# 发布稿草稿

> **以下均为待维护者审阅的发布稿，未发布。** 发布动作属于 [#37](https://github.com/long6177/dsh-markdown-input/issues/37) 的人工节点；本目录只是备稿，发布完成后由维护者更新本说明。

## 文件与渠道

| 文件 | 渠道 / 形态 | 发布序 |
|---|---|---|
| `awesome-entry.yml` | awesome-dsh-plugin 收录 PR：单文件条目，落到对方仓库 `data/plugins/long6177__dsh-markdown-input.yml`（对方 README 由生成器产出、不手改） | repo topics（`dsh-plugin` 等）设好之后、介绍帖之前 |
| `discussions-intro.md` | 官方 Discussions「Show Your Plugins!」分类：英文介绍帖（正文附中文摘要） | awesome PR 提交后 |
| `discussions-wishlist.md` | 官方 Discussions「Ideas」分类：英文愿望清单帖（五条各自可独立成帖，便于社区按 upvote 表达优先级） | 介绍帖错开 1–2 天 |
| `v2ex.md` | V2EX「分享创造」节点：中文口语帖 | 第二梯队 |
| `juejin.md` | 掘金文章：中文长文 | 第二梯队 |

## 发布前动作

1. 每份稿件内标注「素材位」的注释处插入实际素材——素材文件由素材票产出（hero GIF 与静态图），仓库 README 的素材接线由 README 重构票负责；在此之前各稿以占位注释存在，不引用任何不存在的文件路径。
2. awesome 收录按对方机制提交：每 PR 只加一个 YAML 文件；预计排队延迟属正常，不催。
3. 愿望清单帖与介绍帖错开 1–2 天发布；帖子发布后回填 `docs/design/why-takeover.md` 中预留的线上链接。
4. 全部文案发布前经维护者审阅（#37 人工节点）。

## 文案规则（终稿摘要）

1. 能力事实优先；不用比较级；不点名其他插件；
2. 风险主动披露：alpha + 上游 developer preview + 实测矩阵 + 漂移监视；
3. 「Obsidian 式实时预览」类比每份稿件至多一次；
4. 仓库 README 与各帖底部各一行非官方声明（社区插件，与 DeepSeek 官方无隶属关系）；
5. 愿望清单只描述接口与期望，不点名任何团队/个人，不用「官方应该」类措辞；
6. 中文稿口语、英文稿克制技术化；
7. 发布前一律经维护者审阅。

相关文档：[`docs/design/why-takeover.md`](../design/why-takeover.md)（四条缺口的工程叙事，文案事实底稿）。
