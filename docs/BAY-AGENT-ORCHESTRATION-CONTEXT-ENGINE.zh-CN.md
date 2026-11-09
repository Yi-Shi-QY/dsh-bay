# Bay Agent Orchestration Context Engine

状态：第一条实现切片已落地（与 alpha17.6 工作树同步）  
范围：Workbench 绑定的 Bay Agent 编排事件、当前投影、历史回查和重启恢复。

## 1. 背景

Bay Agent 是 Workbench 的持久控制平面。它负责理解 Workbench 与 Area 的背景，创建 Work Item，选择 Worker 模式，调度 Worker Session，把报告汇总到 Attention Queue，并在恢复时避免重复派发。

只有当前状态快照时，Bay Agent 能看到“现在是什么状态”，却无法回答“这个状态是如何形成的”。长会话压缩、Host 重启、Worker 中断和人类复核都会让上下文出现断点。因此需要一条只记录编排事实的事件账本，并从账本和当前状态构造有限的上下文投影。

## 2. 目标与边界

目标：

- 为 Work Item、Assignment、Worker 报告、Attention、上下文写入和恢复动作记录可审计事件。
- 提供稳定的当前投影，默认注入 Bay Agent 的系统上下文。
- 提供有界的 `bay_history` 回查，按 Work Item、Assignment、序号过滤。
- Host 重启后恢复事件序号、去重依据和当前投影。
- 兼容没有事件字段的旧 `version: 1` Bay Agent 状态文件。

边界：

- 事件账本不是 Workbench human Context，也不替代 Context 的 revision/CAS。
- 事件不能绕过 Control Plane 的 ownership、revision、idempotency 和 native approval。
- Session transcript、完整 prompt、凭据、绝对路径和运行时私有状态仍由原生 Session/Worker Runtime 保存。
- 本切片不负责模型摘要、跨 Workbench 全局账本、远程 Worker 的 HTTP 协议或 IM 接入。

## 3. 事件模型

事件类型由 `BayAgentOrchestrationEventKindV1` 固定。当前包括：

| 类型 | 触发点 |
| --- | --- |
| `work-item.created` | 创建 Work Item |
| `work-item.status` | Work Item 状态发生变化 |
| `work-item.accepted` | 人类或 Bay Agent 接受 ready 报告 |
| `work-item.recovered` | 对中断、阻塞或失败 Work Item 发起恢复 |
| `assignment.created` | Assignment 写入持久状态、准备派发 |
| `assignment.started` | Worker Runtime 报告开始 |
| `assignment.progress` | Worker 进度、原生输入状态变化 |
| `assignment.report` | Worker 报告 ready/waiting/blocked 等终态 |
| `assignment.failed` | Worker 派发或执行失败 |
| `assignment.interrupted` | Worker 中断或被停止 |
| `attention.opened` | Attention Queue 新增事项 |
| `attention.resolved` | Attention 得到回答或原生输入清除 |
| `attention.dismissed` | Attention 被忽略 |
| `context.patch.committed` | Bay Agent Context patch 成功 |
| `context.patch.conflicted` | Bay Agent Context patch 因 revision 冲突失败 |

事件字段：

```ts
interface BayAgentOrchestrationEventV1 {
  schemaVersion: 1
  eventId: string
  seq: number
  workbenchId: string
  kind: BayAgentOrchestrationEventKindV1
  createdAt: number
  source: 'bay-agent' | 'worker' | 'human' | 'runtime'
  idempotencyKey?: string
  payload: Record<string, unknown>
}
```

`seq` 只在一个 Workbench 内单调递增。`eventId` 用于引用，`idempotencyKey` 用于抵抗重复的 Runtime 回调。事件 payload 只存 ID、状态、字段名、短摘要和 revision 等协调事实；字符串和数组均有上限，并过滤凭据、transcript、路径等敏感字段。

## 4. 物化状态与账本

当前实现把事件数组和物化状态放在同一个 Host journal JSON 文件中，使用临时文件加原子 rename 作为 durability boundary：

```json
{
  "state": {
    "version": 1,
    "workItems": [],
    "assignments": [],
    "attention": [],
    "events": [],
    "nextEventSeq": 1
  },
  "relayed": []
}
```

