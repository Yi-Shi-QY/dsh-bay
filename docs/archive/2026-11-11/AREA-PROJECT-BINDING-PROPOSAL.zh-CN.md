# 区域项目绑定与多对话编排讨论稿

> 归档日期：2026-11-11。本文保留历史设计与证据，正文状态只代表原记录时点。现行规则见[当前说明](../../V18-PROJECT-AREA-OWNERSHIP.zh-CN.md)；归档原因见[归档索引](../README.md)。原文内容保留，相对链接已修正。

日期：2026-11-09（Asia/Shanghai）  
状态：历史代码核查与设计建议。任务继续策略已于 2026-11-09 经用户确认；后续目录方案已进入 alpha18.0 实施阶段，本文不代表当前完成状态。  
核查基线：当前 `main`，HEAD `768dd4c`，包括现有未提交的背景 AI、UI 和 Bay Agent 编排改动。

现行实施依据：[18.0 重构计划书](V18-REFACTOR-PLAN.zh-CN.md)。最新问题与更新方案：[区域、会话与布局操作解耦核查](V18-AREA-SESSION-DECOUPLING-AUDIT.zh-CN.md)。下文的旧包手动重绑/迁移方案不能作为 18.0 完整包实现依据；旧格式不迁移，轻量模板若保留也必须按来源组而非全区域批量绑定。

后续方向（2026-11-09）：用户提出在 18.0 让工作台拥有根文件夹，区域选择或新建根内文件夹，对话默认使用区域目录，并明确完整包必须携带目录、文件和可继续的对话；Bay Agent 直接使用根目录，维护随包迁移的专属记忆。[18.0 工作台目录架构讨论稿](V18-WORKBENCH-DIRECTORY-ARCHITECTURE.zh-CN.md)作为最新上层约束；本文的“任意已有项目”绑定建议收敛为根内项目。本文第 7 节的模板/手动重绑方案仅适用于旧格式和轻量模板，新完整包按 18.0 方案自动恢复会话。已确认的任务续用策略继续有效。

## 1. 本次问题与目标

用户在另一台机器实测时发现：区域原来绑定一个对话，而 Bay Agent 派发任务会在区域中创建新对话，持续出现同名或未命名对话。用户提出区域改为对应一个项目文件夹；同一区域可以承载同项目下的多个对话，对话内页仍然绑定一个具体对话。

本稿依据本机当前代码静态核查；没有把另一台机器的现象当成本机已复现的结果。需要区分三个问题：

1. 区域身份仍是 Session，和多 Worker 编排的需求冲突。
2. Worker 没有完整的任务命名策略，内页创建时使用通用标题。
3. 每个新的 Assignment 都会创建自己的 Worker 对话；任务续做、恢复和独立新任务没有显式的对话复用策略。

项目绑定解决第一个问题。命名、任务续做和重复派发控制需要同时设计，不能依靠项目绑定自动解决。

## 2. 当前代码证据

