# DSH Bay｜湾域

> **开发、验证、组合、分享 DSH 插件。**
>
> DSH Bay（中文名：湾域）是面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的多区域插件工作台。它把 DSH 原生 Session、Workspace Files、Terminal、Browser 及其他官方内页组织到相互隔离、可恢复的工作区域中，让插件作者可以在一个清晰的边界内开发和验证自己的扩展。

当前仓库是 DSH Bay `0.2.2-alpha.17.2` 的私有候选仓库，目标宿主为 DSH `0.2.1-rc.5`。仓库已经从研究、迁移和历史验收材料中独立出来，方便进行来源审计、兼容性验证和后续公测准备。

> 当前候选仍处于 `private-staging / experimental-unvalidated`。`pnpm test`、运行时构建和 rc5 身份检查已通过；Sidebar/Workspace 复制源的类型声明门禁和真实 rc5 桌面 smoke 仍是发布前置条件。请不要把当前构建当作已发布的稳定包。

## 产品身份

| 项目 | 当前值 |
| --- | --- |
| 产品展示名 | **DSH Bay** |
| 中文名 | **湾域** |
| 产品定位 | DSH 插件开发、验证、组合和分享的多区域工作台 |
| 当前版本 | `0.2.2-alpha.17.2` |
| DSH 兼容版本 | `0.2.1-rc.5` |
| DSH 上游提交 | `b830ec950faba0a46dda564be3e2d854afed94f1` |
| 默认交付 | Core-only |
| 默认安装包 | `@dsh-workbench/core` |
| 当前状态 | 私有 staging / experimental-unvalidated |
| 仓库 | <https://github.com/Yi-Shi-QY/dsh-bay> |

“湾域”表示一个可以停靠、整理和继续工作的独立工作域：每个任务拥有自己的 Area、Session 和内页组合，多个任务可以并行存在，又不会因为全局 Session 或布局状态而互相串线。`DSH Bay` 是对外传播使用的英文品牌；`@dsh-workbench/core` 仍是运行时技术包名，用来准确表达它承担的 Core 职责。

DSH Bay 是独立社区项目，不代表 DeepSeek 官方产品。它遵循 DSH 的原生插件、生命周期和 Plugin Manager 契约，尽量以增量方式提供工作台能力。

## 解决的问题

使用 DSH 原生页面开发插件时，常见问题是工作上下文容易被单一页面、全局 Session 或临时布局打断。DSH Bay 将这些上下文整理为可管理的 Area：

- 一个 Area 可以绑定一个明确的 Session，并独立承载多个官方内页。
- 多个 Area 可以拆分、关闭、恢复和重新绑定，适合同时处理多个插件任务。
- 原生内页可用时直接投影 DSH 提供的实现；原生 entry 不可用时进入显式 fallback，并保留诊断信息。
- 布局、Area 状态和 Session placement 由 Workbench 负责持久化，重启后可以恢复。
- Core 为后续的验证、组合和分享能力提供模块身份、artifact staging、provenance 和 package contract。

## 17.2 工作台分发

保留 17.1 Home，新增布局分享、签名在线引用和签名离线嵌入。自包含私有 Client/Host Bundle 可随包安装、重启并恢复配置；完整性不足时阻止导出。使用范围与限制见 [17.2 分发说明](docs/DISTRIBUTION-17.2.zh-CN.md)，实际验收与发布门禁见 [验证记录](docs/VALIDATION.md)。

## 当前能力

### 多区域工作台

支持 Area 的创建、拆分、关闭、恢复和最小占用约束。容器内页的空间算法保持 Workbench 15.1 基线，用于保证最小宽高、分栏、关闭和恢复行为稳定。DSH rc5 适配不会擅自改变这套几何语义。

### Area-local Session

每个 Area 使用自己的 Session 绑定和更新边界。切换 Session、重绑定 Area、后台暂停或关闭 Area 时，native entry 的 retain/release 生命周期保持在对应 Area 内，避免不同任务之间出现迟到更新或内容串线。

### 官方内页投影

在 DSH rc5 提供对应 entry 时，Workbench 可以承载：

- Workspace Files
- Terminal
- Browser
- Document Preview
- Changes Review
- Plan
- Schedule Task
- Guide
- Subagent Chat

Files 关注 workspace files remote 与路径解析；Terminal 关注 controller、写入、resize、后台恢复和 xterm 生命周期；Browser 在原生入口不可用时使用 Workbench 自有 iframe/sandbox fallback；Document Preview 使用 Area-local resource binding。其余内页都必须通过 entry key、owner props、Slot 和 Session binding 的契约核验。

### 官方 Plugin Manager 集成

Settings 继续使用 DSH 原生 Plugin Manager 入口。DSH Bay 不维护第二套插件安装、更新或市场逻辑，也不绕过宿主的插件生命周期。

### More 菜单隔离

`0.2.2-alpha.17.2` 采用 Core-only 方向：Workbench 不显示、不消费 Workbench More。DSH 官方页面仍可使用 rc5 的 `ui-entry-customization`；在 Workbench projection boundary 只过滤官方 `entry-customization` 注册，不屏蔽整个 actions Slot，也不影响其他合法的官方或第三方 action。

因此，官方页面、Workbench 页面和模式切换分别遵循以下行为：

- 官方 DSH surface：官方 More 可见。
- Workbench Sidebar、Conversation 和 Guide 内页：官方 More 不泄漏。
- 其他合法 actions registration：继续可见。
- 退出 Workbench：官方 More 恢复。

### Core-only 交付边界

默认候选只安装：

```text
@dsh-workbench/core
```

以下模块明确排除在当前候选之外：

