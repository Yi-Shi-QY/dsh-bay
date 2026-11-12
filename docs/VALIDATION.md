# DSH Bay 18.1 验证与制品记录

更新日期：2026-11-12（Asia/Shanghai）。本页是当前验证入口；旧 [17.5 记录](archive/2026-11-11/VALIDATION.md) 已归档。源码阶段提交与此前封包分别记录；以下制品摘要不能用于校验本次源码构建。

## 2026-11-12 源码阶段提交

本次保存 18.1 浏览器单工作台修复、完整工作台 V6 包及 LAN shared-control 的现有开发成果。用户已反馈浏览器单工作台实测没有发现问题；这不代表 LAN 多端共享已验收。此次仅提交源码，没有重新封包或发布。

提交前已确认 Host/Client 类型检查、RC1 兼容检查、构建，以及 5 个协作相关测试文件的 50 项测试通过。完整回归运行了 166 个文件、1095 项测试，其中 165 个文件、1094 项通过，1 项失败：`host-workbench-collaboration.spec.ts` 中的活动日志恢复与命令幂等测试在清理临时目录时出现 `ENOTEMPTY`。活动日志异步写入与测试清理的时序仍需排查，本次不宣称完整回归全部通过。

共享功能下一步先打通房主与 LAN 参与者的同一协作会话：当前客户端从页面标记创建协作连接，而浏览器主控的生产入口未传入协作管理器，桌面房主也没有完整接入协作通道。随后验证双向布局/内页操作、原生消息执行、共享草稿并发、刷新身份与断线恢复。单工作台浏览器功能继续作为回归门槛。

## 此前封包记录

## 当前候选

| 字段 | 值 |
| --- | --- |
| 源码 HEAD | `e3ec6d02eef3d6fca65b7858a9b9fe0240ec383c`，包含未提交工作树改动 |
| 包 / 版本 | `dsh-bay` / `0.2.2-alpha.18.1` |
| DSH 代际 | `0.2.2-rc.1` |
| 候选 ID | `dsh-bay-0.2.2-alpha.18.1-dsh-0.2.2-rc.1` |
| 状态 | 私有实验包；自动化门槛通过，安装后验收待试用 |
| 默认制品位置 | `releases/alpha18.1-rc1-private/dsh-bay-0.2.2-alpha.18.1.tgz` |
| 大小 | 1,347,078 字节 |
| SHA-256 | `1db6e0340955e7f4c92852b5ecddd8d22e6da4cc5e899d683b5b8b2dae9f428e` |
| SHA-512 integrity | `sha512-bU288dajRQfEwrbirePW/gkXdBRt1Ska7Qkqsan/fawhhxY20SLKOHif4exorGLApMBwONtp2mJkk2mv8BYoOg==` |

包内 `package.json`、`lib/build-inputs.json` 和 `candidate.json` 的版本、候选 ID、DSH 代际及上游提交一致。归档包含 331 个白名单文件；Host/Client 构建输入分别为 230 / 276 项。独立重算归档 SHA-256 与候选记录一致。

## 18.1 已通过的检查

| 检查 | 结果 |
| --- | --- |
| RC1 候选身份与锁定来源 | `pnpm check:rc1` 通过；来源摘要和 lockfile digest 匹配 |
| 完整自动回归 | 165 个测试文件、1066 项测试通过 |
| Host / Client 类型检查 | `pnpm typecheck` 通过 |
| 工作台包专项检查 | `pnpm verify:workbench-package` 通过 |
| 运行时构建 | `pnpm build` 通过 |
| 私有封包 | `pnpm pack:core` 通过；归档包版本、候选身份和构建输入一致 |

18.1 封包包含本页记录的 HEAD 及未提交工作树改动，不代表该源码已经提交。上一候选 18.0 的摘要和测试记录保留在下方，不作为 18.1 制品校验值。

## 上一候选 18.0 制品记录

| 字段 | 值 |
| --- | --- |
| 源码提交 | `ab2a7d80b35f8ac9c4cdf37664bd7f4e385847bb` |
| 提交说明 | `feat: refine workbench creation and complete package import` |
| 包 / 版本 | `dsh-bay` / `0.2.2-alpha.18.0` |
| DSH 代际 | `0.2.2-rc.1` |
| 上游提交 | `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` |
| 候选 ID | `dsh-bay-0.2.2-alpha.18.0-dsh-0.2.2-rc.1` |
| 状态 | 私有实验包 `private-staging` |
| 默认制品位置 | `releases/alpha18.0-rc1-private/dsh-bay-0.2.2-alpha.18.0.tgz` |
| 大小 | 1,325,863 字节 |
| SHA-256 | `410b4994ecbe36c9fbf644ea6b2c14b7fc3a3fb119843062677a6041c5dd5715` |