| 位置 | 当前行为 | 改造影响 |
| --- | --- | --- |
| [model.ts](../../../packages/workbench-core/src/foundation/model.ts) / [document-v3.ts](../../../packages/workbench-core/src/foundation/document-v3.ts) | `GroupNode` / `AreaNode` 的 `areaBinding` 是 `SessionBindingV1`；存在显式绑定时，校验区域内 Session 内页使用同一对话 | 增加区域项目身份，改为校验项目一致，保留内页自己的 Session |
| [workbench-control-plane.ts](../../../packages/workbench-core/src/foundation/workbench-control-plane.ts) | `createSession(append: true)` 删除旧 `areaBinding`，追加独立内页；`ensureEditor` 仍从区域 Session 取绑定，并按 editorId/scope 找已有内页 | 将追加对话作为正式能力；插件实例查找需要包括目标绑定 |
| [host-bay-agent-worker.ts](../../../packages/workbench-core/src/host-bay-agent-worker.ts) | 项目从 Work Item、区域 Session、区域某个内页依次推断；每个 Assignment 走新建对话路径 | 默认从区域项目获取，禁止任务悄悄覆盖项目；增加继续既有 Worker 的路径 |
| [host-bay-agent.ts](../../../packages/workbench-core/src/host-bay-agent.ts) | Worker Session ID 按 Assignment/requestId 派生；已有 Session 会复用；只看到 Main 显式改名为 Bay Agent，Worker 创建没有任务标题参数 | 保留相同请求幂等；增加命名与明确的任务目标；不能把所有新增对话归因于创建接口重复执行 |
| [repository.ts](../../../packages/workbench-core/src/foundation/repository.ts) / [session-binding-picker.ts](../../../packages/workbench-core/src/foundation/session-binding-picker.ts) | 绑定或切换区域来源对话时，会批量重绑 Session 内页；部分新建入口把已有对话内页替换为同一实例 | 拆开区域选择项目与内页选择对话；按内页实例操作 |
| [area-session-binding.ts](../../../packages/workbench-core/src/foundation/area-session-binding.ts) / [WorkbenchFrame.tsx](../../../packages/workbench-core/src/foundation/WorkbenchFrame.tsx) | 顶栏、标记等优先使用区域 Session，缺失时退回当前内页；浮窗放入区域和区域合并有同 Session 限制 | 顶栏使用固定项目；状态和标记跟随各内页；同项目不同对话允许合并或放入 |
| [area-tab-rows.ts](../../../packages/workbench-core/src/foundation/area-tab-rows.ts) | 标签标题取 `lastKnownTitle`，而控制面创建 Worker 内页写的是“对话” | 同时处理原生 Session 标题和内页展示标题 |
| [module-contract.ts](../../../packages/workbench-core/src/module-contract.ts) / [official-area-registrar.ts](../../../packages/workbench-core/src/client/official-area-registrar.ts) | 声明已有 none/workspace/session 要求，但官方 Session 内页默认 `sharing: area`；文件、终端、浏览器等也声明需要 Session | 不能只改声明字符串；必须明确项目来源与具体 Session 来源，兼容旧插件 |
| [workbench-sharing.ts](../../../packages/workbench-core/src/foundation/workbench-sharing.ts) | 旧 portable 会话模板按区域当前内页生成 `areaKey -> templateId`，默认 active-editors-only | 新格式需要项目、Session 模板与内页三层关联，不能漏掉同区域其他对话 |
| [workbench-layout-package.ts](../../../packages/workbench-core/src/foundation/workbench-layout-package.ts) | layout 包保留全部内页，但导入重绑参数按 Area 给一个 Session，并用于该区域各个需绑定内页 | 保留所有内页之间的不同 Session 关系；V4 分发及其重绑界面同步升级 |

## 3. 建议的领域关系

```text
Workbench：整体目标、背景、持久 Bay Agent Main
  Area：分工背景 + 一个项目绑定
    对话内页 A -> Session A（本项目）
    对话内页 B -> Session B（本项目）
    轨迹 / 终端 / 审查内页 -> 明确的来源 Session 或资源
    仅需要项目的插件 -> Area 的项目
    无绑定需求的插件 -> 独立使用
```

建议将“项目文件夹”映射到 DSH 已有 Workspace，以 `workspaceId` 为本机身份，通过 Host 解析目录。目录路径不是跨机器稳定身份；区域绑定项目也不意味着新建文件夹或复制目录。

建议规则：

- 一个区域至多绑定一个项目，多个区域可以指向同一项目，分别承担开发、测试、文档等分工。
- 区域可以暂未绑定项目，纯独立插件仍能使用。首次选择项目不创建占位 Session。
- 区域内所有有项目归属的对话必须属于该项目。导入后待绑定内页可以保留；不能默默借用当前全局项目。
- 对话内页继续保存自己的精确 Session 绑定。多个资源内页可以明确引用同一个来源 Session。
- 项目包含的所有对话不自动全部打开为区域内页。区域只呈现用户或 Bay Agent 选择放入的内页。
- 项目改名或路径显示更新不改变区域身份。项目缺失、对话归档或移出项目应显示局部不可用状态。

建议增加独立的 `AreaProjectBinding`（示意名称）和项目绑定版本号。不要让同一个 `areaBinding` 字段在不同代码中有时表示项目、有时表示 Session。

## 4. 交互入口

区域顶栏显示“区域名称 · 项目名称”，菜单提供项目选择、项目定位、区域背景等操作。对话名称、Agent 模式、运行/输入等待/完成状态归具体对话内页。区域需要总状态时，聚合本区域各任务状态。

区域的“添加内页”应区分：

1. 在当前项目中新建对话，选择 Agent 模式。
2. 打开当前项目已有对话；已打开的同一对话优先定位已有内页。
3. 添加插件内页：按插件要求使用项目，或显式选择来源对话。

切换某个内页的来源只影响这个内页，不再批量改绑同区域其他 Worker。可以在创建一个资源内页时默认选中当前对话，但保存之后必须保留明确来源。

同项目的不同对话允许在区域之间拖拽、合并和从现有浮动工作区放入。跨项目操作需要明确路由到另一个区域，不能顺手修改 Session 的项目。Bay Agent 系统聊天继续位于现有浮动工作区。

建议首版只允许空区域直接更换项目；有对话或运行任务的区域通过新区域或明确迁移流程处理。归档/删除区域与归档/删除原生对话必须保持独立操作。

## 5. Bay Agent 派发、命名与继续任务

