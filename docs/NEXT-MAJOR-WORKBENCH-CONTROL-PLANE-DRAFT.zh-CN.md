# DSH Bay 下一大版本：Workbench Control Plane 草稿

状态：产品契约与实验版进度草稿（2026-11-07 更新；未提交）

2026-11-09 更新：18.0 实施以 [重构计划书](./V18-REFACTOR-PLAN.zh-CN.md)为准；当前布局、区域生命周期、插件来源、任务续用及旧提示残余见 [区域/会话解耦核查与更新方案](./V18-AREA-SESSION-DECOUPLING-AUDIT.zh-CN.md)。本文保留早期讨论记录，区域级单 Session 绑定和旧包迁移描述不再作为实现依据。

目标版本：下一个大版本

## 1. 目标

把 Workbench 从“布局和内页的容器”扩展成可以被人类和 Agent 共同理解、组织、调度和恢复的工作空间。

最终形态是在现有浮动工作区内提供 Bay Agent 系统聊天页签。每个 Workbench 自动拥有一个持久 Main Session，随工作台创建和恢复，无需绑定已有会话，不再新建第二个浮动工作区。人类描述目标和边界，Bay Agent 读取背景、组织 Area、创建独立 Worker 会话、调度任务并汇总结果。人类仍可进入任意 Area、Session、文件、终端和变更审查现场。

本版本先完成 Workbench 内部闭环，暂不把 IM、GitHub、飞书等外部消息入口作为主线。

## 2. 核心对象

| 对象 | 作用 |
| --- | --- |
| Workbench | 整个工作台，保存长期目标、全局约束和工作台级背景 |
| Area | 稳定的工作分工与项目目录关联，保存区域背景；内页分别引用具体 Session 或资源 |
| Work Item | 一项需要完成、暂停、重试、交接或结束的工作 |
| Session | 实际进行推理和工具调用的 Agent 会话 |
| Assignment | 一个 Work Item 当前的一次执行绑定，可重启或更换 Session |
| Editor / Module | Area 中可见的内页和内页实例 |
| Bay Agent | 默认的人类对接入口和 Workbench 控制者 |
| Worker | 在被授权的 Area 中执行具体 Work Item 的 Agent |
| Attention Queue | 只收集需要人类处理的结果、阻塞、失败和决策请求 |

Area 表示“在哪里工作”，Work Item 表示“要完成什么”，Session 表示“谁正在工作”，Assignment 表示“这一次执行”。这些对象不能互相替代。

### 2.1 Bay Agent 与外部执行引擎的边界

Bay Agent 是 DSH Bay 自己的产品和控制平面角色。它拥有 Workbench 的目标、Area 组织、Context 写入、权限判断、执行租约和人类交互入口；它的生命周期、提示词组合和恢复策略由 DSH Bay 自己维护。

`dsh-superagent` 可以作为一个外部 Worker 执行引擎或参考实现，提供 Work Item、Assignment、Worker Session、Report、Attention、重试和恢复等可复用能力，但不作为 Bay Agent 的身份、产品命名或事实来源。DSH Bay 通过明确的 Adapter 契约对接它，将外部执行状态映射到 Workbench 的 Area、Context 和 Attention，而不是把官方实现直接嵌入 Workbench Core。

这样官方执行引擎未来升级时，Bay Agent 仍可以独立演进：替换执行后端不会改变 Workbench Context、Area ownership、导入导出格式或人类操作入口。

## 3. Context 模型

Workbench Context 和 Area Context 是结构化的事实来源。Markdown 是面向人类和 Agent 的可读投影，不能成为绕过 ownership 和 revision 保护的第二个事实来源。

### 3.1 Workbench Context

Workbench Context 的最小结构包括：

```text
schemaVersion
revision
human:
  goal
  constraints
  preferences
  allowedActions
  approvalRequired
  environment
agent:
  summary
  currentFocus
  nextActions
  blockers
  proposals
```

### 3.2 Area Context

Area Context 的最小结构包括：

```text
schemaVersion
revision
human:
  objective
  constraints
  inputs
  successCriteria
agent:
  summary
  completed
  nextActions
  blockers
  proposals
```

### 3.3 所有权

`human`、`agent` 和 `derived` 的写入者不同：

| 区段 | 内容示例 | 写入者 |
| --- | --- | --- |
| `human` | 目标、边界、约束、偏好、批准规则 | 人类 |
| `agent` | 摘要、当前重点、已完成事项、下一步、阻塞项、提案 | Bay Agent |
| `derived` | Area、Session、内页、模块和健康状态 | Workbench Core |