`events` 和 `nextEventSeq` 是对旧 V1 状态的可选扩展。旧文件缺少它们时按空账本读取。保存时 Controller 同时写入状态和事件，避免“事件已经写入但当前投影没有写入”或反过来的分离状态。

事件数组是第一阶段的可读实现。账本达到规模上限或需要多进程追加时，再迁移到 `state.json + events.ndjson`；迁移必须保留 seq、eventId 和 idempotencyKey。

## 5. 当前投影

`BayAgentController.getOrchestrationProjection()` 返回固定的有限投影：

- 当前事件序号；
- 活跃 Work Item 的 ID、Area、目标和状态；
- 未结束 Assignment 的 Worker 运行状态和最近报告；
- open Attention；
- 最近报告、阻塞和决策摘要；
- 最近若干事件的有界摘要。

Bay Agent 的系统上下文默认注入投影，而不是完整事件账本。这样重启后的主会话可以立即知道当前编排状态，同时避免每一轮把全部历史和 Session transcript 塞进上下文。需要追溯因果时使用 `bay_history`。

## 6. `bay_history` 契约

工具参数：

```text
workItemId?: string
assignmentId?: string
afterSeq?: integer >= 0
limit?: integer, 1..100
```

返回：

```json
{
  "events": [/* 按 seq 升序、已过滤且有界 */],
  "currentEventSeq": 42
}
```

默认最多返回 50 条，最大 100 条。查询只返回当前 Workbench 的事件。`afterSeq` 是排他游标，便于恢复流程从上次已消费的位置继续读取。工具不会返回 Session transcript，也不会扩大 `bay_inspect` 为无限历史接口。

## 7. 写入顺序与去重

协调动作遵循：

```text
生成事件 → 更新物化状态 → 原子保存 state + events → 通知 UI
```

Assignment 创建事件先于 Runtime 派发，保证“保存映射后再派发”。Runtime 回调使用 Assignment 加事件内容生成幂等键；重复的 started/progress/report/failed/interrupted 回调不会增加第二条事件，也不会重复打开 Attention。

事件记录只是编排日志。Context 写入仍然经过 Control Plane 的 ownership 和 revision/CAS；提交或冲突结果被记录为事件，但事件本身不能修改 Context。

## 8. 重启恢复

Host 启动时读取 Workbench journal，恢复 Work Item、Assignment、Attention、事件数组和下一个事件序号。对仍有 Worker Session 的 Assignment 使用 Runtime 的 `observeAssignment`；没有可观察 Session 的中断 Assignment 会进入 needs_input 并打开恢复 Attention。恢复动作创建新的 Assignment，并记录 `work-item.recovered`，避免把旧 Runtime assignment 当成新的 Workbench 事实。

## 9. 测试验收标准

- 创建 Work Item、Assignment 和状态迁移都会留下对应事件。
- Worker progress 不制造 Attention；blocked/failed/waiting 才会按规则打开 Attention。
- 相同 Runtime 事件重复送达时事件数量不增加。
- `bay_history` 支持 Work Item/Assignment 过滤、`afterSeq` 和 limit 上限。
- 旧 V1 文件无 events 时能读取；写入新事件后仍能原子保存。
- 重启后 projection 的 currentEventSeq 和历史事件保持一致。
- 事件中不出现 transcript、凭据、绝对路径或完整 Session 内容。

## 10. NDJSON、checkpoint 与长历史压缩

当前 Host 持久化由三个同名文件组成：

```text
<session>.json              物化 Work Item / Assignment / Attention 状态
<session>.events.ndjson     一行一个编排事件
<session>.checkpoint.json   被压缩区间的摘要检查点
```

旧的 `version: 1` JSON journal 仍可读取。第一次保存时，状态 JSON 不再携带完整 `events` 数组，事件会迁移到 NDJSON；事件序号、`eventId` 和幂等键保持不变。写入采用临时文件加原子 rename，三个文件分别有大小上限。

事件超过 512 条时，Controller 保留最近 128 条，并创建 `BayAgentOrchestrationCheckpointV1`。检查点记录 `compactedThroughSeq`、压缩时间、事件类型计数和人类可读摘要。当前 projection 会返回检查点边界；`bay_history` 会同时返回 `checkpoint` 与 `historyCompactedThroughSeq`，不会把缺失的旧事件伪装成完整历史。

