# 专用 Agent 组装：设计意图与实现架构（审计用）

适用版本：`dsh-bay@0.2.2-alpha.18.7`，宿主 DSH `0.2.2-rc.2`。整理日期 2026-11-15。
早期设计见 `AGENT-ASSEMBLY-DESIGN.zh-CN.md`；两者冲突时以本文为准。行号对应当前工作区，未提交。

## 1. 设计意图

产品背景：负责人在工作台里做好 AI 自动化，再通过局域网分给 4–5 人的小组，不需要服务器。专用 Agent 是这套自动化的执行者。

| 编号 | 意图 | 来源 |
|---|---|---|
| I1 | 像搭积木一样组装：基础模式 + DSH 能力积木（AGENTS.md、终端、文件、网页、Skill、Agent loop）+ 工作台工具 + 额外指令 | 用户需求 |
| I2 | 组装结果经过保存、验收后注册为 DSH Agent 模式 | 用户需求 |
| I3 | 哪个修订注册到 DSH 由人从列表里选，保存不等于上线 | 用户决定 |
| I4 | Agent 组装是主页面，工具集成是它的子页 | 用户需求 |
| I5 | 自定义 Agent 随完整包、模板包、浏览器、局域网共享一起走 | 用户决定："得带上" |
| I6 | 每个工作台只看到自己的 Agent；访客只能用开放给访客的 Agent | 实施计划 |
| I7 | 已有会话不能因为改了 Agent 而无法恢复 | DSH 约束，见 2.1 |

## 2. 约束与由此得出的决定

### 2.1 DSH 预设注册表的约束

- `presets.register()` 只在内存里，重启就没了，所以 Bay 必须自己持久化并在启动时重放。
- 同一个 ID 不能重复注册，所以不能就地修改。
- 会话在 header 和 `agent-preset/selected` 事件里记录预设 ID，恢复时找不到这个 ID 就拒绝恢复。
- 注册表是全局的，没有"属于哪个工作台"的概念。

### 2.2 决定

| 决定 | 理由 |
|---|---|
| 预设 ID 写成 `bay:<workbenchId>:<agentId>@<revision>` | 每次修改都得到新 ID，旧会话按旧 ID 仍能恢复（I7）；前缀可以用来区分工作台（I6） |
| 一个修订一个文件，`.bay/agents/<agentId>@<revision>.json` | 修订不可变，复制文件夹后仍能读懂 |
| 注册选择单独存在 `.bay/agents/selection.json`，只记 `agentId` 和 `revision`，不记预设 ID | 完整包导入会换工作台 ID；文件内容不含 ID，复制后哈希校验仍然成立 |
| 文件名和文件内容不一致就忽略 | 防止改名后的复制文件注册出旧 ID |
| 同一个 Agent 可以同时注册多个修订 | 新旧任务并存时互不影响 |

## 3. 实现架构

### 3.1 模块