Worker 默认只能通过结构化报告提供事实和建议，不能直接修改 `human` 或 `derived`。Bay Agent 可以写自己的 `agent` 区段，也可以把建议提交给人类，但不能把自己的推断直接升级为人类目标或约束。

每个 Context 都有独立的 `revision`。写操作带 `expectedRevision`，过期写入返回 conflict 和当前快照。所有异步操作还必须重新检查目标是否存在、是否被替换以及 ownership 是否仍然允许。

## 4. 默认值、编辑入口和读取时机

### 4.1 默认值

新建 Workbench 和新建 Area 时，Context 默认是空的。旧 Workbench 或旧 Area 没有 Context 时，read API 返回安全的空 Context。

空 Context 不生成一段强制注入每个 Session 的空 Markdown，也不因为“存在一个文件”就让 Bay Agent 误以为人类已经提供了目标。界面显示“尚未填写”，用户可以选择手动填写或使用 AI 辅助生成。

### 4.2 人类编辑入口

- 创建 Workbench 时，创建表单提供可选的“工作台背景”输入框。
- 创建表单提供“AI 辅助生成背景草稿”，生成后仍然由人类编辑和确认。
- 已创建 Workbench 的背景编辑放在 Workbench 顶栏标签菜单中。
- Area 背景编辑放在对应 Area 容器顶栏菜单中。
- 保存 Workbench 或 Area 背景时统一走 Control Plane 的 `context.patch`，写入 `human` 区段并带上 Context revision。
- 人类修改背景后，不强行改写已经开始的模型调用；从下一轮模型调用开始使用新的 Context。

### 4.3 AI 辅助生成

UI 只依赖一个可注入的生成接口：

```ts
generateContextDraft(input:
  | { scope: 'create'; name: string; description: string; currentValue: string }
  | { scope: 'workbench'; workbenchId: string; currentValue: string }
  | { scope: 'area'; workbenchId: string; areaId: string; currentValue: string }
): Promise<string>
```

三个入口共享独立单轮模型服务，不向 Bay Agent Main Session 发消息，也不启动它的 Agent loop。Bay Agent 主动生成背景时调用同一服务；工具调用和结果仍可记录在它自己的会话中。

- 创建工作台：只使用表单中当前填写的名称、简介和已有草稿。不提前创建工作台或 Main Session，用户点击“创建并打开”时才保存。
- 编辑工作台背景：读取当前工作台名称、简介以及全部未归档区域的全部内页名称和类型，结合当前草稿生成整体背景。
- 编辑区域背景：只读取目标区域的全部内页名称和类型，结合当前草稿生成区域背景；不携带其他区域、全局简介或全局内页目录。

内页清单包含当前区域的全部内页，不限于正在显示的标签；不自动读取对话记录、文件正文或插件内部数据。空区域不虚构已有能力。生成结果先填入可编辑草稿，由人类点击保存后写入 `human` 区段；无模型或生成失败时显示错误并保留原草稿。独立差异预览尚未实现。

「工作台设置 → 交互偏好 → 背景 AI 辅助填写」提供独立的模型、思考强度、共用系统提示词和三种场景提示词。默认跟随 DSH 默认模型，界面显示当前具体模型；三个入口统一使用此配置，不读取 Bay Agent 主会话的模型设置。显式 API 请求可覆盖当次模型。完整请求由共用系统提示词、当前入口提示词、用户草稿和按上述范围读取的事实构成，修改提示词不扩大事实读取范围。

配置保存于当前 Profile 的 `WorkbenchSettingsV4.backgroundAi`，适用于本实例所有工作台。旧配置缺失时使用内置默认；无效配置不影响工作台布局恢复。保存后下一次生成读取最新配置，进行中的请求保持原配置；取消编辑不写入，恢复默认先呈现为草稿，点击保存才生效。未保存时离开页面或关闭设置有保护，并发更新采用 revision 检查避免覆盖其他窗口。

该配置属于本机生成偏好，不随工作台包导出或导入；接收方使用自己的模型和提示词。已经保存的工作台背景与区域背景仍随包传递，既有背景的导入导出行为不变。

### 4.4 注入时机

