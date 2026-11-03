# AreaDeck｜随想域

随想域是面向 DeepSeek Harness（DSH）的轻量多区域工作台。

它为每个任务建立一个有边界的工作空间，将 DSH 原生 Session、Files、
Terminal、Browser 以及其他官方内页组合到一起，并支持恢复和继续工作。

当前仓库是 `0.2.2-alpha.17` Core-only 候选的私有 staging 仓库。它与研究、
迁移和历史验收仓库独立存在，当前不公开，也不默认推送远端。

## 当前候选

| 项目 | 值 |
| --- | --- |
| 产品 | AreaDeck / 随想域 |
| Core 包 | `@dsh-workbench/core@0.2.2-alpha.17` |
| DSH 代际 | `0.2.1-rc.5` |
| DSH 上游提交 | `b830ec950faba0a46dda564be3e2d854afed94f1` |
| 交付面 | Core-only |
| 状态 | 私有 staging / experimental-unvalidated |

默认安装内容只有 `@dsh-workbench/core`。Conversation Suite 和 SVG DeepSeek
Pet 继续排除在候选之外。Workbench More 延后；DSH 官方
`ui-entry-customization` 仍保留在官方页面，Workbench 只在自己的投影边界
过滤该注册。

## 当前能力

- 支持拆分、关闭、恢复和最小占用约束的多 Area 布局；
- Area-local Session 绑定，避免多个 Session 串线；
- 在 DSH 提供对应 entry 时，投影 Workspace Files、Terminal、Browser、
  Document Preview、Changes Review、Plan、Schedule Task、Guide 和
  Subagent Chat；
- 原生 entry 不可用时提供明确的 fallback 和诊断边界；
- 提供模块身份、组合包、产物 staging 和 provenance 契约，为后续插件开发、
  验证、组合和分享提供基础；
- Settings 继续进入 DSH 原生 Plugin Manager。

随想域是附加层，不替换 DSH 的 AgentLoop、SessionEvent、LLM、Tool、Prompt、
Profile 或原生插件生命周期。

## 开发命令

要求 Node.js 24 以上、pnpm 11.28.5。

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

`verify` 会运行 rc5 身份检查、Core 测试和运行时构建。generated
Sidebar/Workspace 类型门禁单独记录在
[docs/VALIDATION.md](docs/VALIDATION.md)；在该门禁和桌面 smoke 通过之前，
本候选不会被当作可发布包。

## 仓库结构

```text
packages/workbench-core/   唯一交付的运行时包
scripts/                   可复现的构建、检查、测试和打包入口
docs/                      产品与仓库说明
provenance/                DSH 与候选身份记录
releases/                  本地候选清单和产物
```

仓库不包含研究总仓库、launcher、community hub、Conversation Suite 运行时或
历史迁移树。

## 产品表达

AreaDeck 是国际产品名；随想域表达的是“每个想法都有自己的工作域”。产品
方向是让 DSH 插件更容易开发、验证、组合和分享；本仓库的第一阶段先冻结支撑
这些流程的 Core 运行时。

## 许可证

Workbench 代码使用 MIT License。上游和第三方许可见
`THIRD_PARTY_NOTICES.txt`。
