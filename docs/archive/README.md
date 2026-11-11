# 历史文档归档

本目录保存被当前模型替代的方案、阶段审计、研究与验证快照。归档是保留设计演进，不表示每项计划都完成，也不表示历史问题仍未修复。

当前入口：[文档导航](../README.md) · [当前架构](../ARCHITECTURE.zh-CN.md) · [最新验证](../VALIDATION.md)。

## 2026-11-11 整理批次

下列 15 份文档保留原记录内容，仅补充归档说明、修正相对链接和明显的控制字符。日期目录表示归档时间，原文写作日期保留在正文。当前页面重写前的版本也保存为快照。

| 归档文档 | 归档原因 | 当前替代或阅读入口 |
| --- | --- | --- |
| [区域项目绑定提案](2026-11-11/AREA-PROJECT-BINDING-PROPOSAL.zh-CN.md) | 早期区域/项目绑定讨论 | [项目归属](../V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) |
| [大版本控制平面草案](2026-11-11/NEXT-MAJOR-WORKBENCH-CONTROL-PLANE-DRAFT.zh-CN.md) | 混合未确认方向与旧模型，不再作为实施总入口 | [产品方向](../PRODUCT-DIRECTION.zh-CN.md)、[架构](../ARCHITECTURE.zh-CN.md) |
| [18.0 原始重构计划](2026-11-11/V18-REFACTOR-PLAN.zh-CN.md) | 共享目录独立区域背景等规则已被替代 | [架构](../ARCHITECTURE.zh-CN.md) |
| [目录架构讨论稿](2026-11-11/V18-WORKBENCH-DIRECTORY-ARCHITECTURE.zh-CN.md) | 讨论选项和旧数据兼容不再是当前要求 | [项目归属](../V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) |
| [区域/会话解耦审计](2026-11-11/V18-AREA-SESSION-DECOUPLING-AUDIT.zh-CN.md) | 保留旧问题及修复证据，持久区域规则已失效 | [项目归属](../V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) |
| [浏览器与 LAN 原始计划](2026-11-11/V18-BROWSER-LAN-REFACTOR-PLAN.zh-CN.md) | 多阶段实现和角色策略混排，单独整理现状 | [浏览器说明](../BROWSER-WORKBENCH.zh-CN.md) |
| [项目归属设计/实施原稿](2026-11-11/V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) | 原稿首尾实施状态矛盾，保留设计与审计 | [现行归属说明](../V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) |
| [总览设计与阶段交付](2026-11-11/V18-OVERVIEW-DESIGN.zh-CN.md) | 旧关闭区域规则、历史包摘要和后续更新混排 | [总览现状](../V18-OVERVIEW-DESIGN.zh-CN.md) |
| [Agent 上下文引擎原稿](2026-11-11/BAY-AGENT-ORCHESTRATION-CONTEXT-ENGINE.zh-CN.md) | JSON journal 初稿与后续 NDJSON/压缩实现混排 | [Agent 现状](../BAY-AGENT-ORCHESTRATION-CONTEXT-ENGINE.zh-CN.md) |
| [原生 Agent 模式对比](2026-11-11/BAY-AGENT-NATIVE-MODES-COMPARISON.zh-CN.md) | 固定时点研究，含本地独立 superagent 参考 | [Agent 现状](../BAY-AGENT-ORCHESTRATION-CONTEXT-ENGINE.zh-CN.md) |
| [标签状态设计](2026-11-11/UI-TAB-STATUS-DESIGN.zh-CN.md) | 17.6 分批设计；未实施部分不自动成为 18.0 承诺 | [内页菜单](../V18-INNER-PAGE-MENU.zh-CN.md)、[验证](../VALIDATION.md) |
| [生态参考](2026-11-11/ECOSYSTEM-REFERENCE.md) | 2026-11-04 外部生态研究快照 | [产品方向](../PRODUCT-DIRECTION.zh-CN.md) |
| [仓库改名记录](2026-11-11/REPOSITORY-RENAME.md) | 已完成的品牌与包名历史 | [主说明](../../README.md) |
| [17.5 验证记录](2026-11-11/VALIDATION.md) | 旧候选版本、测试数及摘要 | [最新验证](../VALIDATION.md) |
| [2026-11-07 发布准备记录](2026-11-11/RELEASE-READINESS-2026-11-07.zh-CN.md) | 本地旧阶段材料，保留而不充当当前发布结果 | [封包与发布](../PUBLISHING.zh-CN.md) |

## 使用历史材料

历史文档中的“当前”“未提交”“下一阶段”均指原记录时点。阅读源码行号、外部地址、本机临时预览或未跟踪研究目录时需重新核对；归档不保证它们现在仍存在。

相对链接已按归档位置调整，原计划之间的引用尽量保持在同一批次；每份归档开头提供现行入口。历史版本号、测试数、包摘要和来源记录不为了看起来一致而改写。
