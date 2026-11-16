# DSH Bay 依赖溯源地图

更新日期：2026-11-14。机器可读事实见同目录的 `dependency-map.json`。本工具包针对 DSH `0.2.2-rc.2` 和 DSH Bay `0.1.0-beta.1`，用于在上游或 npm 依赖变化后快速定位影响面；它不代替 DSH 桌面实机验收。

## 为什么需要这张地图

项目当前对 DSH 的依赖不是一组简单的 `peerDependencies`：

- Host、Client、Foundation 和复制的官方 Sidebar/Workspace 源码都直接接触 DSH 类型或运行时能力。
- 部分包作为 Core peer 声明，部分包由 DSH 宿主依赖闭包提供，但没有出现在 Core manifest 中。
- 官方内页、Agent 能力和任务资源还通过字符串身份或资源地址参与运行，不会被普通 import 搜索完整覆盖。
- `compat/`、`provenance/`、`pnpm-lock.yaml` 和源码哈希分别记录版本证据，但原先没有一个关系表把“包、使用模块、变更信号、验证入口”连起来。

地图把这些关系分成四类：

| 类别 | 含义 | 变化后的第一反应 |
| --- | --- | --- |
| `dsh-declared` | Core peer 或根构建依赖中明确声明的 DSH 包 | 先查类型、导出、版本范围和对应模块测试 |
| `dsh-platform-and-ui` | Cordis、Schemastery、React 等平台依赖 | 查插件注册、渲染器和类型构建 |
| `hostProvidedPackages` | 源码直接引用但由 DSH 宿主闭包提供的包 | 评估是否应升级为显式 peer，或记录宿主最低版本 |
| `resourceIdentities` | 官方内页、Agent 能力、任务和桌面标识 | 查注册 key、资源地址、运行时能力和实机流程 |

另有 `sourceCopies` 记录 Sidebar/Workspace 镜像和私有 Area renderer 的上游包、来源索引、适配点和摘要检查。

## 如何使用

运行本地事实校验：

```sh
pnpm check:dsh-dependencies
```

它会检查：

- 根 `package.json` 与 `packages/workbench-core/package.json` 的直接依赖是否全部进入地图且没有多余登记。
- `packages/workbench-core/src` 和 `presets` 中出现的 `@deepseek-ai/*` 字面量是否归属于已声明包、宿主提供包或资源身份。
- 资源身份是否在声明的证据文件中真实出现。
- Sidebar/Workspace source index、copy manifest、renderer provenance 和运行目录是否存在。

`pnpm verify` 已将此检查放在 `check:compat` 之前。它只读取本地文件，不访问 Git 或 npm；远端版本、tag、`gitHead`、tarball integrity 和 diff 由下方的漂移扫描处理。

## DSH/npm 漂移扫描

离线预览当前基线和将被跟踪的 npm 包：

```sh
pnpm scan:dsh-drift --offline
```

只扫 npm Registry、在 Git 远端不可达时验证 npm 侧：

```sh
pnpm scan:dsh-drift --npm-only
```

从 DSH Git 远端拉取 tags 到本地 bare mirror，再用本机 Git 比较 tag、commit 和完整文件列表；同时查询 npm Registry，比较地图中所有直接 npm 依赖及宿主提供包的锁定版本、`gitHead`、tarball integrity、peerDependencies 和 exports：

```sh
pnpm scan:dsh-drift --remote
```

将 JSON 报告写入文件，或在发现漂移/拉取错误时让命令返回失败：

```sh
pnpm scan:dsh-drift --remote --output=tools/dsh-adaptation/reports/dsh-drift.json
pnpm scan:dsh-drift --remote --strict
```

生成可离线打开的可视化 HTML 报告：

```sh
pnpm report:dsh-drift --input=tools/dsh-adaptation/reports/dsh-drift.json --output=tools/dsh-adaptation/reports/dsh-drift.html
```

HTML 会嵌入这次扫描的完整 JSON，不依赖本地服务或网络。打开报告后，可通过顶部快照选择器切换扫描结果，并用“导入历史 JSON”一次载入多份定期扫描的 JSON，查看信号趋势和历史变化。渲染器也接受目录作为 `--input`，会把目录中的远端扫描报告一起嵌入；也可重复传入多个 `--input=路径`。

