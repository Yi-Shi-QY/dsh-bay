# DSH 0.2.2-rc.2 适配与优化方案

更新日期：2026-11-13（Asia/Shanghai）。状态：按方案完成实现；来源检查、全量测试、类型检查、构建和私有封包均通过；桌面实机和第二设备仍待人工验收。

目标上游为 [DSH `dsh-v0.2.2-rc.2`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2)，上游提交 `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c` 已由 Git tag 与 npm `gitHead` 相互核对。首次候选为 `dsh-bay@0.2.2-alpha.18.3`，官方内页修复候选为 `0.2.2-alpha.18.4`，归档控制与路由修复候选为 `0.2.2-alpha.18.5` 和 `0.2.2-alpha.18.6`。目标 DSH `0.2.2-rc.2`；仅产出私有候选，不发布 npm、tag 或 GitHub Release。

## 目标与边界

- 将插件类型、构建输入、上游源码证据和候选元数据统一到 DSH `0.2.2-rc.2`；根开发依赖与 lockfile 解析精确锁定 RC2，发布包的 DSH peer 与引擎声明使用经过验证的兼容范围，迁移格式另行决定历史数据包的读取兼容性。
- 在保留 Workbench Area 路由、Session 隔离、权限边界与项目数据归属的前提下，吸收与插件相关的上游实现和界面改进。
- 先交付新的私有实验候选。新候选使用新的插件版本与候选身份；具体插件版本号在实施时按版本规则确定，不复用 `alpha.18.2` 制品身份。
- DSH RC2 是预发布版本。本次适配通过不代表最终正式版兼容；正式版发布后仍需对照其最终依赖与 API 再做一次差异检查。
- 不改变已有 Workbench、Project、Session、Assignment 或离线包的数据格式。若 RC2 引入真实迁移要求，须独立说明迁移和回滚策略。
- RC1 生成的 V3 布局包与 V4 工作台包在结构、签名、文件摘要和 Core 兼容性通过后继续导入；这些数据包的 schema 独立校验，不执行其中的旧扩展代码。V6 完整包继续按已有 Core 版本范围校验，不受 DSH RC1 代际门槛影响。
- RC1 代际的扩展制品及 Core 自身模块保持拒绝，须针对 RC2 重建并重新核验来源、依赖、权限和构建摘要。

## 影响分级

| 优先级 | 影响面 | 当前证据与处理原则 |
| --- | --- | --- |
| P0 | 依赖与候选身份 | 根开发依赖、Core 构建类型和 `pnpm-lock.yaml` 必须精确解析到 RC2；发布包的 DSH peer 与 `engines.dsh` 使用同一范围，避免宿主升级到兼容的 `0.2.2` 正式版后仍因 peer 精确版本被拒。 |
| P0 | Workspace 菜单 API | RC2 的 primitives 移除了 `getAnchorRect`，改为 `anchorRef` / `anchorPoint` 与 CSS anchor positioning。候选已 rebase 到 RC2 WorkspacePicker，并复核 Workbench 锚点传递。 |
| P1 | 复制的 Sidebar / Workspace | 插件维护 RC1 上游源码镜像、受适配运行副本及哈希清单。需逐文件查看 RC2 变化，保留 Area-local 会话操作和 Workbench 自有行为；不能直接覆盖运行副本。 |
| P1 | 侧栏与浮层体验 | RC2 调整插件入口收纳、长列表滚动、工作区工具栏、菜单定位和窄屏体验。上游侧栏变化需要纳入受控 rebase；Workbench 自有浮层采用独立实现，应另做缩放、滚动和视口测试。 |
| P1 | 原生内页承载 | RC2 改善 Worktree/GitHub 审查、文件搜索、Agent 终端、聊天历史和多层 SubAgent 浏览。DSH Bay 已承载相应原生页面或资源入口，应确认页面仍在正确 Area 打开且不会切换 DSH 全局当前 Session。 |
| P1 | Bay Agent 与 SubAgent / AgentTeam | RC2 使用具名、多层 SubAgent，并允许按 Session 开启 AgentTeam；AgentTeam 中断工具默认关闭。Bay Agent 另有持久 Work Item / Assignment 编排，不能把两种团队状态混为一谈。先核对原生 Session 能力和会话资源路由，再决定是否增补适配。 |
| P2 | Session 与错误 API | RC2 的 `Session.append` 接受批量事件，工具失败提供更明确的错误类型和代码。当前发现的会话快照导入通过 Session Persistence 的 `handle.append`，不是直接调用 `Session.append`；升级后仍须用 RC2 声明确认兼容，并检查错误代码是否被正确保留。 |
| P3 | DSH 其他新增功能 | 搜索提供方、更新渠道、Office、账号通知、Computer Use、MCP 管理等以 DSH 自有行为为主。除非插件直接依赖了变化接口，否则不在本轮复制实现或扩张产品范围。 |

