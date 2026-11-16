# Contributing to DSH Bay / 湾

感谢你参与湾的公开 Beta。贡献可以是代码、文档、Creator 模板、测试用例或可复现的实际场景。

## 开发环境

- Node.js `>=24.9.0`
- pnpm `11.28.5`
- DSH `0.2.2-rc.2` 或兼容范围内的版本

安装依赖后，在提交前运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:dsh-dependencies
pnpm check:compat
pnpm test
pnpm typecheck
pnpm build
```

## 贡献原则

- 说明用户可见的行为变化、数据边界和兼容影响。
- 涉及来源镜像、权限、局域网、导入导出或发布制品时，补充验证证据。
- 不提交 API key、DSH credentials、Session transcript、绝对本地路径或私有 artifact 地址。
- 修改上游 RC2 镜像时，保留来源索引和适配记录，不直接覆盖来源文件来隐藏差异。
- 新增模板时，附带最小使用场景和验收步骤。

## Pull Request

PR 标题应说明行为或文档主题。描述中请包含复现或使用场景、改动范围、验证命令和仍待验证的内容。涉及公开 API、包格式或兼容范围的改动需要同步更新文档与变更记录。

请先在 Issue 中讨论较大的协议、架构或产品方向变化。安全问题请遵循 [SECURITY.md](SECURITY.md) 的私密报告流程。