SHA-512 integrity：

```text
sha512-5K0MEyMTev4iSu9CV0bHc2dbUbmH37kte08gf0yDvRoZPaSiDUKyWEDmviPsTN8LhG6EtLWj1r5Z+/qLoo1mMQ==
```

上述摘要只对应这一次已交付归档。默认输出目录会被后续同版本封包覆盖，候选 ID 也不是每次构建唯一值；区分同版本制品必须保留源码提交与归档摘要。该目录不随 Git 克隆提供。本次文档更新包含包内 README 和技能链接修订，没有重新封包，不能把旧摘要当作更新后的文档制品摘要。

## 18.0 已通过的检查

| 检查 | 证据范围 |
| --- | --- |
| 完整自动回归 | 162 个测试文件、1048 项测试通过 |
| Host / Client 类型检查 | 通过；封包再次清理生成目录并重建声明 |
| RC1 兼容检查 | 包版本、依赖代际、上游身份及锁定记录通过 |
| 构建与私有封包 | `pnpm build`、`pnpm pack:core` 通过 |
| 归档检查 | 326 个文件符合发布白名单，运行时与构建输出一致 |
| 构建来源 | 501 条客户端/Host 输入摘要与源码一致 |
| 制品摘要 | 文件大小、SHA-256、SHA-512 与候选元数据一致 |
| 创建/导入界面 | 真实组件、DSH 主题与图标，模拟 Host 响应；Edge 检查浅深色和 1280×900 / 390×844，无相关脚本错误或横向溢出 |
| Host 流程回归 | 临时文件系统覆盖创建失败重试、目录冲突、上传复用、导入目标重选、作业身份与结果恢复 |

本地 `candidate.json` 记录包身份与摘要；`package-verification.json` 是本次额外归档校验报告，记录源提交、文件数与构建输入检查。后者不是 `pack:core` 自动保证生成的固定输出，后续封包须重新核对其适用范围。

## 仍待实际验收

- 本次创建到 Main、导入到打开工作台的安装后完整 DSH 链路。
- 原版模式与工作台往返、浏览器接管/关闭/交还后的真实输入和模型发送。
- 真实大包的资源占用、磁盘失败、中断恢复及完整附件/继承历史实机验收。
- Windows、macOS、Linux 来源/目标九种迁移组合；Firefox、Safari 与另一台局域网设备。
- 至少连续 8 小时真实模型编排、宿主重启和另一机器续跑。
- 第三方扩展、外部 Runtime 的完整迁移与执行范围传递逐项验收。

已有专题中的受控原生 Session 集成测试和浏览器生命周期测试属于各自证据，不替代这些实机结果。用户此前的零散试用反馈也不自动视作全部验收通过。

## 重现检查与 CI 边界

```sh
pnpm check:rc1
pnpm test
pnpm typecheck
pnpm verify:workbench-package
pnpm build
pnpm pack:core
```

`verify:workbench-package` 执行指定工作台包服务测试，不等同于检查最终 npm tarball。最终归档仍需按[封包说明](PUBLISHING.zh-CN.md)核对。

`.github/workflows/quality.yml` 当前只有 Ubuntu job，执行 `pnpm verify`（兼容、测试、构建）。CI 尚未自动执行独立 typecheck、封包或三平台迁移，不能把本地手动检查写成 CI 已覆盖。

历史专题的阶段测试数保留原样并明确日期。当前运行时身份以 package.json、`release-compatibility.ts` 和 `check:rc1` 为准，历史 provenance 不随文档整理重写。

## 2026-11-11 18.0 文档整理检查（历史）

当时仅整理 18.0 文档及包内开发说明：检查相对链接与标题锚点、源码导航、版本/脚本/CI 描述、归档原文保留、包内引用闭包和变更格式；归档包含 15 份历史记录。技能、模板和发布身份的定向回归为 3 个文件、11 项通过。

没有重跑完整运行时测试，也没有重新构建、安装或覆盖上一份实验包。以上 1048 项是功能基线的既有证据，本节结果只覆盖文档整理。
