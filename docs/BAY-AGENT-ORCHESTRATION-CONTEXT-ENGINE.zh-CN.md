# Bay Agent：执行、上下文与持久化

更新日期：2026-11-11。当前功能基线 `ab2a7d8`。本文替代混合初始 JSON journal 方案与后续 NDJSON 实现的旧说明；[旧设计与阶段证据](archive/2026-11-11/BAY-AGENT-ORCHESTRATION-CONTEXT-ENGINE.zh-CN.md)和[原生模式比较](archive/2026-11-11/BAY-AGENT-NATIVE-MODES-COMPARISON.zh-CN.md)保留在归档。

## Main、Worker 与 Agent Loop

每个工作台有一个持久 Main 逻辑会话，项目目录为工作台根目录。Bay Main 的 preset ID 为 `bay-agent`，通过 DSH 原生 Agent Loop、Session Persistence、模型和工具服务运行；Bay 的 Controller 管理任务调度，不另写一套模型推理循环。

Main 默认不显示在浮动工作区，通过顶栏按钮显示/收回。收回只改变标签可见性，不删除 Main，不结束后台任务，也不应连带关闭整个浮动工作区。

Worker 使用选定的原生 preset。`bay_dispatch` 未提供 `agentPreset` 时只返回当前可用模式的 ID、名称和介绍，排除 `bay-agent` 及 broken 项，不创建 Work Item、Assignment 或 Session。Main 根据任务和实时介绍选择后再次调用；用户明确指定时使用指定 ID，并在不可用时报告或重新选择，不静默默认 standard。

系统提示词、工具注册和实时模式发现位于 [host-bay-agent.ts](../packages/workbench-core/src/host-bay-agent.ts)。模式能力摘要根据当前组合中的启用模块计算，未知能力不等于已经支持。

## 任务与项目归属

Work Item 表示持续任务，Assignment 表示一次执行。Session、任务与 Attention 保存项目归属；区域 ID 仅定位当前视图或保留来源。继续任务明确使用 workItemId，优先复用原 Session，必要时先在新区域展示项目。

派发和回调校验任务、Assignment、运行身份、会话与项目目录版本；不能让旧执行回调写入后来换绑的项目。报告到达后 Main 评审 ready 状态，Attention 保存需要人工判断或恢复的事项。

Worker 运行适配位于 [host-bay-agent-worker.ts](../packages/workbench-core/src/host-bay-agent-worker.ts)，状态机与事件契约位于 [workbench-bay-agent-work.ts](../packages/workbench-core/src/foundation/workbench-bay-agent-work.ts)。

## 三种不同的上下文处理

| 机制 | 当前职责 |
| --- | --- |
| 原生 Session compaction | Main 显式挂载 basic compaction、`/compact`、tool-result-pruner；处理模型历史和工具结果 |
| Bay 编排 checkpoint | 事件超过 512 条时保留最近 128 条并记录压缩边界、计数与摘要 |
| 背景与记忆投影 | 按工作台/项目提供当前目标、约束、记忆及有限任务摘要，按需读取正文 |

三者不能互相替代。背景不是原始聊天历史，checkpoint 也不表示原生会话已压缩。Worker 继承其 preset 的能力，Bay 不为增加压缩而静默更换模式。受控原生 Session 压缩与恢复集成测试见 [native-compaction.integration.spec.ts](../packages/workbench-core/tests/native-compaction.integration.spec.ts)。

背景辅助生成是独立单轮服务，不进入 Main Agent Loop。Main 可更新允许的 Agent 区，不自动覆盖人类目标和授权。项目关闭视图后，其会话背景仍来自自身 projectId。

## 编排存储与事实边界

[host-bay-agent-store.ts](../packages/workbench-core/src/host-bay-agent-store.ts) 在本机 Profile 的 `.dsh-workbench/bay-agent/` 保存：

```text
<派生身份>.json              任务、执行、Attention、报告投递队列和 receipts
<派生身份>.events.ndjson     当前保留的编排事件
<派生身份>.checkpoint.json   已压缩区间摘要与边界
```

事件使用递增 seq、eventId 和幂等信息，记录有限的协调事实。`bay_history` 按任务/执行和 afterSeq 查询有界事件，同时返回 checkpoint 与历史压缩边界，不能把已压缩部分描述成完整原文。

当前存储读取并重写受限大小的文件，单个 snapshot/NDJSON 上限为 8 MiB，checkpoint 上限为 128 KiB。每个文件使用临时写入和原子替换，三个文件依次提交，**尚不是跨文件原子事务，也不是流式无限追加账本**。这属于后续持久化与性能审计的真实边界，文档不把最初的事务目标写成已有保证。

外部 Runtime 可通过版本化事件信封报告运行信息，Controller 校验身份并去重。已存在适配契约不表示任意外部 Runtime 的取消、断线和跨机迁移都已实测。

## Worker 报告投递

Host 的持久 relay queue 保存 pending/sending/sent、重试次数、下一次发送时间和 30 秒发送租约。发送成功记录 receipt；失败退避重试，重启后可处理过期租约。原生 requestId 用于重复消息去重。

这条队列负责向 Main 投递 Worker 报告，不替代外部 Runtime 的通用 effects/outbox，也不意味着进程中断后任意外部副作用可撤销。

## 完整包与恢复

V5 完整包保存任务快照、保留事件和 checkpoint，并通过原生会话迁移适配器恢复 Main、普通/Worker 历史及附件。导入保留来源信息、重建本机映射，任务等待用户继续；继续时采用新的执行身份。

旧布局/扩展分发格式中的 `orchestration.json` 只是可迁移审计投影，不能替代 V5 的原生会话和可恢复任务快照。只复制根目录也不能搬走 Profile 中的全部活动记录。

## 验证与待办

任务恢复、重复/迟到事件、报告队列、checkpoint、受控原生压缩和完整包路径有自动化覆盖，最新总数见[验证记录](VALIDATION.md)。真实模型连续 8 小时、重启续跑、跨机继续和外部 Runtime 全链路仍待验收。跨文件提交一致性、日志读取成本及大规模上下文预算属于后续测量与设计事项。
