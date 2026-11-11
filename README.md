# DSH Bay｜湾域

DSH Bay 是面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的多区域工作台。它把项目文件、原生对话、工具内页与 Bay Agent 任务组织在同一个工作台中，并支持浏览器接管和完整工作台包迁移。

当前版本为 **`0.2.2-alpha.18.0`**，兼容 **DSH `0.2.2-rc.1`**。当前交付是私有实验包；最新已验证功能提交为 `ab2a7d8`。安装验收范围见[验证记录](docs/VALIDATION.md)，自动化通过不代表跨平台迁移或真实模型长时间运行已经验证。

## 从这里开始

- [文档导航](docs/README.md)：当前说明、开发入口与历史归档。
- [当前架构](docs/ARCHITECTURE.zh-CN.md)：数据归属、宿主服务、会话、任务与完整包。
- [项目与区域](docs/V18-PROJECT-AREA-OWNERSHIP.zh-CN.md)：关闭、重新关联目录、背景和记忆的规则。
- [创建与导入流程](docs/V18-SHARING-PAGE-DESIGN.zh-CN.md)：创建工作台、完整包预览、进度和恢复。
- [开发与验证](CONTRIBUTING.md)：源码定位、检查命令和交付要求。

## 18.0 的工作方式

| 对象 | 当前职责 |
| --- | --- |
| 工作台 Workbench | 根目录、工作台背景、项目登记、布局和持久 Main 会话 |
| 项目 Project | 项目文件夹、项目背景和记忆；会话与任务按项目归属 |
| 区域 Area | 展示项目的空间，包含内页和布局；关闭即移除该区域，项目资料仍保留 |
| 会话 Session | 独立的原生对话；一个区域可展示多个会话，同一会话也可有多个视图 |
| 内页 | 展示明确的项目、会话或资源，移动和切换标签不改变来源身份 |
| Work Item / Assignment | 持续任务与一次执行尝试，不依赖旧区域一直存在 |

同一项目可以在多个区域展示，共享背景与记忆。新区域关联原项目时先显示项目概览，用户再打开已有对话和内页。原生历史依赖本机映射或完整包恢复；只复制项目文件夹不能迁移全部会话。

## 当前功能

- **文件型工作台**：创建时选择父目录并预览最终路径；项目背景与记忆保存在项目目录的 `.bay/` 中。
- **多会话与内页**：区域和浮动工作区使用明确的会话来源，支持原生内页、扩展分类及独立视图生命周期。
- **总览与项目概览**：工作台列表和详情并排显示，项目概览集中提供背景、记忆、会话和任务入口；可固定工作台到 DSH 原版侧栏。
- **Bay Agent**：每个工作台保留一个 Main 会话，默认不显示其浮动标签，通过顶栏按钮显示或收回。Worker 模式来自宿主实时注册目录，未指定时先发现再选择。
- **浏览器接管**：桌面与一个浏览器页面交接主控，收回显示恢复进度。局域网协作使用独立访问身份，实际跨设备验收仍需补充。
- **完整包 V5**：迁移根目录文件、项目资料、原生会话及附件、任务关系和可迁移扩展内容；导入后任务等待用户继续。
- **创造模式扩展开发**：通过原生 `cordis` 模式使用开发技能；不兼容扩展可在根内修复项目及浮动会话中处理。

## 安装与兼容

| 项目 | 当前值 |
| --- | --- |
| 安装包 / 客户端模块 | `dsh-bay` |
| 内部模块标识 | `workbench.core` |
| 插件版本 | `0.2.2-alpha.18.0` |
| DSH 版本 | `0.2.2-rc.1` |
| DSH 上游提交 | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` |
| 交付范围 | 单一 Core 包；不含 Conversation Suite 或 SVG Pet 独立模块 |

通过 DSH 原生插件管理器安装本地 `dsh-bay-0.2.2-alpha.18.0.tgz`，按宿主提示启用或重启。默认封包目录 `releases/alpha18.0-rc1-private/` 被 Git 忽略，需本地构建或取得交付制品。没有公开 npm 发布完成的记录，不把 registry 安装作为本实验版入口。

如同一 Profile 还装有旧包 `@dsh-workbench/core`，先停用旧包，避免重复注册。**包身份更名不等于旧数据兼容**：18.0 不迁移 17.x 工作台数据或旧格式完整包；当前 18.0 文件型数据的项目归属升级另由 Host 处理。

## 本地开发

要求 Node.js `>=24.9.0`、pnpm `11.28.5`。在仓库根目录执行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:rc1
pnpm test
pnpm typecheck
pnpm build
pnpm pack:core
```

`pnpm verify` 仅组合兼容检查、测试与运行时构建，不包含独立类型检查、封包或实机验收。`pack:core` 清理生成目录后重建运行时和声明，按包的 `files` 白名单封装并生成 `candidate.json`。

源码定位见[仓库结构](docs/REPOSITORY-STRUCTURE.md)。下一轮源码目录重构和性能优化尚未实施。

## 来源、验证与发布

- [RC1 兼容记录](compat/dsh-0.2.2-rc.1/manifest.json)
- [上游适配记录](packages/workbench-core/core-upstream-adaptation.json)
- [Sidebar / Workspace 来源索引](packages/workbench-core/rc1-sidebar-workspace-source-index.json)
- [来源记录](provenance/dsh-0.2.2-rc.1.json)
- [验证与当前制品](docs/VALIDATION.md)、[封包与发布](docs/PUBLISHING.zh-CN.md)、[变更记录](CHANGELOG.md)

DSH 继续负责原生 Agent Loop、Session 持久化、模型、工具及插件管理。Bay 使用这些服务组织工作台，不另建插件管理器。历史来源记录的版本和摘要只说明对应时间的快照，不覆盖当前包与构建输入。

DSH Bay 是独立社区项目，与 DeepSeek 没有官方隶属关系。代码使用 [MIT License](LICENSE)，第三方归属见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。