| 层 | 文件 | 职责 |
|---|---|---|
| 共享模型 | `src/agent-assembly-model.ts` | 类型、积木表、校验（`agentDefinitionProblems:179`、`parseAgentDefinition:197`、`validatePortableAgents:138`）、`presetIdFor:99`、`remapAgentPresetId:108`、`fetchPortableAgents:169` |
| 预设组成 | `src/host-agent-preset.ts` | 按基础模式和积木生成插件行，对齐 DSH `standard` / `minimal` |
| Host 存储 | `src/host-agent-assembly.ts` | `HostAgentAssemblyStore`：读写修订、注册和注销、`refreshAvailability:62`、`offers:87`、`restoreWorkbench:101`、`portable:113`、`importPortable:124` |
| Host 接线 | `src/host-agent-assembly-service.ts` | 创建存储、作为 `workbenchAgentAssembly` 服务提供（:39）、启动时 `restore()`（:56） |
| 路由 | `src/host-agent-assembly-route.ts` | `POST /api/workbench/agent-assembly`，动作有 list、save、register、unregister、portable；访客只能 list（:28） |
| 文件写入 | `src/host-workbench-directory.ts:245,250,253` | 在目录串行队列里原子写入修订文件、selection 和导入建议 |
| 派活过滤 | `src/host-bay-agent.ts:261` `modesFor` | 派活、快照和 `bay_inspect` 只列允许的模式 |
| V6 完整包 | `host-workbench-complete.ts:453,532`、`host-native-session-portability.ts:94,201`、`host-workbench-task-snapshot.ts:91` | 改写预设 ID，发布后把复制的 selection 转成建议，再按接收方选择注册 |
| V4 模板包 | `foundation/workbench-layout-package.ts:117,158`、`foundation/distribution-package-service.ts:94,105`、`host-distribution-service.ts:154,160`、`host-distribution-route.ts` | 导出时带上 Agent，导入时校验、写入建议，不自动注册 |
| 界面 | `foundation/WorkbenchAgentAssemblyDialog.tsx` | 列表、组装向导、注册开关、工具集成子页、白名单同步 |

### 3.2 数据

```
<工作台>/.bay/agents/
  quote-assistant@1.json   WorkbenchAgentDefinitionV1，写入后不再修改
  quote-assistant@2.json
  selection.json           { schemaVersion: 1, registered: [{ agentId, revision }] }
```

内存里的状态（Host 进程内）：
- `rows`：预设 ID 到 `{ workbenchId, definition, presetId, status }` 的映射，状态为 saved、registered 或 unavailable；导入建议另带 `suggested` 来源。
- `registered`：预设 ID 到注销函数的映射。

### 3.3 主要流程

1. **保存**：路由 → `save()`。下一个修订号 = 已有最大值 + 1；写入文件，状态记为 saved，不注册。
2. **注册 / 注销**：`registerRevision()` 调用 `presets.register(composeAgentPreset(...))`，再写 selection。`unregisterRevision()` 先用 `sessionsUsing` 查会话目录里仍引用这个预设的会话，再注销、写 selection，然后把会话列表返回给界面。
3. **启动**：`restore()` 遍历所有工作台，只注册 selection 里列出的修订。
4. **派活**：`modesFor(id)` 调用 `store.offers(id, modeId, guest)`。非 `bay:` 的模式照常显示；`bay:` 模式必须属于当前工作台且已注册；访客额外排除 `guestAccess === 'none'`。访客身份来自 AsyncLocalStorage 里的执行来源（`currentWorkbenchExecutionOrigin`）。
5. **V6 导入**：先记下源工作台 ID，再把会话目录、会话头、`agent-preset/selected` 事件和任务快照里的 `bay:<源ID>:` 改成 `bay:<新ID>:`。`.bay/agents` 原样复制，所以文件哈希校验不受影响。发布后先把复制的 `selection.json` 转成 `suggested.json` 并清空选择，再调用 `restoreWorkbench`；作业重试走"已发布"分支时也会执行（:453）。
6. **V4 导出**：浏览器端 `prepareExport` 通过 `portable` 动作取回全部修订和注册选择，写进 `layout.agents`。
7. **V4 导入**：`validatePortableLayout` 严格校验 `agents`（字段白名单，定义必须能原样解析，注册项必须对应已有修订，上限 64）。`directory.create` 之后调用 `importPortable`：已存在的修订不覆盖，把来源的注册选择写入 `suggested.json`，然后只刷新列表，不自动注册。
8. **白名单同步**：抽屉加载时，对已注册且工具都在目录里的修订，如果网关白名单不同，就调用 `setAgentAllowlist`。

## 4. 信任边界

