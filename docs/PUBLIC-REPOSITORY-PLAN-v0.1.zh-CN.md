# DSH Bay v0.1 公开仓库整理方案

更新时间：2026-11-16（Asia/Shanghai）

## 结论

公开仓库应从确认过的 RC2 快照重新组装，放在当前私有工作区之外，删除 `.git` 后重新初始化。当前仓库保留为内部研发和证据仓库，不进行历史改写，也不通过删除旧提交来伪造“干净历史”。

公开仓库的“干净”有两个独立含义：

1. Git 历史只有一个公开初始提交，没有内部实验、失败候选或用户反馈的提交轨迹。
2. 文件内容只包含公开产品所需的源码、文档、许可证、构建配置和脱敏验证证据，没有私有制品、用户数据、临时日志或内部评审材料。

只做其中一项都不够。一个只有单提交但把整个私有工作区复制进去的仓库，仍然不是干净的公开仓库。

## 公开目录建议

公开仓库可以保留 monorepo 形态，但只发布一个可安装的 Core 包：

```text
dsh-bay/
├─ .github/
│  ├─ CODEOWNERS
│  ├─ ISSUE_TEMPLATE/bug-report.yml
│  ├─ ISSUE_TEMPLATE/feature-request.yml
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ workflows/
│     ├─ quality.yml
│     ├─ dependency-drift.yml
│     └─ public-release-check.yml
├─ compat/dsh-0.2.2-rc.2/
├─ docs/
│  ├─ ARCHITECTURE.zh-CN.md
│  ├─ USER-GUIDE.zh-CN.md
│  ├─ VALIDATION-v0.1.zh-CN.md
│  ├─ RELEASE-NOTES-v0.1.0-beta.1.zh-CN.md
│  └─ ...
├─ packages/workbench-core/
│  ├─ src/
│  ├─ tests/
│  ├─ presets/
│  ├─ package.json
│  ├─ LICENSE
│  └─ THIRD_PARTY_NOTICES.txt
├─ provenance/
│  └─ dsh-0.2.2-rc.2.json
├─ scripts/
├─ tools/dsh-adaptation/
├─ .gitignore
├─ CHANGELOG.md
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
├─ GOVERNANCE.md
├─ LICENSE
├─ README.md
├─ SECURITY.md
├─ SUPPORT.md
├─ THIRD_PARTY_NOTICES.txt
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

目录只是目标形状，不是复制命令。最终 allowlist 必须按实际构建依赖逐项确认；例如 `scripts/` 和 `tools/dsh-adaptation/` 只能保留公开 CI、兼容检查和打包真正需要的文件。

## Allowlist：可以进入公开快照的内容

- Core 包的 `src/`、回归测试、公开 presets、包级 README、许可证和第三方声明。
- 构建、类型检查、测试、兼容检查和公开制品验证所需的根配置、锁文件、脚本和工具。
- DSH RC2 兼容 manifest、来源索引、构建输入摘要和不含本机路径的 provenance。
- 面向用户的 README、安装教程、架构说明、贡献指南、变更记录和 `v0.1` 验证摘要。
- 公开项目规范：行为准则、治理、支持、安全、CODEOWNERS、Issue/PR 模板和 CI workflow。
- MIT 许可证及所有实际随源码或 npm 包分发的第三方声明。

每一项进入 allowlist 前都要回答两个问题：它是否被公开构建或用户使用需要；它是否包含只有内部研发才有意义的上下文。第二个问题答“是”时，应重写成脱敏的公共说明，不能原样复制。

## Exclude：明确不能进入公开快照的内容

- `.git/`、任何旧分支、stash、commit 导出和内部工作树元数据。
- `.tmp-*`、`*.log`、`tmp/`、`output/`、`prototypes/`、`node_modules/`、构建缓存和本地报告。
- `releases/*-private/`、旧 alpha/RC 候选包、`candidate.json` 私有路径和安装记录。
- `docs/reviews/`、内部评审 PDF/HTML、用户反馈原文、失败候选的逐轮排障记录和未公开路线讨论。
- 当前这两份发布准备文件（`docs/OPEN-SOURCE-BETA-READINESS-v0.1.zh-CN.md`、`docs/PUBLIC-REPOSITORY-PLAN-v0.1.zh-CN.md`）本身也属于内部发布工作材料；公开仓库只保留脱敏后的用户文档、验证摘要和发布说明。
- `dsh-superagent/` 研究目录，除非另行完成许可证、范围和维护责任审查。
- 用户 Profile、Session transcript、工作台实例、附件、模型凭据、局域网地址和机器标识。
- 包含 `C:\Users\...`、内部仓库路径、临时端口、私有 artifact URL 或本机 token 的任何文件。
- 仅服务于历史候选的 `check:rc1-history` 证据和旧版本验证正文；如对公共兼容性仍有价值，应改写为当前版本的简短来源说明。

`.gitignore` 只能防止未来误提交，不能证明 Git 历史、未跟踪文件或 tarball 安全。因此必须在新目录和最终 Git 索引上分别扫描。

## 版本和包身份

当前建议的公开版本基线如下，最终值应在快照冻结时统一确认：

| 对象 | 公开值 |
| --- | --- |
| npm Core 包 | `dsh-bay@0.1.0-beta.1` |
| Git tag | `v0.1.0-beta.1` |
| DSH 兼容范围 | `>=0.2.2-rc.2 <0.2.3` |
| 公开仓库 | 由维护者最终确认名称和组织后创建 |

根 workspace 可以继续保持 `private: true`，因为它不是要发布到 npm 的包；但它的描述、README 和公开文档不能再称为 private staging。Core 包保持 `private: false`，并将以下信息全部统一为公开版本：`package.json`、`dsh.workbench` 元数据、`productLine`、`candidateId`、README、CHANGELOG、发布说明、构建输入和制品文件名。

当前 `scripts/pack.mjs` 仍是私有候选打包器：默认写入 `releases/*-private/`，候选元数据包含 `status: private-staging`。公开快照必须将其改为公开 beta 语义，例如写入 `releases/<version>/`、记录 `status: public-beta`，并确认 manifest 中的包名、版本、DSH 代际、来源提交、tarball 路径和 SHA-256/SHA-512 全部来自本次构建。公开 release workflow 必须读取该元数据并校验 tarball 实际摘要，不能只运行 `pack:core` 后就算通过。

内部 `0.2.2-alpha.18.7`、内部候选目录名和当前私有提交号只能留在内部审计记录，不写进公开仓库。公开 provenance 可以记录 DSH 上游版本、上游 commit、来源文件摘要和构建摘要，但不需要带出 DSH Bay 的内部历史。

## 必需的项目规范

- `README.md`：一句话定位、目标用户、安装、第一条成功路径、支持范围、已知限制和反馈入口。
- `CONTRIBUTING.md`：开发环境、分支/提交约定、必跑检查、测试数据脱敏和 PR 要求。
- `CODE_OF_CONDUCT.md`：行为标准、执行方式和报告入口。
- `GOVERNANCE.md`：维护者权限、审核责任、版本和安全决策边界。
- `SUPPORT.md`：问题分类、支持范围、最小复现信息和不应公开的敏感内容。
- `SECURITY.md`：只通过 GitHub Private Vulnerability Reporting 或维护者指定的私密渠道报告漏洞，不在公开 Issue 发布凭据或利用细节。
- `.github/CODEOWNERS`：明确代码、文档、发布和安全变更的审核人。
- Issue / PR 模板：要求版本、DSH 版本、操作系统、复现步骤、预期/实际结果和脱敏日志。
- CI：PR 运行质量门禁；tag 运行兼容性、打包白名单、敏感文件和许可证检查；发布 workflow 不把凭据写入仓库。

这些文件必须以公开版本的仓库名、支持范围和联系入口为准，不能从当前 private staging 文案直接复制。

## 新仓库生成流程

以下流程只在公开快照已经通过 P0 审阅后执行：

```powershell
# 公开目录必须位于当前私有仓库之外，并且事先不存在
New-Item -ItemType Directory -Path ..\dsh-bay-public-v0.1

# 按 allowlist 复制源码、配置和已审阅文档；不要复制整个工作区
# 复制完成后，在公开目录执行：
Set-Location ..\dsh-bay-public-v0.1
git init
git add .
git diff --cached --check
git commit -m "Initial public beta snapshot: DSH Bay v0.1.0-beta.1"
git tag -a v0.1.0-beta.1 -m "DSH Bay v0.1.0-beta.1"
git rev-list --all --count  # 必须为 1
```

实际复制应由可审阅的 allowlist 脚本或逐项复制记录完成，而不是 `robocopy ..\dsh-bay ... /E` 这类全目录复制。新仓库生成后，原私有仓库继续作为内部来源和历史证据保存；不执行 `git filter-repo`、`git reset --hard` 或删除当前 `.git`。

## 发布前扫描与验证

在公开目录中执行并保存结果：

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:dsh-dependencies
pnpm check:compat
pnpm test
pnpm typecheck
pnpm build
pnpm pack:core
pnpm --filter dsh-bay pack --dry-run

rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' `
  '(^|["'' ])(sk|pk|ak)-[A-Za-z0-9_-]{16,}|api[_-]?key|token|secret|password|C:\\Users\\|releases/.*private|private staging' .

git ls-files | rg '(^|/)(\.env|.*\.log|.*\.tgz|releases/.*private|docs/reviews|dsh-superagent)(/|$)'
git diff --cached --check
```

`rg` 只是第一层检查；有条件时再使用 gitleaks/trufflehog 等专用扫描，并人工审阅许可证、第三方来源、压缩包文件清单和构建输入。最终 tarball 要从干净目录重新生成并计算 SHA-256/SHA-512，摘要写入公开发布元数据。

## 远程发布边界

本地新仓库、远程 GitHub 仓库、GitHub Release、npm publish 和官网发布是五个独立动作。前四个可以共享同一公开快照和 tag，但每一步都要记录结果；任何一步失败都不能用“代码已提交”代替。

在 P0 全部关闭并完成最终签字前，不创建公开远程仓库、不 push、不发布 npm、不创建 GitHub Release。官网可以先使用已审阅的静态材料做内部预览，但公开安装链接和制品链接必须等 tag 与摘要确认后再上线。
