# DSH Bay 文档导航

整理日期：2026-11-11（Asia/Shanghai）。当前候选 `0.2.2-alpha.18.1`，宿主 DSH `0.2.2-rc.1`；源码包含当前工作树改动。本文是项目文档的统一入口。

## 先了解，再上手

- [项目手册](PROJECT-HANDBOOK.zh-CN.md)：项目定位、目标用户、成功标准、当前功能与长期开发计划。
- [使用教程](USER-GUIDE.zh-CN.md)：安装、新建、项目/会话、Bay Agent、扩展、浏览器/LAN、完整包和常见问题。
- 阅读顺序：初次了解先看项目手册；准备安装使用时看教程；参与开发再看架构、源码导航与专题契约。

## 当前使用与设计

| 文档 | 内容与用途 |
| --- | --- |
| [产品方向摘要](PRODUCT-DIRECTION.zh-CN.md) | 当前产品范围及项目手册入口 |
| [当前架构](ARCHITECTURE.zh-CN.md) | 数据来源、领域对象、宿主服务和包格式 |
| [项目与区域归属](V18-PROJECT-AREA-OWNERSHIP.zh-CN.md) | 项目持久化、区域关闭、重新关联、背景与记忆 |
| [工作台总览与原版侧栏](V18-OVERVIEW-DESIGN.zh-CN.md) | 列表与详情、项目概览、侧栏固定、浏览器管理入口 |
| [创建与分享迁移](V18-SHARING-PAGE-DESIGN.zh-CN.md) | 创建表单、完整包四阶段导入、错误与恢复 |
| [完整工作台 V6](COMPLETE-WORKBENCH-V6.zh-CN.md) | 目标系统预检、扩展锁、两阶段导入、V5 续跑与验证边界 |
| [浏览器与局域网](BROWSER-WORKBENCH.zh-CN.md) | 主控交接、页面关闭恢复、在线协作和验收边界 |
| [Bay Agent 与上下文](BAY-AGENT-ORCHESTRATION-CONTEXT-ENGINE.zh-CN.md) | Main / Worker、模式发现、原生压缩、事件账本和报告队列 |
| [内页菜单分类](V18-INNER-PAGE-MENU.zh-CN.md) | 官方分类、扩展文件夹和偏好保存 |
| [创造模式修复入口](V18-CREATOR-REPAIR-FLOW.zh-CN.md) | 不兼容插件的修复项目、浮动会话与草稿 |

## 开发与交付

| 文档 | 内容与用途 |
| --- | --- |
| [贡献说明](../CONTRIBUTING.md) | 变更边界与按影响选择验证 |
| [仓库结构](REPOSITORY-STRUCTURE.md) | 真实源码目录、服务入口与定位方法 |
| [扩展开发技能](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md) | 原生创造模式使用的开发流程 |
| [扩展技术规范](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md) | Slot、绑定、状态、生命周期、离线制品契约 |
| [验证记录](VALIDATION.md) | 最新已验证提交、制品摘要、通过项和未验证项 |
| [封包与发布](PUBLISHING.zh-CN.md) | 私有封包、检查命令与公开发布门槛 |
| [变更记录](../CHANGELOG.md) | 版本级功能变化 |
| [历史归档](archive/README.md) | 被替代的计划、旧审计和阶段验收原文 |

## 文档的维护规则

1. 当前行为以代码和可重复验证为证据；计划描述目标，不能自动作为已完成能力。
2. 更新功能说明时写清基线和验证范围。最新测试总数与制品摘要统一维护在 `VALIDATION.md`，专题里的旧测试数字注明对应阶段。
3. 新决定替代旧模型时更新当前文档，将旧讨论归档并添加替代入口。归档保留当时的结论，不作为新实现的默认要求。
4. 归档日期表示整理时间，不冒充原文写作时间。历史文档中的“当前”“待实现”“未提交”等只指原记录时点。
5. 仓库内链接使用相对路径；随插件打包的文档必须能在包内解析，不能依赖安装包外的仓库文档。
6. 文档更新本身不重新验证真实模型、用户 Profile、跨设备或跨平台流程，也不改变已交付安装包的内容与摘要。
