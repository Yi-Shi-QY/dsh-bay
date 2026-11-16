# 架构说明

## 代码分层

仓库采用 pnpm workspace。`packages/workbench-core` 是当前公开的 Core 插件包，包含工作台状态与布局、插件分发、包格式、Agent 接入和 Host/Client 入口。根目录脚本负责构建、类型检查、测试、来源校验和打包。

## DSH 集成

湾通过 DSH 的公开插件、服务、模块和 UI 接口接入 Host。`packages/workbench-core/package.json` 声明 Core 的 DSH peer 兼容范围；根依赖锁定 DSH RC2 用于构建和测试。`tools/dsh-adaptation/` 对源代码中实际使用的 DSH 包进行清点，避免遗漏直接依赖。

## 上游来源与适配

`packages/workbench-core/src/foundation/workbench-sidebar/generated/upstream/rc2-source/` 保存 RC2 Sidebar 和 Workspace 的来源镜像。来源索引记录每个文件的摘要；`workbench-sidebar.copy-manifest.json` 记录适配文件、额外文件和差异摘要。渲染器来源与 Area 级适配记录在 `src/foundation/renderer/provenance.json`。

来源镜像与运行时代码分开保存，便于检查上游内容是否被无意修改。更新 DSH 代际时应重新取得来源、审阅变化并更新索引和适配记录。

## 运行时边界

- Host 侧负责本地持久化、文件系统、权限判断、插件安装和协作会话管理。
- Client 侧负责工作台 UI、交互和 DSH 客户端服务调用。
- 可移植包只保存经过白名单与校验的布局和状态，不包含运行中的 Session transcript、凭据或任意 Host 命令。
- 局域网协作依赖 Host 的访问控制和会话管理；网络可达不等于自动获得文件或插件权限。

## 验证入口

运行 `pnpm check:dsh-dependencies` 检查 DSH 依赖清单，运行 `pnpm check:compat` 检查版本、来源镜像和适配摘要。完整开发检查见根目录 README。
