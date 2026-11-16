# 用户指南

## 准备环境

使用 Node.js `>=24.9.0`、pnpm `11.28.5` 和 DSH `>=0.2.2-rc.2 <0.2.3`。湾作为 DSH 插件运行，不能脱离兼容的 DSH Host 独立启动。

## 开发者本地验证

在仓库根目录安装依赖并检查来源、测试和构建：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:dsh-dependencies
pnpm check:compat
pnpm test
pnpm typecheck
pnpm build
```

构建出的 Core 包为 `packages/workbench-core`，包名是 `dsh-bay`。使用 `pnpm pack:core` 可以生成带候选元数据和摘要的本地 tarball；这条命令不会发布到 npm。

## 从模板开始

在兼容的 DSH 环境中安装湾后，从已有工作台或 Creator Skill 提供的模板开始。先完成一个真实任务，再调整布局、插件或 Skill。保存时说明用途和前置条件，避免把个人 Session 内容误当成可分享配置。

插件开发者应阅读 [Creator Skill](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/SKILL.md) 和 [扩展规范](../packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/WORKBENCH-CONTAINER-INNER-PAGE-EXTENSION-SPEC.zh.md)。

## 验收与分享

导出前检查工作台包预览、依赖、目标 DSH 版本以及可能无法迁移的内页状态。接收方导入后，应在自己的 DSH 环境中重新确认依赖与权限。局域网共享只适用于你控制并信任的网络环境。

不同 DSH 安装方式、权限配置和扩展组合可能造成差异。遇到问题时，请按 [SUPPORT.md](../SUPPORT.md) 提供脱敏后的版本和复现步骤。