| 边界 | 控制 | 位置 |
|---|---|---|
| 桌面房主 | 没有访问凭证的请求按房主处理 | `host-workbench-access.ts:461` |
| 浏览器房主 | 凭证鉴权；list 需要 view 权限，其余动作需要 layout 权限 | 路由 :27 |
| 局域网访客 | 只能 list；save、register、unregister、portable 返回 403 | 路由 :28 |
| 访客派活 | 排除 `guestAccess: none` | `offers`、`modesFor` |
| 包内容 | V4 严格校验字段，文件名和内容不一致即忽略；V6 校验文件哈希 | `validatePortableAgents`、`readAll` |
| 预设本身 | **不是安全边界。** 插件行在 Host 进程里执行；权限仍然依赖 DSH 的审批策略 | DSH 注册表 README |

## 5. 已知缺口（审计重点）

以下是实现前对照代码核实的历史缺口。当前实现状态以第 8 节为准；下表保留问题、影响和原始证据，不能再当作当前行为描述。

| # | 缺口 | 影响 | 证据 |
|---|---|---|---|
| G1 | **选中的工作台工具和 skill 没有真正生效。** 预设组成只用了基础模式、积木和指令；`definition.tools` 和 `skills` 没有进入插件行。网关白名单（`setAgentAllowlist`）在生产代码里没有执行方，`projectForAgent` 只在工具集成页里用来展示 | I1 中"工具"这一块目前只是记录，Agent 运行时既不会被限制在这些工具里，也不会额外获得它们 | `host-agent-preset.ts` 不含 `definition.tools`；`grep projectForAgent` 只命中界面 |
| G2 | **访客可以绕过 `guestAccess`。** 过滤只加在 Bay 派活上。原生会话的模式选择器走 DSH 的 `agentPresets/list`（访客有全局读权限），`agentPresets/select` 只在访客对该会话有 `message` 权限时才进入绑定，执行时的条件再要求 `tasks` 权限；同时具备两者的访客能直接选任意工作台的 `bay:` 预设 | I6 只对 Bay 派活成立 | `host-workbench-native-access.ts:46-47,180` |
| G3 | **启动顺序存在竞争。** `restore()` 是异步启动、不等待的，而且在 Bay Agent Host 之后安装。如果 DSH 在注册完成前恢复会话，引用 `bay:` 预设的会话会因为找不到预设而失败 | I7 在冷启动时可能失效，需要实机验证 | `host-agent-assembly-service.ts:32`；`index.ts:122-123` |
| G4 | **"仅布局"模式的模板包不签名。** 我此前说"包签名覆盖 agents"，这只对在线引用和离线内嵌两种模式成立。仅布局包里的 Agent 指令可以被改 | 不可信来源的模板包可能往人格提示词里注入指令 | `workbench-package-v4.ts:95` |
| G5 | **历史行为是导入即注册，没有人工选择。** V4 和 V6 曾照搬源端的注册选择，接收方没有确认步骤 | 和 I3"由人选"在接收端不一致 | `importPortable`、`restoreWorkbench` |
| G6 | **历史行为是 V4 导入重试会漏掉 Agent。** `importPortable` 曾只在"工作台尚不存在"的分支里执行 | 少见，但会静默丢失 | `host-distribution-service.ts:388,408` |
| G7 | **历史行为是注销提醒只查会话目录。** 正在执行或排队的任务（`workItems.agentPreset`）和子会话不在检查范围内 | 有任务引用时注销不会给出提醒 | `host-agent-assembly-service.ts` 中的 `sessionsUsing` |
| G8 | **历史行为是"不可用"只在界面上计算。** Host 曾不写入 `unavailable` 状态，也不检查工具 | 状态只是提示，不是约束 | `WorkbenchAgentAssemblyDialog.tsx:218` |
| G9 | 白名单同步依赖接收方打开抽屉，失败会被吞掉 | 受 G1 影响，目前没有实际后果 | 对话框 :136-141 |
| G10 | 含 Agent 的 18.7 模板包，18.6 及更早版本拒绝导入 | 版本兼容 | `validatePortableLayout` 的字段白名单 |