## 实施批次

### 1. 固定 RC2 上游证据

- 新增 `compat/dsh-0.2.2-rc.2/manifest.json` 和对应 provenance，记录 Release tag、提交、源码摘要、依赖代际、候选身份、复制源码状态和验证结果。
- 保留 `compat/dsh-0.2.2-rc.1/`、RC1 provenance 与历史验证记录，不把旧证据改写为 RC2。
- 从 RC2 对应源码与 npm 制品建立 Sidebar、Workspace、primitives、Session、Session Controller 和 DSH CLI 的精确依赖清单；tag commit、npm `gitHead` 与精确 tarball integrity 已记录，不跟随浮动 dist-tag。

### 2. 整体升级依赖闭包与兼容检查

- 将根开发依赖 `@deepseek-ai/dsh` 精确锁定到 RC2；Core 中所有 DSH peer dependency 改用 `>=0.2.2-rc.2 <0.2.3`，并让 lockfile 仍解析到 RC2；同步 workspace 锁文件与构建依赖映射。
- 检查包清单、bundle patch、客户端注入项和宿主导入项是否仍与 RC2 发布包一致。未发布或已移除的包应明确阻断或替代，不能静默保留 RC1 类型。
- 当前检查使用 `pnpm check:compat`，覆盖根版本、所有 DSH peer、候选元数据、source index、provenance、源码与运行副本以及 lockfile；`pnpm check:rc1-history` 对历史源码和索引统一 CRLF/LF 后比对。RC1 的 34 个文件全部一致；原先差异来自 Windows checkout 行尾，不是来源内容变化。
- 不在此批次顺带更新无关第三方依赖。

### 3. 受控 rebase Sidebar / Workspace

- 以 RC2 `dsh-client-ui-sidebar`、`dsh-client-ui-workspace` 的精确发布源码为新基线，更新来源镜像、文件索引、适配文件清单与摘要。
- 把 RC2 的入口收纳、恢复顺序、长列表导航、工作区工具栏和打开目录菜单变化逐项与现有 Workbench 行为比较，再选择性移植。
- 保留并逐项验证既有适配：新建/打开/分叉 Session 通过明确 Area 路由；Area 的聚焦状态不写回 DSH 全局当前 Session；官方入口过滤仅限 Workbench 投影；DSH 官方 owners 不被替换。
- 对新增、删除或移动的上游文件更新 copy manifest，并说明每个运行时额外文件和适配文件的理由。同步计算 source、patch、lockfile 摘要。

### 4. 修正菜单与浮层接口

- 将 `WorkspacePicker` rebase 到使用 RC2 `anchorRef` 契约的上游实现，确认实际触发按钮 ref 能传到 portal 菜单。
- 检查复制的 Sidebar / Workspace 中所有 `Menu` 调用以及项目自有 `Menu` 使用；删除已废弃属性，按需传递 `anchorPoint` 或外部触发器判断，不为未使用能力增加适配代码。
- 对 Workbench 自有的 `WorkbenchFloatingMenu`、绑定选择器和工具栏浮层做并行回归。它们不直接使用 DSH `Menu` 时，不因上游内部实现改动而重写。
- 验证菜单的开合、焦点返回、Escape、键盘子菜单、外部点击、锚点移动、滚动、浏览器缩放、窄视口和暗色主题。

### 5. 核对 Agent、Session 和工具错误边界

- 在 RC2 类型及运行时中核对具名/嵌套 SubAgent 的身份字段、父子关系、目录展开和重试行为；覆盖 `subagent-chat` 与 `plan/subagent` 资源在 Area 内的映射。
- 验证每个 Workbench 的 Main、用户 Session 和 Worker 在是否启用 AgentTeam、恢复已有 Session、停止/中断、归档与重启后仍保持各自预期。Bay Agent 的 Work Item / Assignment 生命周期保持独立。
- 更新随包 Creator 技能和模板，说明 RC2 按名称寻址 SubAgent、AgentTeam 按 Session opt-in，以及 Bay Assignment 与原生 AgentTeam 的边界；不增加第二套 Workbench 开关。
- 重新检查会话导入、事件映射、工具用量错误摘要及重试提示。只在 RC2 声明或实际行为证明接口变化时修改调用代码。

### 6. 形成新的候选并交付验证记录

- 更新当前候选版本、候选 ID、`dshGeneration`、上游提交、锁文件摘要、复制补丁摘要、封包输出路径和构建输入摘要。
- 在 Core 插件清单声明 `engines.dsh` 为 `>=0.2.2-rc.2 <0.2.3`，并将 DSH peer 范围设为同一表达式；使 RC2、后续 `0.2.2` 预发布版和正式版可安装，同时拒绝 RC1 与 `0.2.3`。构建工具和 lockfile 继续固定在 RC2。
- RC1 验证记录保持原样；RC2 验证写入新的候选记录，清楚区分自动化结果、桌面实机验收和跨设备验收。
- 只生成私有候选制品，不发布 npm、Git tag、GitHub Release 或公开市场条目。

