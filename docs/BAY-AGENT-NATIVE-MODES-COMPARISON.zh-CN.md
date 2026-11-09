# DSH 原版 Agent 模式与 Bay Agent 架构对比

日期：2026-11-09  
状态：基于当前 `main` 工作树（`768dd4c`）的实现核查与第一条实现记录。

本文回答三个问题：DSH 原版的 Standard、PTC、Minimal、Cordis 和 Experimental Agent Team 分别怎样运行；`dsh-superagent` 在原生 Agent Loop 外增加了什么；Bay Agent 当前已经实现到哪里，下一步应该补什么。

本文以仓库当前依赖和源码为准。18.0 计划中的能力，如果还没有对应代码和测试，不在本文中标记为已经完成。

## 1. 先区分三个层次

DSH 的“Agent”不是一个包含所有能力的单体类。当前实现至少分为三层：

```text
Agent 公共 API（dsh-agent）
    ├─ followup / steer / inject / cancel / whenIdle
    ├─ Inbox、状态、模型选择和 agent/* 事件
    └─ preset 作用域、工具和系统提示词由插件注册

标准驱动（dsh-agent-loop）
    ├─ 取 Inbox 中的 next-turn / next-step
    ├─ 组装 system prompt、用户消息和工具
    ├─ prepareCall → 流式模型请求
    ├─ 工具执行、并发控制和取消
    ├─ 工具结果回写后继续下一 step
    └─ Session Persistence 写入事件并在重启时恢复

编排器或产品层
    ├─ Agent Team：Lead、teammate、任务板和消息
    ├─ dsh-superagent：Ticket、Assignment、Durable Effects 和 Worker
    └─ Bay Agent：Workbench、Area、Work Item、Assignment、Attention 和记忆
```

因此，四个原版模式不是四套互不相同的 Loop。它们共享同一个 `dsh-agent-loop`，差异由 preset 是否安装文件工具、PTC 执行器、计划、子 Agent、压缩和其他插件决定。实现依据是 `@deepseek-ai/dsh-agent/README.md`、`@deepseek-ai/dsh-agent-loop/README.md`，以及 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`。

## 2. 公共 Agent Loop 的实际步骤

一次正常的原生 Agent 回合可以概括为：

```text
followup / steer / 恢复
  → Inbox 持久化并唤醒 driver
  → turn 边界：领取 next-step 输入和一个 next-turn 提示
  → agent/pre-step：插件可以拒绝或替换进入本 step 的消息
  → 读取当前 model selection
  → 组装 system prompt、历史、用户批次和工具声明
  → prepareCall，固定本次请求配置
  → 写入 step/start 和必要的 system/user 事件
  → 流式模型请求
  → 工具调用按 executor 策略串行或有界并行执行
  → 写入工具调用与结果、assistant message
  → 若有工具继续，进入下一个 step；否则结束 turn
  → agent/turn-stopping、whenIdle 或等待新的 Inbox 输入