```text
@dsh-workbench/conversation-suite
@dsh-workbench/svgdeepseek-pet
```

Conversation/Start/Trajectory 的生成副本继续保留为独立历史证据，不会因为 DSH 宿主升级到 rc5 就自动宣称已经完成 rc5 迁移。

## 架构边界

DSH Bay 的 Core 是 DSH 原生插件流之上的增量层，主要负责：

- Workbench surface、Area editor slots 和模块生命周期；
- Area/session binding、Session placement 和布局持久化；
- 官方内页的 native Slot projection 与 fallback；
- 模块身份、组合包、安装计划、artifact staging 和 provenance；
- Settings 到 DSH 原生 Plugin Manager 的导航接缝。

DSH 仍然负责：

- AgentLoop、SessionEvent、LLM、Tool、Prompt 和 Profile 主干；
- 官方 root、layout.frame、sidebar、conversation、details owner；
- 官方插件安装、更新、加载和生命周期；
- 官方页面上的 `ui-entry-customization`。

当前仓库不新增 `WorkbenchEntryActionsV1`、Creator Area-local draft adapter、Workbench More analytics 或第二套 Plugin Manager，也不直接调用 `ctx.uiWorkspace.startSession()`。

## 快速开始

环境要求：

- Node.js 24 或更高版本；
- pnpm 11.28.5；
- DSH `0.2.1-rc.5` 兼容环境。

在仓库根目录执行：

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

常用命令：

```text
pnpm check:rc5   # 检查版本、DSH 提交、来源索引和 Core-only 边界
pnpm test        # 运行 Core 测试套件
pnpm build       # 构建运行时并生成 build inputs / provenance
pnpm typecheck   # 运行 Host / Client 类型声明门禁
pnpm pack:core   # 生成 Core 包（依赖类型声明门禁）
```

`pnpm verify` 当前包含 rc5 身份检查、Core 测试和运行时构建。测试会输出 jsdom、HTMLCanvasElement 以及上游 source map 缺失等预期警告，但退出码为 0。类型声明和打包门禁的当前状态会记录在 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 兼容性与来源追踪

本候选的来源和身份必须能够从 DSH 提交、依赖锁定、源文件 digest 和构建产物反向追踪：

- DSH generation：`0.2.1-rc.5`
- upstream commit：`b830ec950faba0a46dda564be3e2d854afed94f1`
- Sidebar/Workspace source digest：`28b18fcb45e98bb5a5b4451bb65e4f4f87a4ea6ba727aa9be81cb977c76f78ee`
- lockfile digest：`0c0ef887bc84c95ea8418872328157776b33815f8a739530996353e52cb4dfc7`

详细记录见：

- [rc5 兼容 manifest](compat/dsh-0.2.1-rc.5/manifest.json)
- [上游适配记录](packages/workbench-core/core-upstream-adaptation.json)
- [来源索引](packages/workbench-core/rc5-sidebar-workspace-source-index.json)
- [provenance](provenance/dsh-0.2.1-rc.5.json)
- [验证记录](docs/VALIDATION.md)

这些记录区分了 DSH 官方动态投影、Workbench 自有 wrapper 和受控复制源。宿主升级不会自动更新 Workbench 自己复制和改造的文件；任何重基都必须有新的源 digest、patch digest 和验证记录。

## 仓库结构

```text
packages/workbench-core/   当前唯一交付的运行时包
compat/                    DSH rc5 兼容 manifest
provenance/                DSH 与候选身份、来源和 digest 记录
releases/                  本地候选索引与构建产物记录
scripts/                   可复现的检查、测试、构建和打包入口
docs/                      产品方向、生态参考、仓库结构和验收记录
```

仓库刻意不包含研究总仓库、launcher、community hub、Conversation Suite 运行时和历史迁移树。这样可以让 alpha 候选的安装边界、来源和发布状态保持清晰。

## 当前发布状态与回滚

候选状态保持为：

```text
private-staging / experimental-unvalidated
```

在以下门禁全部通过之前，不进入公测或稳定发布：

1. rc5 版本身份与 upstream commit 一致；
2. Core-only 默认安装和排除模块检查通过；
3. Sidebar/Workspace 类型声明门禁通过；
4. 官方内页 smoke 通过，包含 Files、Terminal、Browser、Guide 等代表性页面；
5. More 隔离、Area/session 绑定、布局最小占用和 LAN Share 回归通过；
6. clean DSH rc5 profile 与真实桌面环境验证通过；
7. artifact provenance、source digest 和 lockfile digest 可追溯。

如果 rc5 候选失败，应回滚到既有的 15.1 / rc2 验收制品。rc5 migration lock、rc2 验收制品和 rc3 开发证据保持独立，互不覆盖。

## 参与开发

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [docs/VALIDATION.md](docs/VALIDATION.md)。提交涉及 DSH 复制源、Slot contract、native entry、布局或 Area/session 生命周期的变更时，需要同时说明：

- 对应的 DSH surface 和 owner；
- 是否属于动态 native projection、Workbench wrapper 或受控复制源；
- source、patch、lockfile 和构建产物的 digest 影响；
- Core-only、More 隔离和 Conversation boundary 是否保持；
- 需要执行的源码测试、类型检查、构建和桌面 smoke。

## 许可与免责声明

Workbench 代码使用 MIT License，许可证文本见 [LICENSE](LICENSE)。上游 DSH 和第三方依赖的许可证与归属见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

DSH Bay / 湾域是独立社区项目，与 DeepSeek 没有官方隶属关系。使用本候选时请以对应 DSH 版本、兼容 manifest 和验证记录为准。
