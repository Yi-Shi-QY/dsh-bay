# DSH Bay｜湾域

> **开发、验证、组合、分享 DSH 插件。**
>
> DSH Bay（中文名：湾域）是面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的多区域插件工作台。它把 DSH 原生 Session、Workspace Files、Terminal、Browser 及其他官方内页组织到相互隔离、可恢复的工作区域中，让插件作者可以在一个清晰的边界内开发和验证自己的扩展。

当前仓库是 DSH Bay `0.2.2-alpha.17.6` 的私有候选仓库，目标宿主为 DSH `0.2.2-rc.1`。仓库已经从研究、迁移和历史验收材料中独立出来，方便进行来源审计、兼容性验证和后续公测准备。

> 当前候选仍处于 `private-staging / experimental-unvalidated`。候选记录已包含 rc1 身份、类型检查、严格打包和归档核对；真实 rc1 桌面 smoke 仍未完成。请不要把当前构建当作已发布的稳定包。

## 产品身份

| 项目 | 当前值 |
| --- | --- |
| 产品展示名 | **DSH Bay** |
| 中文名 | **湾域** |
| 产品定位 | DSH 插件开发、验证、组合和分享的多区域工作台 |
| 当前版本 | `0.2.2-alpha.17.6` |
| DSH 兼容版本 | `0.2.2-rc.1` |
| DSH 上游提交 | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` |
| 默认交付 | Core-only |
| 默认安装包 | `dsh-bay` |
| 当前状态 | 私有 staging / experimental-unvalidated |
| 仓库 | <https://github.com/Yi-Shi-QY/dsh-bay> |

“湾域”表示一个可以停靠、整理和继续工作的独立工作域：每个任务拥有自己的 Area、Session 和内页组合，多个任务可以并行存在，又不会因为全局 Session 或布局状态而互相串线。`DSH Bay` 是产品展示名，`dsh-bay` 是统一的安装包名和客户端模块名。内部 Core 职责与 `workbench.core` 标识保持不变。

17.6 试用安装包统一命名为 `dsh-bay-0.2.2-alpha.17.6.tgz`。从旧的 `@dsh-workbench/core` 安装迁移时，先在 DSH 插件管理器停用旧包，再安装并启用 `dsh-bay`，避免两个包同时注册工作台。旧工作台分享包中的 Core 名称保留导入兼容，内部布局与设置标识不改名。

DSH Bay 是独立社区项目，不代表 DeepSeek 官方产品。它遵循 DSH 的原生插件、生命周期和 Plugin Manager 契约，尽量以增量方式提供工作台能力。

## 解决的问题

使用 DSH 原生页面开发插件时，常见问题是工作上下文容易被单一页面、全局 Session 或临时布局打断。DSH Bay 将这些上下文整理为可管理的 Area：

- 一个 Area 可以绑定一个明确的 Session，并独立承载多个官方内页。
- 多个 Area 可以拆分、关闭、恢复和重新绑定，适合同时处理多个插件任务。
- 原生内页可用时直接投影 DSH 提供的实现；原生 entry 不可用时进入显式 fallback，并保留诊断信息。
- 布局、Area 状态和 Session placement 由 Workbench 负责持久化，重启后可以恢复。
- Core 为后续的验证、组合和分享能力提供模块身份、artifact staging、provenance 和 package contract。

## 当前能力

### 多区域工作台

支持 Area 的创建、拆分、关闭、恢复和最小占用约束。容器内页的空间算法保持 Workbench 15.1 基线，用于保证最小宽高、分栏、关闭和恢复行为稳定。DSH rc1 适配不会擅自改变这套几何语义。

### Area-local Session

每个 Area 使用自己的 Session 绑定和更新边界。切换 Session、重绑定 Area、后台暂停或关闭 Area 时，native entry 的 retain/release 生命周期保持在对应 Area 内，避免不同任务之间出现迟到更新或内容串线。

### 官方内页投影

在 DSH rc1 提供对应 entry 时，Workbench 可以承载：

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

`0.2.2-alpha.17.6` 采用 Core-only 方向：Workbench 不显示、不消费 Workbench More。DSH 官方页面仍可使用 rc1 的 `ui-entry-customization`；在 Workbench projection boundary 只过滤官方 `entry-customization` 注册，不屏蔽整个 actions Slot，也不影响其他合法的官方或第三方 action。

因此，官方页面、Workbench 页面和模式切换分别遵循以下行为：

- 官方 DSH surface：官方 More 可见。
- Workbench Sidebar、Conversation 和 Guide 内页：官方 More 不泄漏。
- 其他合法 actions registration：继续可见。
- 退出 Workbench：官方 More 恢复。

### Core-only 交付边界

默认候选只安装：

```text
dsh-bay
```

以下模块明确排除在当前候选之外：

```text
@dsh-workbench/conversation-suite
@dsh-workbench/svgdeepseek-pet
```

Conversation/Start/Trajectory 的生成副本继续保留为独立历史证据，不会因为 DSH 宿主升级到 rc1 就自动宣称已经完成 rc1 迁移。

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
- DSH `0.2.2-rc.1` 兼容环境。

在仓库根目录执行：

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
```

