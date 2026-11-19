# 用户指南

## 准备环境

湾 v0.1.2 的 Core 包声明兼容 DSH `>=0.2.2-rc.3 <0.2.3`，本次使用 `0.2.2-rc.3` 验证。在 DSH 的原生插件管理器中安装 `.tgz`。湾作为 DSH 插件运行，不能独立启动。

## 开发者本地验证

从源码构建需要 Node.js `>=24.9.0` 和 pnpm `11.28.5`。在仓库根目录安装依赖并检查来源、测试和构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:dsh-dependencies
pnpm check:compat
pnpm test
pnpm typecheck
pnpm build
```

构建出的 Core 包为 `packages/workbench-core`，包名是 `dsh-bay`。使用 `pnpm pack:core` 可以生成带候选元数据和摘要的本地 tarball；这条命令不会发布到 npm。

## 切换语言

在 DSH 的 **设置 → 通用设置 → 语言** 中选择中文或 English。湾跟随 DSH 的语言设置，无需安装单独的英文版。项目与会话名称、文件路径、用户输入和第三方扩展提供的内容不会被翻译。

## 创建第一次对话

1. 在工作台空区域点「设置项目」，新建或选择项目。不需要对话的内页也可以先添加。
2. 项目还没有对话时，点空区域优先显示的「新建对话」。
3. 当前项目会自动选中。选择 Agent 模式并发送第一条消息。

## 从模板开始

在兼容的 DSH 环境中安装湾后，从已有工作台或 Creator Skill 提供的模板开始。先完成一个真实任务，再调整布局、插件或 Skill。保存时说明用途和前置条件，避免把个人 Session 内容误当成可分享配置。

插件开发者应阅读 [Creator Skill](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md) 和 [扩展规范](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md)。

## 验收与分享

复用工作台结构时选模板包；需要迁移项目文件和支持的对话历史时选完整包。两种包都使用 `.dshbay.zip`。导出前检查依赖及要分享的数据；接收方导入时确认兼容性和扩展权限。旧版布局包和对话归档包不能通过当前分享页恢复。详见[工作台包格式](WORKBENCH-PACKAGES.md)。局域网共享只适用于你控制并信任的网络环境。

不同 DSH 安装方式、权限配置和扩展组合可能造成差异。遇到问题时，请按 [SUPPORT.md](../SUPPORT.md) 提供脱敏后的版本和复现步骤。