`--remote` 需要本机安装 Git 和 Node.js。它会把上游 tags 拉到 `tools/dsh-adaptation/.cache/deepseek-harness.git`，再用本地 `git rev-list`、`git log` 和 `git diff` 对比；不会调用 GitHub API，也不会下载或执行工作区源码。npm 包元数据通过 Node.js 原生 `fetch` 并发读取。报告会按 `sourceCopies.upstreamPaths` 标出被上游改动触及的源码镜像。该扫描读取 Git tags/commits，不查询 GitHub Release 页面上的 draft/prerelease 状态；Git 远端连接最多等待 45 秒。无参默认等同离线模式，网络扫描不会加入 `pnpm verify`。

`.github/workflows/dependency-drift.yml` 每周一 10:00（Asia/Shanghai）自动扫描，也支持手动触发。每次运行会将 JSON 数据和可视化 HTML 报告作为 90 天 workflow artifact 保存；下载后直接打开 HTML 即可查看本次结果，导入其他运行的 JSON 可进行跨周期比较。扫描不完整会使 workflow 失败，发现版本漂移则写入报告和运行摘要，不会自动改动依赖或提交代码。

扫描器先从本地 Git 树读取最近的上游 `package.json` 所在目录，再按目录结构生成包名候选；只有候选命中依赖地图中的目标包时，才关联 Bay 源码消费者、影响模块范围和验证命令。特殊目录名例外写在 `upstreamPathOverrides`。插件未依赖的上游包会保留为计数和少量样例，不再生成高优先级适配 finding；无法确定所属包目录的变化才作为未映射路径提示。它只读取 Git 树对象和变更文件名，不读取上游源码 blob，也不依赖 partial clone 中尚未缓存的 blob。npm 基线版本按各 manifest importer 的锁定解析读取；tarball integrity 按锁文件中的包名和版本逐一对照 Registry。当前基线有 97 个 DSH/直接 npm 目标，其中 96 个有锁文件或 provenance integrity；Dockkit 由 DSH 宿主闭包提供，没有进入插件锁文件，因此报告会标出它的 integrity 基线未固定。

`impact` 表示模块本身的影响范围，finding 的 `severity` 表示本轮需要处置的优先级。`verification` 列出变化后应先跑的校验。`upstream-commit`、`dependency-area-change`、`source-copy-change`、`newer-version`、`peer-contract-drift` 和 `exports-drift` 都是适配信号，不会自动判断为不兼容。Git/npm 元数据也不证明桌面端行为正确，仍需根据变化跑源码一致性检查、类型检查、受影响测试和 DSH 桌面验收。

## 当前发现的风险

源码扫描到 73 个 DSH 包根。除了已声明依赖和资源身份外，有 10 个包是“宿主提供但 Core 未直接声明”：

- `dsh-attachment`
- `dsh-client-file-upload`
- `dsh-client-product-analytics`
- `dsh-client-ui-dockkit`
- `dsh-session-format`
- `dsh-session-persistence`
- `dsh-subagent`
- `dsh-util-values`
- `dsh-web-frontend`
- `dsh-workspace`

这不自动表示当前实现错误，但它们是下一轮依赖治理的优先对象：宿主如果移动导出、拆分包或改变闭包，插件管理器未必能通过 peer 检查提前阻止安装。地图已经为每个包记录了原因和验证入口，后续可以据此决定是否提升为显式 peer，或在 DSH engine compatibility 中声明最低版本。

## 更新规则

1. 新增 DSH import、官方内页身份、Agent 能力身份或资源地址时，先更新 JSON 地图，再改实现。
2. 如果包由宿主闭包提供，放入 `hostProvidedPackages`，写明证据文件、风险和验证命令；不要把它伪装成 Core 的直接 peer。
3. 如果只是字符串身份而不是可导入包，放入 `resourceIdentities`，同时保留真实证据文件。
4. 上游复制源码的变化仍由 `check:compat` 负责摘要、适配文件和 source index；地图只记录依赖关系和变更后的验证入口。
5. 依赖版本变化时先更新地图中的版本政策和候选身份，再更新 manifest/lockfile；完成后运行 `pnpm check:dsh-dependencies`、`pnpm check:compat`、类型检查和受影响测试。

扫描器会消费这张地图，按 `impact`、`changeSignals` 和 `verification` 生成 DSH Git/npm 变化报告。DSH 新增包或本项目增加新的 DSH import 时，先更新本地图，再运行 `pnpm check:dsh-dependencies` 和离线扫描确认覆盖。