## 验收门槛

| 验收层 | 必须通过的检查 |
| --- | --- |
| 依赖闭包 | 根开发依赖、Core 中每个 DSH peer 的 lockfile 解析、实际安装包版本和候选元数据精确指向 RC2；发布 peer 范围与 `engines.dsh` 一致；不存在运行时 RC1 包混入。 |
| 历史包读取 | RC1 V3 布局与 V4 数据包在格式和内容校验通过后可导入；V6 完整包继续使用已有 Core 版本范围；测试确认旧代际可执行扩展制品仍被拒绝。 |
| DSH 插件引擎范围 | manifest `engines.dsh` 接受 `0.2.2-rc.2` 与 `0.2.2`，拒绝 `0.2.2-rc.1` 与 `0.2.3`。 |
| 来源与复制完整性 | RC2 source index 与上游制品一致；所有本地适配和 runtime extras 均有记录；patch digest 可重复计算；运行副本和源镜像无未登记差异。 |
| 自动化 | 上游兼容检查、完整测试、Host/Client 类型检查、生产构建和 Core 封包通过。工作台复制源码及原生页面路由相关测试必须覆盖 Area/Session 隔离。 |
| UI 回归 | 至少检查浅色/深色主题、常用桌面宽度、窄窗口、缩放、长列表滚动和菜单键盘交互；菜单始终贴合触发点且不被容器裁切。 |
| DSH 桌面实机 | 在 RC2 的隔离测试 Profile 安装新私有包，验证启动、工作台打开/关闭、原生 Session、文件/终端/审查/子 Agent 内页、创建与恢复、扩展管理器重启激活。 |
| 协作边界 | 若 RC2 的 Session 团队模式影响共享 Session，则在两台设备上实测 Main/Worker、AgentTeam 开关、子 Agent 路由与 LAN 重连；没有实测时必须明确标为未验收。 |
| 制品 | 封包身份、manifest、build inputs、依赖闭包、文件白名单、大小及 SHA 摘要全部匹配本轮源代码；旧 RC1 包不得被覆盖或冒充 RC2。 |

实施命令应以仓库当前脚本为准。候选完成后至少运行上游兼容检查、`pnpm test`、`pnpm typecheck`、`pnpm build` 和 `pnpm pack:core`，并按 [封包与发布规则](PUBLISHING.zh-CN.md) 核对最终制品。自动化通过不能代替真实 DSH 桌面或第二设备验收。

## 暂不纳入

- 把 DSH 原生 GitHub Review、Search API、Office 或 AgentTeam 面板完整复制到 Workbench。
- 将 Bay Agent 的 Assignment 生命周期替换为 DSH AgentTeam，或自动为所有 Workbench Session 开启团队协作。
- 重构 Workbench 目录、修改 V6 完整包格式、重做 Session 持久化，或调整与 RC2 无关的 UI 几何算法。
- 将 RC2 预发布兼容宣称为 DSH `0.2.2` 最终稳定版兼容。

## 本轮已确定的决策

- 初始适配候选为 `0.2.2-alpha.18.3`，修复候选升为 `0.2.2-alpha.18.4`；RC2 Sidebar、Workspace 与私有 Area renderer 都有来源核验，继续保留 Workbench Area 与 Session 组织方式。
- AgentTeam 保持 DSH 原生的按 Session opt-in；不新增 Workbench 控制面，也不替代 Bay Agent 的 Work Item / Assignment。
- RC1 V3/V4 数据包可按独立 schema、签名、摘要和 Core 兼容性验证后导入；V6 完整包保留已有 Core 范围兼容检查；内嵌 RC1 扩展可执行制品仍不能安装或运行，必须按 RC2 重建。Core 插件 `engines.dsh` 与所有 DSH peer 使用 `>=0.2.2-rc.2 <0.2.3`；构建依赖精确固定 RC2。
- 18.3 的原始验证已由 [18.4 内页修复记录](DSH-RC2-NATIVE-PAGES-AUDIT.zh-CN.md)及[制品验证记录](VALIDATION.md)补充；本轮重新生成的 18.4 候选是当前供复测的包。
- 当前候选仅完成源码、自动化与私有封包验证。桌面安装版仍是 RC1，RC2 GitHub Release 没有桌面制品，所以 DSH 桌面 Profile 安装和第二设备协作仍未验收，不由自动化结果推断通过；本轮没有发布 npm、Git tag 或 GitHub Release。