常用命令：

```text
pnpm check:rc1   # 检查版本、DSH 提交、来源索引和 Core-only 边界
pnpm test        # 运行 Core 测试套件
pnpm build       # 构建运行时并生成 build inputs / provenance
pnpm typecheck   # 运行 Host / Client 类型声明门禁
pnpm pack:core   # 生成 Core 包（依赖类型声明门禁）
```

`pnpm verify` 当前包含 rc1 身份检查、Core 测试和运行时构建。测试会输出 jsdom、HTMLCanvasElement 以及上游 source map 缺失等预期警告，但退出码为 0。类型声明和打包门禁的当前状态会记录在 [docs/VALIDATION.md](docs/VALIDATION.md)。

## 兼容性与来源追踪

本候选的来源和身份必须能够从 DSH 提交、依赖锁定、源文件 digest 和构建产物反向追踪：

- DSH generation：`0.2.2-rc.1`
- upstream commit：`66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`
- Sidebar/Workspace source digest：`1ddb4669dbcb52b0a3c93fa1dda418e26994ae83216979849efed76820cd86e3`
- lockfile digest：`c13619ee21412537a484b46ee6cfd86b8045e01414c64fa10d5cf2cf6bec5727`

详细记录见：

- [rc1 兼容 manifest](compat/dsh-0.2.2-rc.1/manifest.json)
- [上游适配记录](packages/workbench-core/core-upstream-adaptation.json)
- [来源索引](packages/workbench-core/rc1-sidebar-workspace-source-index.json)
- [provenance](provenance/dsh-0.2.2-rc.1.json)
- [验证记录](docs/VALIDATION.md)

这些记录区分了 DSH 官方动态投影、Workbench 自有 wrapper 和受控复制源。宿主升级不会自动更新 Workbench 自己复制和改造的文件；任何重基都必须有新的源 digest、patch digest 和验证记录。

## 仓库结构

```text
packages/workbench-core/   当前唯一交付的运行时包
compat/                    DSH rc1 兼容 manifest
provenance/                DSH 与候选身份、来源和 digest 记录
releases/                  当前候选身份与发布记录
scripts/                   可复现的检查、测试、构建和打包入口
docs/                      产品方向、发布清单和当前验证记录
```

对外发布时请同时阅读 [当前验证记录](docs/VALIDATION.md) 和 [发布清单](docs/PUBLISHING.zh-CN.md)。

仓库刻意不包含研究总仓库、launcher、community hub、Conversation Suite 运行时和历史迁移树。这样可以让 alpha 候选的安装边界、来源和发布状态保持清晰。

## 当前发布状态与回滚

候选状态保持为：

```text
private-staging / experimental-unvalidated
```

在以下门禁全部通过之前，不进入公测或稳定发布：

1. rc1 版本身份与 upstream commit 一致；
2. Core-only 默认安装和排除模块检查通过；
3. Sidebar/Workspace 类型声明门禁通过；
4. 官方内页 smoke 通过，包含 Files、Terminal、Browser、Guide 等代表性页面；
5. More 隔离、Area/session 绑定、布局最小占用和 LAN Share 回归通过；
6. clean DSH rc1 profile 与真实桌面环境验证通过；
7. artifact provenance、source digest 和 lockfile digest 可追溯。

如果 rc1 候选失败，应回滚到既有的 15.1 / rc2 验收制品。rc1 migration lock、rc2 验收制品和 rc3 开发证据保持独立，互不覆盖。

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