处理结论见第 8 节。原建议顺序：先补 G1 和 G2，否则工具选择和访客权限这两个核心承诺都不成立；然后是 G3，要实机验证；G4 和 G5 可以合并处理，在导入时给接收方一个确认注册的步骤，仅布局包默认不注册。

## 6. 测试覆盖

`tests/host-agent-assembly.spec.ts`（19 个用例）：
- 修订分文件保存，保存时不注册；
- 按 selection 重启重放；
- 注销时列出引用会话；
- `offers` 的工作台和访客过滤；
- 文件名和内容不一致时忽略；
- V4 打包、导入、注册，包括篡改后被拒；
- 事件里的预设 ID 改写；
- 插件组成；
- 缺少 Host 执行器时拒绝注册，执行器消失时撤销内存注册并在恢复后重放选择；
- 普通 Agent 切换到专用预设后挂载能力，切回普通预设后撤下；
- 执行器热插拔时撤下并重新挂载存活 Agent；
- 工作台永久删除后清理残留预设、绑定和列表行；
- 保存和并发注册的结构校验与串行化；
- 访客对 save、register、portable 收到 403。

`tests/workbench-agent-assembly-dialog.client.spec.tsx`（7 个用例）：
- 列表和工具集成子页；
- 组装向导保存时不注册；
- 修订时标识锁定；
- 注册、写白名单、注销提醒；
- 缺工具时标为不可用。
- 导入建议、未签名提示，以及 Host 报告缺少执行器时标为不可用。

没有覆盖的部分：
- V6 端到端导入（只测了改写函数）；
- `modesFor` 在 `host-bay-agent` 里的集成；
- 启动竞争（G3）；
- 原生选择器的访客路径（G2）；
- DSH 桌面实机和双设备。

本轮全量测试通过：179 个测试文件、1225 个测试用例；另通过 typecheck、构建和全部适配检查。

## 7. 审计核对清单

- [x] 修订文件写入后不再被修改（`save` 每次递增修订号，`importPortable` 跳过已存在的修订）
- [x] 每个写入路径都经过 `HostWorkbenchDirectory.serial` 和 `atomicJson`
- [x] 路由的 1 MB 请求上限，以及 `agentId`、`revision` 的格式校验（目录层 :245）
- [x] 改写函数只匹配 `bay:<源ID>:` 前缀，其他预设 ID 不变
- [x] V6 文件哈希校验没有因为 `.bay/agents` 被修改而跳过
- [x] 工作台永久删除后不残留内存中的 Agent 预设、绑定和注册行
- [x] AgentKit 的 Tool/Skill ID 必须带扩展 `moduleId.` 前缀；MCP/CLI 不进入 Agent 组装步骤
- [x] G1–G10 每一项都有处理结论（修复、接受或延后）
- [ ] DSH 桌面实机：注册后重启，会话能恢复；完整包导入后能派活；访客端看不到 `guestAccess: none` 的 Agent（同时验证 G2）

## 8. 处理结论（2026-11-15 第二轮）