1. 创建或恢复 Workbench 时读取 Workbench Context，生成当前快照，不读取所有 Session transcript。
2. Bay Agent 开始一轮新对话时，注入非空的 Workbench `human` 约束、目标、偏好、审批规则和上一轮 `agent` 摘要，并携带 revision。
3. Bay Agent 聚焦某个 Area 时，读取该 Area Context 和结构化 Area 状态；其他 Area 只提供短摘要。
4. Worker Session 启动或恢复时，注入 Work Item、目标 Area Context 和必要的 Workbench 约束，不默认注入整个 Workbench 背景。
5. Control Plane mutation 前重新读取最新 revision 和 ownership，提示词中的旧快照只能作为参考。
6. Worker 报告、Session 结束或系统恢复时，Bay Agent 先读取当前 Context，再更新 `agent` 区段；旧的提示词快照立即失效。
7. 完整 Context、Markdown 投影和原始事件可以通过 read API 按需读取，不作为每轮对话的默认全量输入。

当前适配层已经把这条注入边界固化为纯契约：Prompt 只携带 Workbench Context、当前 Area Context 和 Work Item 投影，不读取其他 Area 的完整 Context、Session transcript、凭据、绝对路径或插件内部状态。每个执行尝试同时记录 Workbench Context revision、Area Context revision、Area binding generation 和可选 Session ID，供异步报告提交前重新校验。

Host 在 Main 和 Worker 的 system-prompt section 中按模型调用读取最新背景；Worker 派发时附带任务快照和租约。保存背景不会改写正在进行的调用，下一次调用读取新 revision。Main 默认带区域摘要、任务状态和未解决 Attention，完整区域背景通过 inspect 按需读取。

Worker 报告通过 `WorkbenchBayAgentAdapter.applyAreaAgentReport()` 走 Control Plane 的 `agent` 区段 CAS 写入。Workbench 被替换、Area 被删除、目标 Module/Session 变化或 Context revision 前进时，旧租约会返回 `stale`，不会覆盖新的 Context。

### 4.5 Markdown 投影

面向用户的文件名固定为：

- `工作台整体背景说明.md`
- `区域说明.md`

第一版 Markdown 是稳定的可读投影和导出内容。保存结构化 Context 后再生成投影；任意 Markdown 编辑不能绕过 Context schema、ownership、revision、大小限制和来源标记。后续如果支持 Markdown 直接编辑，需要带版本和来源的解析流程，解析失败时保留原文并拒绝回写。

## 5. Workbench Control Plane

第一版使用语义命令，隐藏布局文档、React projection 和原生 Host 细节。

### 5.1 Read plane

```text
workbench.inspect()
workbench.listAreas()
workbench.getArea(areaId)
workbench.context.read(scope, areaId?, sections?)
workbench.listWorkItems(areaId?)
workbench.listModules()
workbench.events(afterRevision?)
```

返回的 snapshot 至少包含 Workbench 身份、Settings revision、Context、Area 列表、Area Context 摘要、Session binding、内页 availability、模块状态、Work Item 状态和 Attention 摘要。

### 5.2 Mutation plane

```text
workbench.createArea({ name, objective, ownership, requestId })
workbench.updateArea({ areaId, patch, expectedRevision })
workbench.archiveArea({ areaId, expectedRevision })
workbench.restoreArea({ areaId, expectedRevision })

workbench.createSession({ areaId, workspaceId?, agentPreset?, requestId })
workbench.bindSession({ areaId, sessionId, expectedRevision })
workbench.startSession({ areaId, prompt, preset?, model?, permissions? })
workbench.sendToSession({ areaId, sessionId, message, requestId })

workbench.ensureEditor({ areaId, editorId, bindingIntent?, requestId })
workbench.removeEditor({ areaId, editorInstanceId, expectedRevision })

workbench.context.patch({ scope, areaId?, section, patch, expectedRevision })
workbench.createWorkItem({ areaId, objective, scope, requestId })
workbench.retryWorkItem({ workItemId, requestId })
workbench.stopWorkItem({ workItemId, reason })
```

所有持久化 mutation 通过 Settings CAS seam。需要重复保护的操作使用 request id 或 idempotency key。第一条切片已经实现 `inspect`、`listAreas`、`getArea`、`context.read`、`context.patch`、`createArea`、`createSession` 和 `ensureEditor`。

## 6. Area 管理归属

Area 归属分为：

```text
user-owned
bay-agent-managed
shared
archived
```

- 人类创建的 Area 默认是 `user-owned`。
- Bay Agent 创建的 Area 默认是 `bay-agent-managed`。
- Bay Agent 可在当前工作台未归档 Area 中新增独立 Worker 对话，不覆盖已有内页；替换已有绑定等结构性修改仍检查 ownership。
- 人类可以显式把 Area 委托给 Bay Agent。
- `shared` Area 的高风险操作需要明确的人类批准。
- `archived` Area 只读，恢复需要明确操作。

