# DSH Bay 封包与发布

更新日期：2026-11-11。当前私有候选为 `dsh-bay@0.2.2-alpha.18.1`，目标 DSH `0.2.2-rc.1`。最新已交付包身份与验证范围见 [VALIDATION.md](VALIDATION.md)。

## 私有实验包流程

1. 记录实际源码提交和工作树状态，保留用户未提交成果。按用户要求确定先提交还是先交付实验包，不自动混入无关文件。
2. 功能变更完成后执行兼容检查、相应回归、类型检查和构建；封包前确认完整回归已有对应基线证据。
3. 执行 `pnpm pack:core`。脚本清理 `packages/workbench-core/lib`，重建 Host/Client 运行时及声明，按 `files` 白名单封装。
4. 检查实际 tarball 的版本、DSH 代际、上游身份、构建输入、文件闭包、大小与摘要。
5. 交付包路径、源码提交、校验值及真实验收边界，按用户安装结果推进下一阶段。

```sh
pnpm check:rc1
pnpm test
pnpm typecheck
pnpm verify:workbench-package
pnpm build
pnpm pack:core
```

默认输出：

```text
releases/alpha18.1-rc1-private/
├─ dsh-bay-0.2.2-alpha.18.1.tgz
└─ candidate.json
```

需要保留同版本不同候选时，可使用现有入口指定新的仓库 releases 子目录，例如：

```sh
pnpm pack:core --output=releases/alpha18.1-review-private
```

保持路径简单且不含空格。默认文件名和 candidateId 不因重打包自动唯一化；交付记录须同时保存提交与摘要。

## 最终归档检查

- 包内 `package.json`、`lib/build-inputs.json` 与 `candidate.json` 的包名、版本、DSH generation 和上游提交一致。
- SHA-256、SHA-512 integrity 与实际文件字节一致；运行时与本次生成的 lib 一致。
- 归档文件符合 `packages/workbench-core/package.json` 的 `files` 白名单；必要声明、技能和模板完整。
- 不带入 `node_modules`、用户 Profile、临时数据、无关研究目录或历史自定义 Creator preset。
- `lib` 是 Git 忽略的生成目录，但其中白名单内容必须进入安装包。根目录 `.bay` 工作文件只属于工作台迁移包，不属于插件 npm 包。
- `verify:workbench-package` 检查工作台包服务，不替代最终插件 tarball 检查。`package-verification.json` 若额外生成，必须绑定本次实际归档，不能沿用旧报告。

## 安装后基础验收

至少验证创建和目录重名处理、项目概览、多会话、关闭/重新打开项目、Main 标签显隐、原版模式往返输入、浏览器接管/关页/收回，以及完整包预览、导入、历史附件和主动续聊。

数据恢复、运行环境与任务可执行性分别判断。三平台、另一台局域网设备、真实大包和长时间真实模型运行独立记录，不从单元测试推导为通过。

## 公开发布边界

公开 npm、GitHub Release、tag 和网站是独立发布动作，按用户明确要求执行。发布前需绑定同一源码/制品，完成干净 DSH Profile 反向安装、许可与来源检查、版本说明和已知限制。

当前 CI 只在 Ubuntu 运行 `pnpm verify`，公开发布不能把独立类型检查、封包与跨平台验收当成既有 CI 保证。保留此前可用制品及其数据兼容说明；18.x 项目数据不应直接交给不支持它的旧版本读取。
