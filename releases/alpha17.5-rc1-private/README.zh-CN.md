# DSH Bay 17.5 RC1 private candidate

- 产品：DSH Bay / 湾域
- 安装包：`dsh-bay`
- 版本：`0.2.2-alpha.17.5`
- 兼容目标：DSH `0.2.2-rc.1`
- 状态：`private-staging / experimental-unvalidated`

## Artifact

```text
dsh-bay-0.2.2-alpha.17.5.tgz
```

当前归档的 SHA-256、完整性摘要、文件数和构建输入核对见：

- `candidate.json`
- `package-name-verification.json`

归档是本地私有试用包，不代表已经发布到 npm，也不代表已经完成真实 DSH
桌面 smoke。安装前请在独立 DSH Profile 中停用旧的
`@dsh-workbench/core`，再安装并启用 `dsh-bay`，避免两个包同时注册工作台。

## Recorded checks

候选记录包含 rc1 身份、类型检查、严格打包、归档内容和依赖闭包核对。真实
桌面验收仍需覆盖工作台重启、多轮输入、浮动与锁定布局、自定义容器内页和
完整离线包导出导入。