## 7. Work Item、Assignment 和恢复

Work Item 第一版状态：

```text
proposed -> queued -> running -> waiting -> needs_input -> ready
                                      |          |          |
                                   blocked     failed    completed
```

Session 崩溃时结束 Assignment，保留 Work Item、Context 和原始证据；恢复时在原 Area 创建新的 Assignment。人类接管后，Worker 的延迟事件不能覆盖人工接管后的状态。

## 8. 工作台包的导出与导入影响

这是 Context 引入后必须单独设计的一条边界。工作台包是“可移植的工作意图和布局”投影，不是 Settings、Session 或本机运行时的完整快照。

### 8.1 当前包格式的事实

当前实现保留旧 layout-only 包的 `portableLayout: 2` 兼容路径：没有 Context 时仍只包含 `manifest.json` 和 `workbench.json`。包含 Context 时使用 `portableLayout: 3`，`workbench.json` 携带结构化投影，包内同时写入 `context.json`、`context/工作台整体背景说明.md` 和各 Area 的 Markdown 投影。完整工作台包仍使用 package schema 2 的可选 Context 扩展；Distribution V4 已允许 portable layout 2/3，并把同一组 Context 文件纳入完整包的清单、摘要和包身份。

当前代码位置：

- [layout-only package](../packages/workbench-core/src/foundation/workbench-layout-package.ts)
- [portable Workbench projection](../packages/workbench-core/src/foundation/workbench-sharing.ts)
- [full package format](../packages/workbench-core/src/foundation/workbench-package-v4.ts)

因此，旧格式继续按严格的旧文件数量和字段集合校验读取；只有新包的 manifest 明确声明 `portableLayout: 3` 时才接受 Context 文件。完整包的 Context 仍通过可选字段和文件清单参与校验，旧包没有这些字段时按无 Context 处理。

### 8.2 导出规则

- 默认导出 `human` Context：Workbench 目标、约束、偏好、自动执行边界、人工确认规则、已知环境，以及 Area 目标、约束、输入和成功标准。
- `agent` Context 作为可选的 Agent handoff 导出。摘要、已完成事项、下一步、阻塞项和提案要带来源、导出时间和来源 revision；接收端把它当作交接参考，不能当作当前运行状态或人类授权。
- `derived` 内容不直接导出。Area ID、模块实例 ID、Session ID、Workspace ID、revision、claim、generation、运行状态、Attention Queue、Session transcript、凭据、绝对路径和窗口句柄都是本地或运行时状态。
- Area ownership 可以作为来源元数据展示，但不能直接成为接收端执行授权。导入后的 Area 默认落为 `user-owned`；用户明确委托后才能升级为 `bay-agent-managed` 或 `shared`。
- `工作台整体背景说明.md` 和 `区域说明.md` 是结构化 Context 的人类可读投影。结构化 Context 是事实来源，Markdown 用于预览、阅读和导出。
- Context 变化会影响包的内容摘要、package identity、manifest 和签名，但不影响插件制品 digest。背景变化不需要重新打包插件制品。

### 8.3 导入规则

- 导入预览显示 Workbench 背景、各 Area 背景、Agent handoff、来源归属和将被清除的本地运行时状态。
- 导入时重新生成 Workbench、Area 和模块实例 ID，并建立旧 Area key 到新 Area ID 的映射；Area Context 必须跟随这个映射恢复。
- 导入后的 Context revision 从新的本地基线开始。来源 revision 只能作为 provenance，不能直接用于本地 CAS 写入。
- Session 继续使用 detached/template 机制。发布者的 Session、Workspace 和 transcript 不进入接收端；用户选择本地 Session 后，再由 Control Plane 绑定。
- 旧版包没有 Context 时按空 Context 导入。
- 新包导入到不支持 Context 的旧版本时，必须明确显示“仅布局降级”，不能静默丢弃背景内容。导出侧需要提供“仅布局导出”选项。
- 包中的 Context 和 Markdown 都是不可信输入，必须复用 Context schema、字段长度、总大小、路径和 Markdown 校验。解析失败时导入失败，或者进入明确的 layout-only 降级结果。

### 8.4 当前实现与后续演进

当前已经落地：