`bay_create_area` 应能够绑定项目；`bay_inspect` 明确返回区域项目与各内页 Session。`bay_dispatch` 默认继承区域项目，显式传入不一致项目时返回可解释的错误。普通 UI 与 Bay Agent 使用同一套绑定校验。

建议把执行目标明确成“新建对话”或“指定已有对话”，让模型能作出选择，Host 负责核验项目、可用性、Agent 模式、运行状态和任务归属。不要按对话名称查找并复用，也不要复用任意空闲或空白对话。

建议命名来源是 Work Item 的短标题/目标，回退时带任务短编号。例如：

- `实现登录接口 · T12`
- `登录接口测试 · T13`
- `实现登录接口 · T12 · 尝试 2`（确实新开恢复对话时）

原生 Session 名称与标签显示都需要处理；用户手动改名后，后续状态更新不应覆盖它。标题只用于展示，幂等和恢复继续依赖稳定 ID。

**已确认：任务继续策略（2026-11-09）。** 用户选择：“同一任务优先续用原对话，新任务另建对话；对话失效或需要隔离时可另建”。后续实现以此作为默认策略。

具体执行规则如下；失效判定与隔离原因需要在实现中明确记录：

| 场景 | 对话处理 |
| --- | --- |
| 新的独立 Work Item | 在区域项目下新建对话 |
| 同一 Work Item 继续或恢复，原对话仍可用 | 优先续用原 Session，定位或恢复其内页 |
| 原对话失效或显式需要隔离上下文 | 允许新建，记录原因及前后对话/执行关联 |
| 相同派发请求重复送达 | 返回既有结果，不新增任务或对话 |
| 原生授权或输入等待 | 在原对话处理并继续，不创建替代对话绕开等待 |
| 原对话正被其他执行占用 | 先等待或协调；不并发写入，也不把忙碌直接当成失效 |

实现时必须同时满足以下边界：

- 新的执行尝试仍拥有新的 Assignment，Session 可以复用；旧 Assignment 的迟到回调不能被记到新执行上。
- 对同一运行中的 Work Item 的重复启动继续幂等；原生输入等待应走答复/继续路径，不能用新建对话绕开。
- 已结束任务的原 Session 复用前检查是否空闲；不要向用户正在操作或另一个任务正在使用的对话并发派发。
- 新建 Work Item 请求也需要稳定请求标识；对同一派发请求重试不能创建新任务。当前 `bay_dispatch` 参数还没有此类请求标识。
- 已有 `bay_message` 能发消息，但没有在入口中创建/切换 Assignment；它不能直接当作完整的任务恢复实现。

## 6. 插件与运行时边界

当前官方文件、终端等能力通过 Session 获取目录、服务或原生引用；区域有项目身份后，它们不会自动成为真正的项目级能力。首版可以保留这些原生服务的具体 Session 来源；真正支持 workspace-only 的插件走项目绑定。不要为显示项目顶栏或填补插件缺少绑定而偷偷创建空对话。

`ensureEditor` 的实例匹配要从“区域 + editorId”扩大为包含来源绑定/资源的匹配，否则为 Session B 打开轨迹可能拿到 Session A 的内页。浮动工作区内页移入区域也必须保留来源。

执行有效性校验需要区分：

- 区域项目是否改变；
- 当前 Worker 内页及其 Session 是否改变；
- 工作台/区域背景是否更新；
- 本次 Assignment 是否仍有效。

向区域追加第二个对话不能使第一个 Worker 的报告失效。目前 Adapter 为带 moduleInstanceId 的执行跳过区域 generation 检查；增加项目绑定后需要明确独立的项目版本检查，不能沿用“有内页就忽略所有区域变化”的规则。

项目缺失、明确改绑或来源不再可用时，进入可解释的中断/Attention 流程。恢复根据仍然有效的任务与对话关联处理。

## 7. 背景与工作台包

工作台背景仍描述整体目标，区域背景仍描述该区域分工。区域项目是结构化事实，不应只写进背景 Markdown 再靠模型猜测。

背景 AI 继续保持三个入口的既定取材范围：创建工作台读名称/简介；工作台背景读当前工作台和区域内页；区域背景读当前区域全部内页。区域项目名称与会话任务标题可以进入对应范围的事实；不因为项目绑定而扩大成读取项目所有对话全文或文件。独立单轮模型服务和可配置提示词继续适用。

包格式需要同时表达：

```text
包内 projectRef -> 接收方选择的 Workspace
区域 -> projectRef
内页 -> sessionTemplateRef（或项目/独立资源要求）
同来源资源内页 -> 同一个 sessionTemplateRef
```

要覆盖 layout-only、V4 online-reference/offline-embedded、旧 portable 兼容入口与导入界面。旧 `areaKey -> Session` 导入参数不能继续作为唯一映射。先绑定本地项目，再为各会话模板选择已有 Session 或保留待绑定；需要新建时由显式操作触发。