## 11. 外部 Worker Runtime 事件信封

正式 Runtime 对接使用：

```ts
interface BayAgentWorkerRuntimeEventEnvelopeV1 {
  schemaVersion: 1
  eventId: string
  emittedAt: number
  runtimeName: string
  runtimeAssignmentId: string
  event: BayAgentWorkerRuntimeEventV1
}
```

`eventId` 是跨进程幂等身份。Controller 校验信封内外的 Assignment ID 一致后，才把事件映射到 Bay Agent Assignment；信封重放不会产生第二条编排事件。Runtime 事件会在账本 payload 中保留信封事件 ID、运行时名称和发出时间。旧的裸事件订阅仍保留兼容路径，但外部 Adapter 优先使用 `subscribeEnvelope`。

信封和账本都只允许协调事实：摘要、状态、Work Item/Assignment 引用和有限的字段名。凭据、transcript、Session/Workspace 身份、本机路径和 Runtime 私有会话内容不会进入账本。

## 12. 工作台包中的编排历史

layout-only、online-reference 和 offline-embedded 包都可以包含 `orchestration.json`。它与 `workbench.json` 一起参与 manifest 文件清单、摘要和包身份校验；缺失、篡改或不一致会使包检查失败。

导出的内容是 `PortableBayAgentOrchestrationV1` 审计投影：事件 ID 使用包内稳定序号，Work Item、Assignment 和 Attention 使用脱离本机的引用，检查点不包含本机 Workbench ID。导入只恢复历史和检查点到新的 Workbench Record，不恢复本机 Bay Main Session、Worker Session、运行中的 Assignment、Attention 运行状态、Runtime Assignment ID、凭据或 transcript。导入后的 Bay Agent 需要在接收端重新建立本地运行时和新任务。

## 13. 当前验收状态

- NDJSON 拆分、旧 JSON journal 迁移、原子保存：已实现。
- compaction checkpoint、projection 边界和 `bay_history` 压缩提示：已实现。
- Runtime 正式事件信封、跨进程幂等和 V1 裸事件兼容：已实现。
- layout-only / V4 / portable package 的 `orchestration.json` 导出、完整性校验和导入恢复：已实现。
- 尚未把真实模型长时间自主编排当作自动化测试；实验包用于人工实测和运行中观察。

## 14. 后续切片

1. 为 projection 增加按 Workbench 设置的事件预算和上下文预算。
2. 增加检查点摘要的人工复核视图，明确区分原始事件、压缩摘要和当前物化状态。
3. 将真实外部 Worker Runtime 的取消、重试、断线重连和 outbox 恢复接入同一信封协议。
4. 让 Bay Agent 在成功 Work Item 后生成可审阅的 Playbook/Skill 草稿。

## 15. Bay Main 原生 Session 压缩边界

Bay Main 的 `bay-agent` preset 已显式挂载 `@deepseek-ai/dsh-compaction-basic`、`@deepseek-ai/dsh-command-compact` 和 `@deepseek-ai/dsh-compaction-tool-result-pruner`。因此 Main 具备自动压缩、context overflow recovery、`/compact` 和大工具结果裁剪；压缩事件由 DSH Session Persistence 保存为 `compaction/start`、`compaction/summary`、`compaction/end`。

这条链路与本文件描述的 Bay 编排账本压缩是独立的：Session compaction 影响模型请求历史；编排 checkpoint 只压缩 Work Item、Assignment、Attention 事件；Workbench context 和 memory projection 只控制工作台数据如何注入 system prompt。三者不能互相替代。

Worker 继续使用用户选择的原生 Agent preset。当前内置 Standard、PTC、Minimal、Cordis 都显式提供 compaction；自定义 preset 是否提供同样能力仍需在派发前做只读能力检查，不能因为 Bay 需要压缩而静默改写用户选择。

Worker 报告转发现在经过 Host store 内的持久 relay queue：队列记录 pending/sending/sent、尝试次数、下一次尝试时间和 30 秒发送租约。发送成功写入 receipt，失败按退避重试；Host 在发送租约过期后可以继续处理，重复消息仍由原生 Session 的 requestId 去重。该队列只负责 Bay Main 的报告投递，不替代外部 Runtime 的通用 effects/outbox。
