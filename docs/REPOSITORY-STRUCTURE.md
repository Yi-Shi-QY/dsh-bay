# 仓库结构

- `.github/`：公开仓库的 CI、问题模板和评审模板。
- `compat/`：与 DSH `0.2.2-rc.2` 对应的兼容声明。
- `docs/`：公开的项目、产品、架构、用户和发布文档。
- `packages/workbench-core/`：湾的 Core 插件包、源码、测试和 Creator 资产。
- `provenance/`：上游版本、来源和发布候选的可核查记录。
- `scripts/`：构建、兼容检查、测试和 Core 打包脚本。
- `tools/dsh-adaptation/`：DSH 依赖清单和漂移审计工具。

`node_modules/`、构建输出、本地临时文件和 `releases/` 下生成的候选包不属于源码快照，由 `.gitignore` 排除。公开仓库不包含私有评审材料、个人实验目录或旧提交历史。