1. layout-only 有 Context 时使用 `portableLayout: 3`，无 Context 的旧 `portableLayout: 2` 包保持可读；
2. 完整包和 layout-only 包都把结构化 Context、Markdown 投影、文件摘要和包身份绑定起来；
3. 默认只导出 `human` Context，`handoff` 必须显式选择；
4. 导入先验证 `context.json`、Workbench Markdown 和 Area Markdown，再创建本地 Workbench；
5. 导入重新生成 Workbench、Area 和模块实例 ID，Context revision 从本地基线开始，Area ownership 降为 `user-owned`；
6. Session、Workspace、transcript、凭据和其他运行时状态仍不进入包。

后续仍可考虑把完整工作台包从“schema 2 可选 Context 扩展”升级为显式 package schema 3，并在导入预览中展示来源 ownership、source revision、exportedAt 和 source package digest。旧格式读取、显式仅布局导出和升级路径需要继续保留。

这让包同时适合两种场景：分享一个“如何工作的工作台”，以及把一个正在进行中的工作交接给另一台机器或另一个人。两者通过导出策略区分，不把本机运行时状态误带进包。

## 9. Bay Agent

Bay Agent 使用现有浮动工作区内的系统聊天页签，复用 DSH 原生正文、输入框和工具显示。主控页签不能关闭、重新绑定、拖出或放入 Area。空 Main 直接显示常驻聊天输入框，无需人工选择项目；Worker 仍各自选择项目和 Agent 模式。页签内的可折叠任务面板显示：

- Workbench 目标和当前重点；
- Area 列表和摘要；
- 运行中的 Work Item；
- 等待人类处理的事项；
- 模块验证、安装和恢复状态；
- 最近决策和 Context 变化。

Bay Agent 默认读取 Workbench Context、Area 摘要、Work Item、Assignment、Worker 报告和与当前决策相关的模块状态。现在这些编排事实通过 Orchestration Context Engine 形成有限当前投影，并附带最近报告、阻塞、决策和事件摘要；需要追溯因果时调用有界的 `bay_history`，不默认读取所有 Session transcript、终端历史或插件内部状态。

Worker 事件先归类为：

```text
silent
progress
ready
needs_decision
blocked
failed
```

进度不制造 Attention；阻塞、失败、输入要求、异常停止和背景写回冲突提示处理。`ready` 显示为待验收，显式 accept 后才为 `completed`。原生授权必须在对应 Worker 对话处理。

Main 由 Host 自动创建和恢复，身份持久化到工作台本机 Settings；浏览器仅展示快照。当前实际 Runtime 是通过 Adapter 接入的 DSH Session Controller，创建独立原生 Worker 会话。Main 工具包括 `bay_inspect`、`bay_history`、`bay_create_area`、`bay_dispatch`、`bay_work`、`bay_context` 和 `bay_message`，Worker 使用 `bay_report`。编排事件与物化状态一起原子保存，旧 V1 journal 没有事件字段时按空账本恢复。

## 10. 权限边界

| 能力 | Bay Agent | Worker Agent | 人类 |
| --- | --- | --- | --- |
| 读取 Workbench 结构 | 可以 | 受限 | 可以 |
| 读取全局背景 | 可以 | 继承必要摘要 | 可以 |
| 修改人类约束 | 不可以 | 不可以 | 可以 |
| 修改 Agent 状态 | 可以 | 只能报告 | 可以 |
| 创建 Area | 可以 | 默认不可以 | 可以 |
| 创建 Session | 受策略限制 | 默认不可以 | 可以 |
| 管理 Bay Agent Area | 可以 | 不可以 | 可以 |
| 管理用户 Area | 可新增 Worker；替换绑定仍检查归属 | 不可以 | 可以 |
| 创建 Work Item | 可以 | 不能扩大 Scope | 可以 |
| 直接修改布局文档 | 不可以 | 不可以 | 由 Workbench 处理 |

所有高风险操作必须有明确作用域、目标 ownership、审计记录、revision 或 idempotency 保护，以及恢复或回滚路径。

## 11. 分阶段交付

### 阶段 0：产品契约

确定 Workbench、Area、Context、Work Item、Assignment、Session、Editor、Module 和 Attention 的术语、状态和权限。

### 阶段 1：Context

交付 WorkbenchContext、AreaContext、human / agent / derived ownership、revision/CAS、空 Context、Markdown 投影和大小限制。

### 阶段 2：Read Plane

交付统一 Workbench snapshot、Area、Session、内页、模块和健康状态 read model。

### 阶段 3：Control Plane Mutation

