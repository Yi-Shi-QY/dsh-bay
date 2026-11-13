# DSH Bay 仓库结构与源码导航

更新日期：2026-11-13。当前私有候选为 `0.2.2-alpha.18.3` / DSH `0.2.2-rc.2`。这里记录源码结构和适配证据入口，不是待实施的目录重构方案。

```text
dsh-bay/
├─ packages/workbench-core/       唯一交付包 dsh-bay
│  ├─ src/
│  │  ├─ index.ts                Host 插件入口
│  │  ├─ client/                 客户端入口、原生集成与浏览器适配
│  │  ├─ foundation/             UI、布局、模型、控制器和上游适配
│  │  └─ host-*.ts / *-contract.ts 宿主服务与跨端协议
│  ├─ tests/                     单元、组件和跨服务测试
│  ├─ presets/workbench-creator/ 原生创造模式使用的开发技能与模板
│  ├─ lib/                       构建与声明输出，Git 忽略；白名单部分进入安装包
│  └─ package.json               导出、DSH 元数据及发布 files 白名单
├─ scripts/                      检查、测试、构建、封包与专项浏览器验证
├─ docs/                         当前说明；archive/ 保存历史文档
├─ compat/                       DSH RC1 / RC2 兼容记录
├─ provenance/                   来源审计快照
├─ releases/                     历史候选记录及本地产物
└─ .github/workflows/quality.yml Ubuntu 自动检查
```

## 按功能定位

以下路径相对 `packages/workbench-core/src/`。

| 功能 | 主要文件 |
| --- | --- |
| 目录、项目与注册 | `host-workbench-directory-service.ts`、`host-workbench-directory.ts`、`host-workbench-projects.ts`、`workbench-directory-contract.ts` |
| 定义和布局投影 | `foundation/persistence.ts`、`foundation/document-v3.ts`、`foundation/project-identity.ts`、`client/file-workbench-settings.ts` |
| 创建和总览 | `foundation/WorkbenchCreateDialog.tsx`、`foundation/WorkbenchOverviewDetail.tsx`、`foundation/WorkbenchHomePreview.tsx` |
| 项目概览 | `foundation/WorkbenchProjectOverview.tsx`；背景和记忆由目录服务与 `host-workbench-memory.ts` 处理 |
| 画布、浮动和内页 | `foundation/WorkbenchFrame.tsx`、`foundation/WorkbenchFloatingWorkspace.tsx`、`foundation/WorkbenchEditorPicker.tsx` |
| Bay Main / Worker | `host-bay-agent.ts`、`host-bay-agent-worker.ts`、`host-bay-agent-store.ts`、`foundation/workbench-bay-agent-work.ts` |
| 浏览器交接 | `host-browser-window-controller.ts`、`host-workbench-owner-gateway.ts`、`client/browser-window-controller.ts`、`workbench-reclaim.ts` |
| 在线协作 | `host-workbench-access.ts`、`host-workbench-native-access.ts`、`host-workbench-share-*.ts` |
| 完整包 V5 | `host-workbench-complete.ts`、`host-workbench-complete-files.ts`、`host-native-session-portability.ts`、`host-workbench-task-snapshot.ts` |
| 导入 UI | `foundation/WorkbenchSharingPage.tsx`、`foundation/WorkbenchImportFlow.tsx`、`foundation/WorkbenchCompletePackagePanel.tsx`、`foundation/WorkbenchCompleteJob.tsx` |
| 扩展发现与安装接缝 | `client/workbench-extension-registry.ts`、`client/read-dsh-extension-inventory.ts`、`host-distribution-*.ts` |

## 构建与交付目录

`node_modules/`、`lib/`、`tmp/`、`output/`、`prototypes/` 和临时日志不是源码提交。`lib/index.js`、`lib/client.js`、声明及构建输入是安装包的必要内容，按 package.json 白名单进入包；“Git 忽略 lib”不等于“不打包 lib”。

`releases/alpha18.3-rc2-private/` 默认被忽略，每次 `pack:core` 更新同名制品和 `candidate.json`。历史 17.5/17.6 的部分记录仍被跟踪，不代表当前版本。本地未跟踪 `dsh-superagent/` 只作独立研究材料，不是 Core 的依赖或交付输入。

`presets/workbench-creator/` 的历史自定义 preset 不再作为运行时安装；发布白名单保留其中的技能、规范和模板，DSH 的 `cordis` 模式负责实际创造模式执行。

## 文档与来源边界

从[文档导航](README.md)进入当前说明，从[归档索引](archive/README.md)查阅旧讨论。包内扩展技能使用相邻规范，不依赖仓库根的 docs 目录。

兼容 manifest、上游 source index 和 provenance 各自保留记录时点的证据。当前制品由 `candidate.json` 和包内 `lib/build-inputs.json` 确认；不要通过修改旧来源记录“同步”新版本。

## 目录优化尚待讨论

目前 `foundation` 同时承载界面、领域与适配职责，根层 Host 服务也较集中。下一轮可以按目录/项目、会话与内页、Agent、在线访问、完整包划分模块边界；需要先列依赖和公共契约，再移动代码。此次只整理文档，没有移动运行时代码或改变构建入口。