| # | 结论 | 做法 | 位置 | 回归测试 |
|---|---|---|---|---|
| G1 | 修复 | 新增 Host 端 `workbenchAgentKit` 服务。扩展在 Host 插件里注册执行器（工具和 Skill），默认对所有 Agent 不可见。`installAgentKitBinder` 记录所有存活 Agent，在创建、预设切换时只把该修订勾选的条目注册到 `agent.ctx` 自己的作用域；普通 Agent 切到专用预设后也能挂载，切回普通预设或结束时撤下。MCP/CLI 仍由工具网关管理，不会出现在 Agent 组装选择步骤 | `agent-kit-contract.ts`、`host-agent-kit.ts`、`host-agent-kit-binder.ts`、`WorkbenchAgentAssemblyDialog.tsx`；扩展规范第 22 节 | `mounts only the selected tools and skills…`、`mounts a specialized preset when an ordinary live agent switches…` |
| G2 | 修复 | 原生传输对 `agentPresets/list` 的结果按 `store.offers` 过滤；`agentPresets/select` 在会话权限检查之后再检查目标预设；目录路由的 `create-session` 对非桌面身份做同样检查。没有组装存储时一律隐藏 `bay:` 预设 | `host-workbench-native-access.ts`、`host-workbench-directory-route.ts` | `hides other workbenches and guest-blocked assembled presets…`（含允许预设的正向对照） |
| G3 | 修复，待实机 | 组装服务改在 Bay Agent 之前安装，提供 `workbenchAgentAssemblyReady`；Bay 的 `ensureNative` 在解析或创建原生会话前等待它。DSH 自己在 Bay 之外恢复会话的路径不受这条保证覆盖 | `index.ts`、`host-agent-assembly-service.ts`、`host-bay-agent.ts` | 无自动化；需冷启动实机 |
| G4 | 缓解 | 未签名包里的 Agent 不再自动注册（见 G5），并在卡片上标"该包未签名，指令可能被改过"。没有给仅布局包加签名 | `importPortable(…, 'template-unsigned')`、对话框 `SUGGESTION_TEXT` | `carries agents through a template bundle…`、`shows an import suggestion…` |
| G5 | 修复 | V4 和 V6 导入都只写 `.bay/agents/suggested.json`，不注册。V6 发布后把复制过来的 `selection.json` 转成建议并清空。接收方在列表里逐个注册 | `adoptCopiedSelection`、`importPortable` | `turns a selection copied by a complete package into a suggestion` |
| G6 | 修复 | Agent 写入移出"新建"分支，并在 `reconcileCommit`（重试已提交的事务）中也执行。内容取自重新校验的归档，不取事务文件 | `host-distribution-service.ts` `importAgents` | 存储层重试幂等已测；事务层重试无单测 |
| G7 | 修复 | 注销提醒同时列出会话目录和未结束的任务（`workItems.agentPreset`） | `presetUses` | `names unfinished tasks as well as sessions…` |
| G8 | 修复 | Host 在 `registerRevision` 和启动重放时检查 `kit.missing()`，缺执行器的修订状态为 `unavailable`，注册被拒；已注册修订的执行器消失时会撤销内存注册但保留 selection，扩展晚到时自动按原选择注册。Binder 同时撤下存活 Agent 上的旧执行器并挂载 replacement | `host-agent-assembly.ts`、`host-agent-assembly-service.ts`、`host-agent-kit-binder.ts` | `refuses to register…`、`withdraws a registered revision…`、`withdraws and remounts existing agents…` |
| G9 | 接受 | 白名单同步仍在抽屉里进行；它现在只影响工具集成页的展示，运行时以 G1 的挂载为准 | — | — |
| G10 | 接受 | 新字段是向前不兼容的，18.6 拒绝导入含 Agent 的模板包，写入 CHANGELOG | — | — |
| 新增 | 修复 | 本地 Agent 文件解析改为严格校验：未知字段、非法基础模式、非法访客权限、非字符串数组项一律拒绝，不再静默修正 | `parseAgentDefinition` | `rejects a stored definition instead of repairing it` |
| 新增 | 修复 | 目录变化后清理已永久删除工作台的内存状态；先销毁已注册 preset，再删除 rows，避免删除后无法恢复或重新操作 | `host-agent-assembly.ts`、`host-agent-assembly-service.ts` | `purges registered presets when their workbench is permanently removed` |
| 新增 | 修复 | Tool/Skill 的贡献 ID 与 `moduleId` 不一致时拒绝注册，防止 AgentKit 挂载到其他扩展的执行器；MCP/CLI 保持原有网关契约 | `tool-gateway.ts`、`host-agent-kit.ts` | `accepts all four tool kinds and rejects invalid identity` |

仍需实机：G3 冷启动；G1 用一个真实扩展注册执行器后，Agent 能调用、其他模式看不到；G2 第二设备上的原生选择器。