交付 Area 创建和归档、Session 创建和绑定、ensureEditor、Agent-owned Context 更新、Area claim、generation、CAS、idempotency 和事件记录。

### 阶段 4：Work Item 和 Assignment

交付状态机、Worker 报告、重试、恢复、暂停、人工接管和 Area 关联。

### 阶段 5：包格式和模块集成

交付 Context-aware portable schema、导出策略、导入预览、Area key 映射、ownership 降级、Session template 绑定、模块验证和事务回滚。

### 阶段 6：Bay Agent

交付浮动控制区、专用 Session、受限 preset、Workbench/Area/Work Item/Attention 的提示词组合、结构化报告和决策请求。

当前进度：主链路已接入 Host 与现有浮动工作区中的原生聊天。生命周期、状态机和隔离 Profile 浏览器验证进入实验包验收；真实模型连续自主执行还需配置 Provider 后验证。

### 阶段 6.5：Orchestration Context Engine

交付编排事件账本、当前投影、有限 `bay_history` 回查、Runtime 事件去重、Context patch 结果记录和重启重建。账本拆为 NDJSON，并带 compaction checkpoint；外部 Runtime 使用正式事件信封；可迁移的审计投影进入工作台包。Bay Agent 默认读取当前投影与最近事件摘要，需要因果历史时再回查事件；Session transcript 仍由原生 Session 持有。
### 阶段 7：Attention 和恢复

交付 Attention Queue、结果聚合、阻塞和失败处理、重启恢复、过期 mutation 拒绝和系统健康面板。

### 阶段 8：验证和发布

交付 Context、Control Plane、Work Item、包导入导出、模块事务、干净 Profile smoke、旧 Workbench 迁移、feature flag、禁用和回滚说明。

## 12. 当前计划进度

| 阶段 | 状态 | 已落地内容 | 仍缺内容 |
| --- | --- | --- | --- |
| Context | 实验版已接入 | 默认空、human/agent 分区、revision/CAS、创建及顶栏编辑入口、原生模型草稿、按调用读取背景 | 差异预览、模型实机验收 |
| Read Plane | 第一版 | Workbench、Area、内页、Context、Work Item、Assignment 和 Attention 快照 | 更细查询与上下文预算 |
| Control Plane Mutation | 第一版 | Area 创建、独立 Worker 内页、模式选择、ensureEditor、Context patch、作用域与迟到结果校验 | 完整 claim/delegate/archive/restore API、审计界面 |
| 包格式和模块集成 | 第一版 | Context JSON/Markdown、策略、Area key 映射、ownership 降级、本机 Main 与运行状态隔离 | 导入差异预览、package schema 3、全部容器插件工具聚合到 Bay |
| Bay Agent 聊天与 Main | 已接入 | 现有浮动工作区系统页签、自动持久 Main、原生聊天输入框、Bay 专属 preset、原生 Session compaction 和工具结果裁剪 | Worker preset 能力检查、费用治理与交互打磨 |
| Work Item / Assignment | 已接入 | 自有 ID、DSH 原生 Runtime Adapter、先保存后派发、独立 Worker、显式报告和验收 | 官方 HTTP Adapter、并发预算、细化暂停/接管策略 |
| Orchestration Context Engine | 实验闭环已完成 | 编排事件账本、当前投影、`bay_history` 有界回查、Runtime 回调去重、Context patch 结果记录、旧 V1 journal 兼容和重启重建、NDJSON、compaction checkpoint、正式 Runtime 事件信封、编排历史包导入导出 | 可配置上下文预算、真实 Runtime outbox/断线恢复、长时间真实模型实测 |
| Attention / 恢复 | 第一版 | Host journal、报告转交 Main、恢复新尝试、原生授权保留、重启观察不重发 | outbox 故障注入、系统健康面板 |

本轮优先完成可安装实验包和基础验收。现有插件发现、自动集成和内页声明保留；所有容器插件能力统一映射为 Bay 可调用工具仍需后续工作，不声称本轮全部接通。IM 接入留在后续版本。

## 13. 第一条垂直切片

第一条切片只验证 Workbench 内部闭环：

```text
人类输入：
“创建一个用于重构 X 的工作区域，绑定当前 Workspace，准备 Files、Terminal 和 Changes Review，并启动一个 Session。”

Bay Agent：
1. 读取 Workbench snapshot；
2. 创建 bay-agent-managed Area；
3. 创建或绑定 Session；
4. 确保所需内页存在；
5. 写入 Area Context 的 agent 区段；
6. 创建 Work Item；
7. 启动 Worker；
8. 收到报告后更新 Area Context；
9. 只在 ready、blocked、failed 或 needs_decision 时通知人类。
```

