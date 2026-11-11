# DSH Bay 18.0 验证与制品记录

更新日期：2026-11-11（Asia/Shanghai）。本页是当前验证入口；旧 [17.5 记录](archive/2026-11-11/VALIDATION.md) 已归档。以下结果来自最近一次功能验证与封包，不代表此次文档整理重新执行了运行时测试。

## 最近已验证的功能提交

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

## 已通过的检查

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

## 尚未完成的验收

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

## 2026-11-11 文档整理检查

本次仅整理文档及包内开发说明：检查相对链接与标题锚点、源码导航、版本/脚本/CI 描述、归档原文保留、包内引用闭包和变更格式；归档包含 15 份历史记录。技能、模板和发布身份的定向回归为 3 个文件、11 项通过。

没有重跑完整运行时测试，也没有重新构建、安装或覆盖上一份实验包。以上 1048 项是功能基线的既有证据，本节结果只覆盖文档整理。