包内保留区域/对话/任务关系，不携带本机绝对路径、Workspace ID、Session ID 或运行进程。编排 `orchestration.json` 的可迁移引用与校验规则要适配新增关系；NDJSON/checkpoint 的存储机制可以沿用。导入的审计历史不变成接收方自动运行的任务。

区域绑定项目不等于工作台包包含项目目录文件。本次迁移只调整项目引用与对话结构，目录打包属于独立能力。

## 8. 旧数据迁移

| 旧数据 | 建议迁移 |
| --- | --- |
| 区域显式 Session 绑定带 workspaceId | 提取区域项目，原内页 Session 绑定保留 |
| 区域无显式绑定，但所有已绑定内页属于同项目 | 推导唯一项目并持久化，保留全部 Session |
| 只有 sessionId，没有 workspaceId | 在 Host 有可靠归属数据时补齐；未就绪则保留待解析，不能猜当前项目 |
| 同一区域已混合多个项目 | 保留所有原内页和任务关联，标记需要整理；由用户决定拆区域，禁止取第一个项目覆盖其他对话 |
| 空区域、独立插件区域、脱机导入模板 | 保留未绑定或待本机绑定状态，不能创建占位 Session |

本机迁移尽量保留 areaId、moduleInstanceId、Session ID，以保留区域背景、Work Item、Assignment 和 Attention 的关联。拆区域时必须显式迁移这些关联。需要版本化持久结构和解码兼容策略；新格式不应被旧客户端当成可编辑的旧结构静默写回。

## 9. 建议实施顺序与验收

1. **模型与迁移**：区域项目类型、内页 Session 校验、解码及投影、旧数据迁移；先验证同区域两个不同 Session 能保存和重开。
2. **统一 UI 和控制面**：区域项目选择、内页创建/绑定、派发继承项目、拖拽合并、浮窗归位、插件精确来源。
3. **任务生命周期**：Worker 命名、派发幂等、继续/新建策略、Assignment 与 Session 分离、Attention 和迟到报告处理。
4. **包与背景链路**：项目/Session 模板映射、导入重绑、三种背景事实范围、编排审计引用，更新主计划和 API 文档。
5. **封包验收**：通过下面的交叉场景后再做连续长时实测。

验收场景：

- 一个项目区域内手工创建两个不同模式的对话，各自历史、输入、标题与运行状态独立。
- Bay Agent 同时派发两个任务到该区域；新增第二个 Worker 不使第一个报告失效。
- 同一任务请求重复送达、Host 重启、输入等待、失败后恢复均不意外重复创建任务或空白对话。
- 同一任务在可用原对话中恢复时 Session ID 保持一致；确需新执行尝试时 Assignment ID 更新；旧执行的迟到报告不能影响新执行。
- 对话失效或明确需要隔离时允许新建，并能追溯原因及前后执行关系；独立新任务不复用另一个任务的对话。
- 切换一个内页来源，不改动其他 Worker；Session A 的终端和 Session B 的轨迹始终保留各自来源。
- 同项目不同 Session 的区域合并、标签拖拽、浮窗放入成功；不同项目保持明确边界。
- 区域缺少项目、项目不可用、原 Session 归档、原 Session 被移走均有具体可恢复状态。
- 旧单会话区域、已有 Bay Agent 多会话区域、混合项目遗留区域均保留原数据与任务关联。
- 导出同区域多个对话及其资源内页，换机导入后仍是多个不同的会话模板，且同来源内页仍指向同一模板。
- 三处背景生成继续使用各自范围，区域背景只描述该区域。

## 10. 决策状态与待对齐的产品取舍

- 已确认：同一任务优先续用原对话，新任务另建；原对话失效或需要隔离时允许另建（用户于 2026-11-09 确认）。
- 多个区域能否共用同一项目：建议允许；“一区域一项目”不限制“一项目多区域”。
- 已有内容的区域如何换项目：建议首版通过新区域或明确迁移处理，不提供静默批量改绑。

本文前面的内容保留问题分析和设计演进记录；当前实现状态以 18.0 重构计划书和以下段落为准。

## 18.0 当前实施状态

18.0 已在当前 `main` 工作树的 alpha18.0 基线上完成本轮目录、区域项目、多会话、Bay Agent 任务恢复和 V5 完整包实现。Bay Agent 的编排账本使用 NDJSON 与 checkpoint，Native Session 通过迁移适配器恢复，V5 Host 导入保持执行暂停；UI 已统一为“区域项目 + 内页来源对话”。完整自动化回归、类型检查和 RC1 兼容检查已通过，真实模型长时间运行、跨平台实机迁移仍需要用户实测。详见 [18.0 重构计划书](V18-REFACTOR-PLAN.zh-CN.md)。