包导出和导入必须在这条切片进入可交付状态前加上 Context 的显式策略，否则导出后重新导入的工作台会丢失目标和区域背景，Bay Agent 也无法可靠恢复工作。

## 14. 主要风险

### Bay Agent 成为单点故障

保留 Area、Session、文件、终端和轨迹的直接进入路径。Bay Agent 是默认对接入口，不能成为唯一事实来源。

### Agent 把自己的文本当成用户授权

保留来源、所有权和权限等级。Agent 摘要、Worker 报告和 Agent handoff 不能自动升级为人类约束。

### Agent 和人类同时修改

所有持久化写入使用 revision。异步操作使用 Area claim 或 transaction，并在提交前重新验证目标。

### 导入包恢复了不该恢复的本地状态

Session、Workspace、凭据、transcript、绝对路径、窗口句柄和运行时状态均不进入包。导入先 detached，用户确认后再绑定本地资源。

### 导入包把 Area 错误地交给 Bay Agent

包只携带来源归属和提示，接收端默认建立 `user-owned` Area。委托需要单独的人类操作。

### Context 和 Markdown 发生分歧

结构化 Context 是事实来源，Markdown 是带来源标记的投影。直接 Markdown 编辑必须经过解析、版本和 CAS 校验。

## 15. 待讨论决策

1. Workbench 和 Area Context 的最终最小字段，以及哪些字段可以由 AI 一次性生成；
2. `human`、`agent`、`derived` 的 Markdown 投影格式；
3. Bay Agent 是否可以申请接管 `user-owned` Area，以及申请和批准流程；
4. `shared` Area 的确认策略；
5. `createSession` 是否只允许受限 Agent preset；
6. 模块自动激活默认采用 `observe`、`auto` 还是 `plan-only`；
7. 用户确认由 Bay Agent Area 完成，还是由 Workbench 原生确认控件完成；
8. Work Item 是否允许同时绑定多个 Area；
9. Area Context 是线性 revision，还是支持分支和合并；
10. Bay Agent 的默认模型、上下文预算和并发上限；
11. 包导出默认是否包含 `agent` handoff，以及是否提供仅布局导出；
12. 导入后的 Area ownership 是否一律为 `user-owned`，以及用户委托入口如何设计；
13. Context-aware package schema、Markdown 投影文件和旧版本降级的兼容策略；
14. 编排事件账本继续使用同一 JSON 数组，还是迁移为 `state.json + events.ndjson`；
15. 事件压缩是否只由规则 projection/checkpoint 完成，还是允许模型生成摘要；
16. `bay_history` 的默认事件条数、最大字节预算和跨 Workbench 查询边界。

当前建议先确定 Context 字段、包导出策略和 ownership 导入规则，再继续设计 Bay Agent prompt 和更复杂的 UI。

## 16. 实验版落地记录（alpha17.5）

本轮以当前 `main` 的未提交工作树为基线，HEAD 为 `799cc6c21e04915b4dcd8b450cad1df990639431`，SDK 为 `0.2.2-rc.1`；不回退旧包，不自动提交。

1. Bay Agent 自定义 `BayAgentWorkItemV1` / `BayAgentAssignmentV1`，外部 Runtime 的 assignment ID 只作为外键。
2. Host 接入真实 DSH Session Controller Runtime。在目标 Area 追加独立对话，指定项目与模式，保存关联后发送任务。内存 Runtime 仅用于测试。
3. Bay Agent 是现有浮动工作区中的系统聊天页签，附带折叠任务/Attention 面板，没有第二个浮动工作区。
4. Main 自动创建并持久化于本机 Workbench Settings，刷新和重启复用同一会话；首次空会话无需人工绑定项目。
5. Work Item、Assignment、Attention 和报告投递标记保存于当前 Profile 的 `.dsh-workbench/bay-agent/` journal。重启观察已有 Worker，不盲目重发；中断进入 Attention，恢复创建新 Assignment。
6. 背景按模型调用读取；报告仅写 agent 区段，revision/绑定变化时提示复核。原生授权仍在 Worker 对话处理。
7. 工作台包只携带选定背景与布局，不迁移本机 Main、Worker、运行中 Assignment、Attention 或 journal。导入后的新 Workbench 自动拥有新的本地 Main。

