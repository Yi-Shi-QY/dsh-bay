# 湾 / DSH Bay

> 让 DSH 插件、Skill 和 Agent 从一次性配置，变成可以持续使用、验证、迭代和分享的工作台。

湾是面向 [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness) 的开源工作台。它把插件开发、Skill 创作、Agent 协作、项目上下文、验收记录和工作台分享放进同一条工作流：从模板起步，在真实任务中使用，边用边改，把有效做法固化成资产，最后交给 Bay Agent 辅助验收，再迁移或分享给自己和团队。

你可以把湾理解成 DSH 上的一层“可持续工作台”：它既给专业开发者保留插件、Skill、Agent 和布局的细节控制，也给刚接触 DSH 的人一个可以直接开始的起点。工作台不是一次性配置；它会随着真实使用逐步积累，直到成为一套可以复用和交接的方法。

## 它解决什么问题

DSH 提供了强大的插件、工具和 Agent 能力，但开发工具、运行配置、可复用资产、使用上下文和验证证据很容易分散在不同地方。结果是：第一次做出来的东西难以继续改进，成熟方案难以交给别人，后来者也很难知道应该从哪里开始。

湾把这段过程收拢起来，让一次尝试可以沉淀成工作台，让工作台里的改进可以变成插件、Skill、Agent 和布局资产，也让经过验证的方案更容易迁移、复用和分享。

## 适合谁

- **DSH 开发者和插件作者**：需要细致控制接口、兼容范围和来源证据，并把成熟做法整理成模板。
- **有真实任务但还不熟悉 DSH 的人**：从现成工作台或模板开始，在使用中逐步调整配置、积累资产，并获得清楚的验收反馈。
- **需要复用和协作的团队**：迁移经过整理的工作台，也可以在受控局域网中按房主、访客和权限边界共同使用。

这三类人走的是同一条路：先把事情做成，再把做法固化，最后让结果能够重复使用。熟悉 DSH 的人可以深入到底层细节；刚开始的人也不必先学完整套 DSH，先完成第一次有用的工作，再逐步掌握更多能力。

## 一条持续改进的工作流

1. 从空白或模板建立一个工作台。
2. 在项目、对话和任务中完成真实工作，记录需要改进的地方。
3. 用插件、Skill、Agent 和布局把改进固化成可复用资产。
4. 让 Bay Agent 检查结构、依赖、声明和验收结果。
5. 导出工作台，供自己迁移、团队复用或在受控局域网中使用。

例如，你可以先用一个模板处理一类重复任务；使用几次后，把缺少的工具、固定流程和验收标准补进工作台；稳定下来之后，再把这套工作台交给同事，或者继续做成更专业的插件和 Skill。

## v0.1 Beta 提供什么

- 多区域工作台，以及可持续保存的项目、会话、任务和布局。
- Creator Skill 和插件模板，帮助用户从可运行的起点开始开发。
- Bay Agent 的工作项、Assignment、Agent 组装和验收辅助流程。
- DSH 版本、依赖、上游来源和制品完整性检查。
- 布局包和完整工作台包，用于迁移项目资料、历史和可携带状态。
- 浏览器工作台和受控局域网分享的基础能力。

## 当前边界

公开 Beta 版本为 `v0.1.0-beta.1`，Core 包为 `dsh-bay@0.1.0-beta.1`，兼容 DSH `>=0.2.2-rc.2 <0.2.3`。湾运行在 DSH 提供的 Host、Agent、工具和插件管理能力之上，不替代 DSH 本身。

v0.1 不承诺兼容所有 DSH 版本、所有第三方插件、跨代数据无损迁移、公开互联网协作或所有模型服务的稳定性。局域网分享属于受控公测能力；分享包也不会携带凭据、完整 Session transcript、本机绝对路径或 Host 控制权限。

## 开始试用

要求：Node.js `>=24.9.0`、pnpm `11.28.5` 和兼容的 DSH Host。在仓库根目录执行：

    pnpm install --frozen-lockfile --ignore-scripts
    pnpm verify
    pnpm pack:core

生成的 Core 制品位于 `releases/0.1.0-beta.1/`。请在隔离的 DSH Profile 中，通过 DSH 原生 Plugin Manager 安装对应的 `.tgz` 文件，再按[用户指南](docs/USER-GUIDE.zh-CN.md)完成第一次工作台、模板和分享练习。

如果你只想先了解产品，可以从[项目手册](docs/PROJECT-HANDBOOK.zh-CN.md)开始；如果要开发扩展，请阅读 [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md)。

## 文档入口

- [项目手册](docs/PROJECT-HANDBOOK.zh-CN.md)：产品定位、目标用户和核心工作流。
- [用户指南](docs/USER-GUIDE.zh-CN.md)：安装、创建工作台、开发资产和分享迁移。
- [产品方向](docs/PRODUCT-DIRECTION.zh-CN.md)：v0.1 范围、公测学习目标和后续方向。
- [架构说明](docs/ARCHITECTURE.zh-CN.md)：代码分层、DSH 接入和来源管理。
- [Creator Skill](packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md)：扩展开发规范和模板。
- [验证记录](docs/VALIDATION-v0.1.zh-CN.md)：自动化证据、制品摘要和仍需人工验证的项目。

使用前请阅读[支持说明](SUPPORT.md)；发现安全问题请按[安全策略](SECURITY.md)使用私密渠道报告。湾以 MIT License 发布。

English version: [README.md](README.md)。
