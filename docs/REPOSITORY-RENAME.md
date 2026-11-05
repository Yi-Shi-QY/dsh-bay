# DSH Bay 仓库改名记录

记录日期：2026-11-04（Asia/Shanghai）

## 改名结果

- 产品展示名：`DSH Bay`
- 中文名：`湾域`
- 新仓库：`Yi-Shi-QY/dsh-bay`
- 新地址：<https://github.com/Yi-Shi-QY/dsh-bay>
- 可见性：Private
- 默认分支：`main`
- 本地目录：`projects/dsh-bay`

原独立候选仓库 `Yi-Shi-QY/areadeck` 已由 GitHub 正式重命名为
`Yi-Shi-QY/dsh-bay`。GitHub 会为旧地址保留重定向；新的提交、文档链接、
package metadata、CI 和后续发布记录统一使用新地址。

## 身份分层

仓库和品牌使用 `dsh-bay` / `DSH Bay`，运行时技术包继续使用
`@dsh-workbench/core`。技术包名表达 Core 的职责和兼容边界，不因为品牌改名
而改成 `@dsh-workbench/bay`，也不使用 `@deepseek-ai` scope，以免造成 DSH
官方归属误解。

当前候选身份保持：

```text
DSH Bay 0.2.2-alpha.17
DSH 0.2.2-rc.1
upstream 66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db
```

## 标签和历史证据

已有 `v0.2.2-alpha.17` 标签继续指向原始 alpha 候选提交，不因为仓库改名而
移动或重写。仓库改名只新增提交 `a4ef4e1`，用于更新品牌、URL、候选 ID、
provenance、README 和构建元数据。

因此：

- 旧 alpha 制品的版本、digest 和标签仍可独立追溯；
- 仓库改名不会伪装成新的运行时版本；
- DSH rc1 兼容契约和 Core-only 交付边界保持不变；
- 后续公测版本应使用 `dsh-bay` 仓库和新的 release validation index。

## 核验

改名后已核对：

- GitHub 仓库为 Private，默认分支为 `main`；
- `origin` fetch/push URL 均为 `https://github.com/Yi-Shi-QY/dsh-bay.git`；
- `main` 远端提交为 `a4ef4e1`；
- `v0.2.2-alpha.17` 标签仍然存在；
- topics 包含 `dsh-bay`，不再包含 `areadeck`；
- README、package metadata、compat manifest、provenance 和脚本均使用
  `DSH Bay / 湾域`。