```

这里有几个对 Bay 很关键的细节：

- `followup()` 表示下一轮普通输入，会唤醒 driver；`steer()` 表示下一 step 的输入，也会唤醒 driver；`inject()` 只增加后续模型可见上下文，不负责唤醒。
- `agent/pre-step` 在模型请求准备前运行。压缩插件正是在这里判断上下文压力并改变下一次请求的历史。
- 重试复用已经组装的请求，不重复执行 prompt assembly、`agent/pre-step` 或用户输入准入。
- 流式输出先产生过程事件，完整 assistant message 在持久事件提交后才成为可恢复历史。被取消的流会保留已经交付的前缀。
- Loop 自己负责一个 Agent 的生命周期；插件通过 `agent/*` 事件观察或拦截，不需要重新实现循环。

### 2.1 自动压缩在 Loop 中怎样工作

`@deepseek-ai/dsh-compaction-basic` 不是简单地截断字符串。当前文档描述的流程是：

1. `agent/pre-step` 按当前路由的 token capacity 计算压力。
2. 超过阈值时选取平衡的历史区间，保留系统提示和最近尾部。
3. 先持久化 `compaction/start`，再生成摘要。
4. 重新校验历史表面没有被并发修改。
5. 持久化 `compaction/summary` 和替换消息，最后尝试写入 `compaction/end`。
6. 如果供应商明确返回 context window overflow，则绕过普通阈值做一次最大化压缩并重试。

`@deepseek-ai/dsh-command-compact` 提供 `/compact`；`@deepseek-ai/dsh-compaction-tool-result-pruner` 在进入压缩流程后裁剪超大的工具结果。压缩事件属于原生 Session transcript，不能和 Bay 的编排账本 checkpoint 混为一谈。

## 3. 四个 DSH 原版模式

| 模式 | Loop | 主要能力 | 压缩 | 编排能力 |
| --- | --- | --- | --- | --- |
| `standard` | 原生 `dsh-agent-loop` | 文件读写、搜索、Shell、Job、Schedule、Skill、Todo、Web、Plan Mode、子 Agent、Workflow | `compaction-basic`、`/compact`、工具结果裁剪 | 有子 Agent 和 workflow，但没有 Workbench Area/Work Item 模型 |
| `ptc` | 外层仍是原生 Loop | Standard 的大部分工具；`run_code` 进入 PTC Runtime，在一次调用中批量或并行调用工具 | 同上 | PTC Runtime 是工具执行器，不是第二个持久 Agent Loop |
| `minimal` | 原生 Loop | 轻量只读文件访问、图片读取和持久终端；没有普通写入/编辑、计划、子 Agent、Workbench 编排 | `compaction-basic`、`/compact` | 没有任务板、Area 或恢复编排 |
| `cordis` | 原生 Loop | Standard 风格编码工具，加上 Cordis 组合编辑、插件管理和 Skill | 由 preset 显式挂载的 compaction 组 | 具备插件级组合，但不是 Workbench 控制平面 |

这张表中的“压缩”指的是原生 Session 压缩。Standard、PTC、Minimal、Cordis 的具体插件行可以在 `node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml`、`ptc.patch.yml`、`minimal.patch.yml` 和 `cordis.patch.yml` 中看到。

### 3.1 Standard

Standard 是默认的编码 Agent 组合。它没有单独的“标准循环”；它只是把完整工具和编排插件挂到共享 Loop：

- `tool-fs`、`tool-fs-search`、平台 Shell、Jobs、Schedule 和 Web 负责实际工具；
- `planning` 组提供 Plan Mode；
- `delegation` 组提供 `subagent`、`subagent_fork` 和 workflow；
- `compaction` 组提供自动压缩、手动 `/compact` 和工具结果裁剪；
- Todo、Ask User、Present 等插件通过同一个 Agent 作用域注册工具或提示词。

一次工具调用完成后，工具结果回到同一 Agent 的下一 step。只有显式使用 `subagent` 或 workflow 时才会创建其他 Agent。

### 3.2 PTC

PTC 的关键变化在执行层：模型仍由原生 Loop 驱动，但模型可以调用 PTC 工具，将一段代码交给 PTC Runtime。Runtime 内可以批量、并行执行多个工具，然后把汇总结果作为一次工具结果返回给外层 Agent。

```text
原生 Agent Loop
  → tool-executor-ptc / run_code
    → PTC Runtime
      → 多个工具调用（受 Runtime 并发与取消策略约束）
    ← 汇总结果
  ← 原生工具结果
→ 下一 step 或结束 turn
```

PTC 不是 Bay 所需的 Worker 调度器，也不提供 Work Item、Assignment、Attention 或跨重启的任务账本。它解决的是单个 Agent 回合里的工具调用表达和执行效率。

### 3.3 Minimal

Minimal 仍然使用同一 Loop 和 Session Persistence，但减少模型可见能力：只读文件、图片读取和持久终端，明确关闭普通写入和编辑。它没有 Standard 的 Plan Mode、子 Agent 和 Workflow，因此不能直接承担 Bay Worker 的完整编码任务。

### 3.4 Cordis

Cordis 是面向插件和组合编辑的 preset。它复用 Standard 的主干工具和压缩，同时增加 Cordis 工具、插件管理或对应 Skill。Cordis 的“可扩展”来自插件作用域和组合注册，不是另一套模型循环。

## 4. Experimental Agent Team

`dsh-experimental-agent-team` 在原生 Loop 之上增加一个团队协调层：

```text
Lead Agent（原生 Loop）
  ├─ 创建具名 teammate（fresh 或 fork）
  ├─ steer / inbox 消息
  ├─ shared task board（CAS revision）
  ├─ wait / interrupt
  └─ 查看成员报告和任务状态

每个 teammate
  └─ 自己的 Session + 自己的原生 Agent Loop
```

它解决的是“一个 Agent 如何管理多个同伴”的交互和任务板问题。成员仍是独立 Agent，拥有各自的 prompt、工具、Session 和压缩状态。任务板更新使用 expected revision，消息通过 inbox 进入成员后续步骤。

它没有提供 Bay 需要的工作台根目录、Area 项目映射、完整包迁移、工作台记忆或跨机器会话恢复。因此 Bay 可以借鉴 Team 的消息和 CAS 语义，但不能把 Team 直接当成 Bay 的领域模型。

## 5. dsh-superagent 的架构

`dsh-superagent` 同样没有重写 DSH 的模型 Loop。它在原生 Agent Loop 外面建立一个持久化控制平面：

```text
DSH 原生 Agent Loop
  ├─ Router Main Session
  │    └─ 评估、路由、报告汇总和人类回复
  └─ Worker Session（每个 Ticket 一个）
       └─ 文件、Shell、Job、Skill、Todo、Web、子 Agent

SQLite Store
  ├─ Trigger / Thread / Decision
  ├─ Ticket / Assignment
  └─ durable effects / receipts

Engine
  ├─ Intake：接收和分发 Trigger
  ├─ Evals：候选评估和 Decision
  ├─ Tickets：任务生命周期和恢复
  ├─ Assignments：Worker 运行事实
  └─ Replies：通过 Outbox 回写 Main 或外部 Source
```

`Engine` 是这些聚合的唯一写入者。命令在事务中更新状态，外部执行通过 durable effects 在提交后派发。Engine 的 Passes 定期处理 due effects 和到期评估；宿主重启后读取 SQLite，再恢复中断 Assignment，而不是盲目重新发送历史 prompt。

Router 和 Worker 的边界很清楚：Router 的工具范围窄，不直接修改项目；Worker 持有具体执行目录和 Session，完成后通过 Report 汇报。主会话通过 inbox 在下一个 step 接收报告，避免在当前模型调用中注入高权限执行结果。

这套设计比当前 Bay 多出的关键能力是 durable outbox/effects、明确的 Ticket 阶段和 Source/Thread 订阅模型。Bay 当前使用 Host store、NDJSON 编排账本和约 1.5 秒 reconcile；本轮已把 Main 报告转发改成带尝试次数、退避、发送租约和 receipt 的持久 relay queue。它仍不是 `dsh-superagent` 那样覆盖所有外部效果的通用 effects 系统，外部 Runtime 的跨进程 outbox 仍待接入。

## 6. 当前 Bay Agent 的真实架构

```text
Bay Main Session（bay-agent preset）
  └─ DSH 原生 Agent Loop
      ├─ Workbench/Area/Memory system prompt 投影
      ├─ bay_inspect / bay_history / bay_context
      ├─ bay_create_area / bay_dispatch / bay_work
      ├─ bay_message / bay_generate_background
      └─ BayAgentController
          ├─ Work Item / Assignment / Attention
          ├─ NDJSON ledger + compaction checkpoint
          ├─ Runtime event envelope 去重
          └─ NativeBayWorkerRuntime
              └─ Worker Session（用户选择的原生 preset）
                  └─ DSH 原生 Agent Loop
```

### 6.1 Main

每个 Workbench 创建一个逻辑唯一的 Main Session。`BayAgentHost` 在 `host-bay-agent.ts` 中注册独立的 `bay-agent` preset，避免把 Bay 的身份误认为 `standard` 或官方 `superagent`。该 preset 当前挂载：

- `@deepseek-ai/dsh-time-context`；
- `@deepseek-ai/dsh-compaction-basic`；
- `@deepseek-ai/dsh-command-compact`；
- `@deepseek-ai/dsh-compaction-tool-result-pruner`，配置为 `thresholdChars: 8192`、`headChars: 4096`、`tailChars: 1024`。

因此 Bay Main 已经具备原生自动压缩、context overflow recovery、`/compact` 和大工具结果裁剪。压缩写入 DSH Session 的 `compaction/*` 事件，不经过 Bay 编排账本。

Main 的 Bay 工具把工作台事实交给 `BayAgentController` 和 `WorkbenchControlPlane`。它只允许 Bay 写自己的 agent context 区段；人类目标、约束和授权仍走 Control Plane 的 ownership/CAS。

### 6.2 Worker

Native Worker Runtime 在 `host-bay-agent-worker.ts` 中：

1. 根据 Area 项目和 Work Item 的 `agentPreset` 解析目标 Session；
2. 同一 Work Item 有可用且空闲的原 Session 时优先复用；
3. 否则创建新 Session 并在先持久化 Assignment 映射后发送任务；
4. 通过 `bay_report` 接收 ready、blocked、failed、waiting 等报告；
5. 观察 Worker 状态，不因 Host 重启而重放已经可能被接受的 prompt；
6. 用 execution lease 检查 Area 项目版本、Session 和 Assignment，拒绝迟到回调。

Worker 继续使用用户选择的原生模式。当前内置 Standard、PTC、Minimal、Cordis 都自带 compaction 组合；Host 现在通过 preset registry 的 `compositionInventory()` 对自定义 preset 做只读能力检查，并把结果放进 `snapshot.agentModeCapabilities` 和 `bay_inspect`。这只提供事实和提示，不静默改写用户选择。

### 6.3 Bay 编排压缩与 Session 压缩的边界

当前有三种不同的“压缩”：

| 层次 | 负责对象 | 作用 | 持久化 |
| --- | --- | --- | --- |
| Native Session compaction | Main/Worker 对话历史 | 减少下一次模型请求的历史上下文，保留可恢复摘要和替换消息 | DSH Session Persistence，`compaction/start|summary|end` |
| Bay orchestration checkpoint | Work Item/Assignment/Attention 事件 | 压缩编排账本，保留 checkpoint 和最近事件 | Bay Host store，NDJSON + checkpoint |
| Workbench context/memory projection | 工作台和区域背景、记忆 | 限制 system prompt 投影范围，不修改 transcript | `.bay`/Host 服务的结构化数据和 Markdown 投影 |

第一种压缩已经接入 Bay Main；第二种属于 Bay 编排数据；第三种只是上下文投影预算。它们不能互相替代，也不能因为编排 checkpoint 存在就认为对话历史已压缩。

## 7. 对比结论与实施取舍

### 可以直接借鉴

1. **复用原生 Loop**：Bay 不应另写模型请求循环，继续用 `dsh-agent` 的 Inbox、`dsh-agent-loop` 的 step/turn 和 Session Persistence。
2. **把能力放在 preset**：Main 使用 Bay 专属 preset；Worker 保留用户选择的模式，并显式展示工具、压缩和 PTC 能力。
3. **压缩放在 pre-step**：所有长历史治理交给原生 compaction 事件；Bay 只负责自己的编排账本和工作台上下文预算。
4. **借鉴 Agent Team 的 CAS 任务板**：Area 和 Work Item 更新继续使用 expected revision，消息通过明确的 Session/Assignment 路由。
5. **借鉴 superagent 的 durable relay**：报告转发已经使用带 receipt、重试、去重和重启恢复的 queue；后续把同一 seam 扩展到外部 Runtime 的通用 effects。

### 不应直接照搬

- 不把官方 `superagent` 当作 Bay Agent 的产品身份；Bay 的 Workbench、Area、项目目录、记忆和包格式是自己的领域模型。
- 不让 Bay Main 直接拥有 Worker 的全部工具；Main 只调度和汇总，Worker 才在区域项目中执行。
- 不用编排 checkpoint 代替原生 Session transcript，也不把背景 Markdown 当成第二个可写事实来源。
- 不为了“确保压缩”强行覆盖用户选择的 Worker preset。应先做能力检查，再给出兼容选择。

## 8. 已实现与下一步

已实现并有定向测试：

- Bay Main 独立 preset；
- 原生 Session compaction、`/compact` 和工具结果裁剪注册；
- Worker preset 的只读能力摘要和持久报告 relay queue；
- Work Item、Assignment、Attention、Runtime envelope、NDJSON ledger 和编排 checkpoint；
- Worker Session 复用、报告、恢复观察和执行租约；
- Main/Worker 的 Workbench、Area、记忆和背景投影边界。

下一条建议按以下顺序推进：

1. 在 Bay 派发界面使用 `agentModeCapabilities` 提示缺少 compaction 的自定义 Worker，但不自动切换模式；
2. 把当前报告 relay queue 扩展为可插拔的 durable effects seam，覆盖外部 Runtime 的取消、重试和断线恢复；
3. 增加真实 Session 级长历史测试，分别验证 Main compaction、Worker compaction 和 Bay ledger checkpoint。

## 9. 参考源码

- 原生 Agent 公共 API：`node_modules/@deepseek-ai/dsh-agent/README.md`
- 原生 Loop：`node_modules/@deepseek-ai/dsh-agent-loop/README.md`
- 原生压缩：`node_modules/@deepseek-ai/dsh-compaction-basic/README.md`
- Standard/PTC/Minimal/Cordis preset：`node_modules/@deepseek-ai/dsh-web-app/presets/`
- Agent Team：`node_modules/@deepseek-ai/dsh-experimental-agent-team/README.md`
- superagent 架构：`dsh-superagent/docs/007-architecture.md`、`dsh-superagent/docs/003-execution.md`
- Bay Main：`packages/workbench-core/src/host-bay-agent.ts`
- Bay Worker：`packages/workbench-core/src/host-bay-agent-worker.ts`
- Bay 编排模型：`packages/workbench-core/src/foundation/workbench-bay-agent-work.ts`

## 10. 本轮验证更新

Worker preset 能力摘要已经接入 Bay 任务派发面板。面板会根据当前选中的模式显示压缩能力提示；切换到具备 compaction 的模式后提示立即消失，能力未知时只提示事实，不阻止创建任务，也不会替换用户选择。

新增真实 Session 级集成测试 `packages/workbench-core/tests/native-compaction.integration.spec.ts`：使用真实 Cordis 组合、Session Persistence、Agent Loop、Token Meter 和 BasicCompactionEngine，通过受控 LLM adapter 生成长历史，执行手动 compaction，验证 `compaction/start`、`compaction/summary`、替换消息和 `compaction/end` 持久化，然后关闭并恢复同一 Session，继续发送一轮消息。这个测试验证的是原生 Session 压缩和恢复，不等同于 Bay 编排账本 checkpoint。