实验包和证据存放于 `releases/alpha17.5-bay-agent-host-private/`。隔离 Profile 不含模型凭据，真实模型自动分解任务、多 Worker 连续执行和 AI 背景生成仍需配置模型后验收。源码测试中的模拟 Session/报告验证适配契约，不等同于模型实跑。官方 Superagent HTTP 客户端和 IM 接入仍属于后续切片。

## 17. Orchestration Context Engine 落地记录（alpha17.6 工作树）

本轮在现有 Bay Agent 主线中加入 `BayAgentOrchestrationEventV1` 和 `BayAgentOrchestrationProjectionV1`。Controller 对 Work Item、Assignment、Worker 报告、Attention、Context patch、接受和恢复动作记录事件；Host 将物化状态、NDJSON 事件账本和 checkpoint 分开保存，旧 V1 journal 会在首次保存时迁移。

Bay Agent 的 system prompt 和 `bay_inspect` 使用当前投影；新增 `bay_history` 支持按 Work Item、Assignment、`afterSeq` 和 limit 有界回查。Runtime 回调使用幂等键去重，Context patch 仍受原有 ownership/revision/CAS 约束，事件只记录结果，不成为写入旁路。

专项测试覆盖事件序号、重复 Runtime 回调、过滤与 limit、旧 journal 迁移、重启 projection 恢复、NDJSON、长历史压缩、正式 Runtime 事件信封和包导入导出。压缩后只保留最近 128 条事件并返回 checkpoint 边界；工作台包中的 `orchestration.json` 只包含脱敏审计投影，不恢复本机运行态。

## 18. 真实模型实测反馈：区域项目绑定（2026-11-09，讨论中）

用户在另一台机器实测提出：Area 应绑定项目文件夹，同区域允许多个不同 Session 的对话内页，内页仍精确绑定一个对话。当前代码中的显式 Area Session 绑定、整区域重绑、同 Session 合并限制与 Bay Agent 追加独立 Worker 的路径存在语义冲突；Worker 通用标题及每次 Assignment 新建对话也需要配套处理。

已完成静态代码影响梳理并形成[区域项目绑定与多对话编排讨论稿](./AREA-PROJECT-BINDING-PROPOSAL.zh-CN.md)。该项已在 alpha18.0 工作树实施：区域按项目目录归属，内页按来源 Session 绑定，任务续用与插件来源均不再依赖区域代表会话；同项目多区域和有内容区域换项目按 18.0 计划执行。

2026-11-09 用户已确认任务继续策略：同一任务优先续用原对话，新任务另建；原对话失效或需要隔离时允许另建。实现需要区分任务、执行尝试和对话身份，保留重复请求幂等、原生输入等待及旧执行迟到报告的校验；具体规则与验收场景已同步到讨论稿。

## 19. 18.0 工作台根目录与区域子目录（2026-11-09，讨论中）

用户进一步提出：创建工作台时选位置新建工作台文件夹，区域选择或新建根内文件夹，区域对话默认使用该目录作为项目。该方向为区域项目绑定增加工作台级文件归属，也将工作文件携带和导入落盘纳入包设计。

已形成[18.0 工作台目录架构讨论稿](./V18-WORKBENCH-DIRECTORY-ARCHITECTURE.zh-CN.md)，并在 alpha18.0 工作树完成根目录登记、区域相对路径、Host 统一目录/持久服务和原生 Session 迁移适配器。已有任务续用决策继续适用；真实模型长时间运行和跨平台实机迁移仍待验收。

用户随后明确两项核心要求：完整包导入后恢复整个目录、工作文件、对话和资源关系，接收方无需逐个重绑即可继续工作；Bay Agent 使用工作台根目录作为项目，并在其中维护专属持久记忆，记忆随包迁移。18.0 必须交付完整历史/附件/子会话迁移、Main 历史和记忆恢复及实际续聊验证，不能以对话模板或仅恢复审计历史作为完整包验收。原生 DSH 已有完整会话导出和持久化读写基础；工作台级导入、引用映射与恢复仍需实现和验证。

## 18.0 主线补充：原生压缩与 Worker 能力提示

Bay Main 的原生 compaction 已通过真实 Session 级集成测试：压缩事件写入 DSH Session Persistence，恢复后仍可继续对话。Bay 编排 checkpoint、Session compaction 和 Workbench Context projection 继续保持独立边界。

Worker 模式能力摘要已经进入任务派发面板。面板只提示当前 preset 是否具备自动压缩；能力未知或缺少压缩时仍保留用户选择并允许创建任务。
