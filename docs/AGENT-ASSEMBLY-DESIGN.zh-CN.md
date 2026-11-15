# 专用 Agent 组装设计（草案，历史模型）

2026-11-15 · 讨论稿（实现以 `AGENT-ASSEMBLY-AUDIT.zh-CN.md` 为准，当前候选 `0.2.2-alpha.18.7`）· 起草时基于 Core `0.2.2-alpha.18.6`（分支 `codex/dsh-0.2.2-rc2-adaptation`，提交 c5d3ed8）、DSH `0.2.2-rc.2`

## 1. 目标

内页扩展在开发时同时交付三样东西：给人用的界面、给 Agent 调用的工具、告诉 Agent 怎么用的 skill。工作台可以把这些扩展组装成专用 Agent，组装方式有两种：组长手动组装，或 Bay Agent 提出组装方案、组长确认。

同一份业务数据，人可以在内页里直接操作，Agent 也可以通过工具操作。Agent 不需要虚拟机，因为它操作的是结构化业务对象，不是屏幕。

不在本设计范围内：云端运行、IM 接入、组员自建 Agent。

## 2. DSH rc2 机制核实

| 问题 | 结论 | 依据 |
| --- | --- | --- |
| 运行时能否注册 Agent 模式 | 能。`presets.register(definition)` 在进程内创建隔离的插件树，返回注销函数。Bay Agent 自己就是这样注册的 | `dsh-agent-preset-registry/src/index.ts:97`；`host-bay-agent.ts:145` |
| 注册能否持久 | **不能。** 注册表不写入任何声明，只存在内存里。重启后要重新注册 | 注册表 README："注册表不写入任何声明" |
| 重启后旧会话怎么办 | 会话日志只记录 preset ID，恢复时按 ID 找当前定义，**找不到就拒绝恢复** | 注册表 README "理解实现" |
| 能否修改已注册的模式 | 不能就地修改，ID 重复会报错。要先注销再注册，形成新代际；已经在跑的 Agent 继续用旧代际 | `index.ts:100`、README |
| 模式由什么组成 | Cordis 插件行（`name` 是插件包名），可嵌套 `cordis:group` | `definition.ts:5` |
| 工具怎么进入 Agent | 插件调用 `ctx.tools.register()` 后，schema 自动进入提示词。注册在 preset 内的插件只对该 preset 可见；在 Host 全局注册的对所有 Agent 可见 | `dsh-tools` README "注册工具"、`dsh-skill` README 第 84 行 |
| 能否按 Agent 收窄工具 | 能，有两种方式：`ctx.tools.restrict(filter)` 对单个 Agent 加允许/拒绝掩码；`register(def, { when })` 在每个模型步骤计算条件，返回 false 就从描述和执行集合里排除 | `dsh-tools` README "按 agent 限制工具"、"条件工具" |
| skill 怎么进入 Agent | 插件调用 `ctx.skills.register()` 注册内存 skill，按 scope 分层：Host 全局层或 preset 层 | `dsh-skill` README 第 52、84 行 |
| 是否是安全边界 | **不是。** preset 和插件都能执行 Host 代码。权限仍靠 DSH 的允许/拒绝/询问策略和审批 | 注册表 README "已知限制" |

**结论：** 第 2 步是"接线"，不需要绕路。但有两个约束必须在设计里处理：

1. 组装出来的模式要由 Core 在启动时、在会话恢复之前，从工作台文件重新注册。否则重启后用过这个模式的会话无法恢复。
2. 修改一个已组装的 Agent 就是一次新注册。正在跑的任务保持旧版本，新任务才用新版本。

## 3. 现状

| 部分 | 状态 | 位置 |
| --- | --- | --- |
| 工具贡献数据结构 | 已有：schema、所需权限和凭据、关联内页 | `tool-gateway.ts:61` `ToolContributionV1` |
| 内页声明提供的工具 | 已有类型：`provides.{mcp,cli,tool,skill}` | `tool-gateway.ts:103` `ContainerEditorContributionV1` |
| 工具网关（可见性、按 Agent 白名单、调用记录、用量） | 已有，有测试和设置界面 | `tool-gateway.ts`、`tool-gateway-usage.ts`、`WorkbenchToolGatewayDialog.tsx` |
| 网关的生产使用 | **没有。** 生产代码里没有调用 `register` 注册工具；`projectForAgent`、`setAgentAllowlist` 没有消费方。网关白名单没有被执行 | `apply-core.ts:181` 只创建网关 |
| Worker 实际能用的工具 | 完全由 DSH preset 决定 | `host-bay-agent.ts:123` |
| Bay Agent 选模式 | 已有：按模式描述自选，不写死映射 | `host-bay-agent.ts:506` |
| 扩展规范中的工具与 skill | **没有。** 规范和模板只覆盖界面 | `presets/workbench-creator/skills/workbench-extension-development/` |
| Agent 定义资产 | 没有 | — |

## 4. 设计

### 4.1 扩展的三件套结构

扩展内部分四层。人和 Agent 走同一个动作层，避免两边逻辑不一致。

```
状态 / 业务对象（带 schema）
   ↑
动作层：纯函数，读、改、校验
   ↑                 ↑
界面调用          工具调用（schema + 权限声明）
                      ↑
                   skill（何时用、步骤、验收要点）
```

扩展的 Workbench 声明增加一个 `agentKit` 段：

```ts
interface WorkbenchEditorAgentKitV1 {
  /** 扩展提供的工具；id 在扩展内唯一，运行时加 moduleId 前缀 */
  readonly tools: readonly {
    readonly id: string
    readonly description: string
    readonly input: JsonSchemaNode
    readonly output?: JsonSchemaNode
    /** 只读工具可默认开放给访客；写入类工具默认需要审批 */
    readonly effect: 'read' | 'write' | 'external'
    readonly permissions?: readonly string[]
  }[]
  /** 随扩展发布的 skill，SKILL.md 相对路径 */
  readonly skills: readonly { readonly name: string; readonly path: string }[]
  /** 这个扩展的工具操作的业务对象类型，供组装时匹配 */
  readonly objectTypes?: readonly string[]
}
```

工具的实际执行放在扩展的 Host 插件里，通过 `ctx.tools.register()` 注册，名字用 `<moduleId>.<toolId>`。skill 通过 `ctx.skills.register()` 注册。

**为什么工具在 Host 全局注册，而不是放进每个 preset：** 扩展只装一次，可以被多个组装出来的 Agent 共享，Core 不需要知道扩展的插件包名就能组装。代价是全局可见，所以必须配合 4.3 的收窄机制。

SKILL.md 沿用开放格式，并要求包含：何时使用、步骤、验收要点、不要做的事。

### 4.2 Agent 定义资产

组装结果是工作台里的一个普通 JSON 文件，例如 `.bay/agents/<agentId>.json`，随工作台导出，可以放进模板包。

```ts
interface WorkbenchAgentDefinitionV1 {
  readonly schemaVersion: 1
  readonly agentId: string            // 工作台内唯一
  readonly name: string
  readonly description: string        // Bay Agent 选模式时读这一段
  readonly basePreset: string         // 例如 'standard'
  readonly tools: readonly string[]   // '<moduleId>.<toolId>'
  readonly skills: readonly string[]
  readonly instructions?: string      // 追加的模式指令（SOP）
  readonly acceptance?: readonly string[]  // 验收样例 id
  readonly guestAccess: 'none' | 'read-only' | 'approved'
  readonly revision: number
  readonly origin: { readonly kind: 'manual' | 'bay-proposal'; readonly approvedBy?: string; readonly approvedAt?: string }
}
```

运行时映射：

- **preset**：Core 注册 `bay:<workbenchId>:<agentId>@<revision>`。插件行是 `basePreset` 的组成加上一行 Core 提供的 `workbench-agent-kit` 插件，这一行负责注入 `instructions`。
  - 注意：`presets.read` 返回的是 entry-list YAML 文本，含 `!!js` 条件表达式（`dsh-agent-preset-registry/src/types.ts:28`），不是结构化插件行。复制基础模式需要按 Cordis loader 的 YAML 方言解析，并保留 `!!js` 表达式原样。
  - 风险更低的做法是第一版不复制任意模式，只支持 Core 自己维护插件行的少数基础模式（例如与 Bay Agent 同构的标准组成），在步骤 3 前确定。
- **工具收窄**：`workbench-agent-kit` 插件在该 preset 的 Agent 上调用 `ctx.tools.restrict()`，只放行 `tools` 列表中的扩展工具（扩展工具以外的 DSH 原生工具不受影响）。网关白名单 `setAgentAllowlist(agentId, tools)` 与这份列表保持一致，作为界面显示和审计记录。
- **启动顺序**：Core Host 在会话恢复前，从所有工作台的 `.bay/agents/` 读取定义并注册。缺少扩展的定义标记为"不可用"并显示原因，不注册半残的模式。

**为什么 preset ID 带 revision：** DSH 不允许同 ID 重复注册。带 revision 后修改就是注册一个新 ID，旧会话仍能按旧 ID 恢复。旧 revision 在没有会话引用后再注销。

### 4.3 网关接线

现在的网关只有数据，没有执行。接线分三步：

1. 扩展启用时，Core 从 `agentKit` 读出工具，调用网关的 `register(ToolContributionV1)`；扩展停用或撤销时注销。
2. 扩展工具注册到 DSH 时带 `when` 条件：查询网关 `projectForAgent(agentId)`，不在允许范围内就排除。这让网关的可见性和白名单真正生效，也覆盖普通 Worker 和用户手开的会话。
3. 工具调用经过 `beginInvocation` / `completeInvocation`，用量页面就有真实数据，组长复盘也有素材。

### 4.4 手动组装

在工作台设置中加"专用 Agent"页：

1. 选基础模式；
2. 从当前工作台已启用扩展的 `agentKit` 中勾选工具和 skill，界面上标出每个工具的 `effect`；
3. 填写名称、描述、模式指令；
4. 选择验收样例，点"试跑"，在临时会话里逐个回放；
5. 保存后生成 Agent 定义文件，注册 preset。Bay Agent 派活时就能看到这个模式。

### 4.5 Bay Agent 自动组装

给 Bay Agent 加工具 `bay_propose_agent`：

- 输入：任务描述。Bay Agent 读取当前工作台扩展的 `agentKit`（工具描述、`objectTypes`、skill 摘要），提出一份 Agent 定义草稿和理由。
- **只能提议，不能生效。** 草稿以决策卡片的形式推给组长，可以选择接受、修改后接受或拒绝。组装等于授权，所以必须由人确认。
- 接受后走 4.4 第 5 步；记录 `origin.kind = 'bay-proposal'` 和批准人。

### 4.6 访客与权限

- 局域网访客通过 Bay Agent 派活时，只能用 `guestAccess` 不是 `none` 的 Agent。
- `read-only` 只放行 `effect: 'read'` 的工具；`approved` 放行写入类工具，但每次调用都走 DSH 的询问审批，由房主确认。
- `external`（发网络请求、调用外部程序）默认不给访客。
- 这些规则在 4.3 的 `when` 条件里执行，同时保留 DSH 原生的允许/拒绝/询问策略。preset 不是沙箱，不能只靠它。

## 5. 分步计划

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| 1 | 规范和模板加入 `agentKit` 和四层结构；检查器校验工具 schema、skill 文件和 `effect` 声明；写一个示例扩展（报价单内页） | 示例扩展的界面和工具改同一份数据，两边结果一致 |
| 2 | 网关接线（4.3） | 关闭某工具的可见性后，Worker 会话看不到这个工具；用量页有调用记录 |
| 3 | Agent 定义资产、启动时注册、手动组装页（4.2、4.4） | 组装出的 Agent 只看到选中的扩展工具；重启后用过它的会话能恢复；修改后旧任务不受影响 |
| 4 | `bay_propose_agent` 和决策卡片（4.5） | 提议不经确认不生效；接受后可被派活 |
| 5 | 访客规则（4.6） | 双设备实测：访客只能用开放的 Agent，写入类工具需房主审批 |

步骤 1 和 2 是基础，可以并行开发。

## 6. 待确认

1. **Agent 定义放在哪里**：`.bay/agents/` 随工作台走，还是放进 Profile。建议随工作台走，因为它是要导出和复用的资产。
2. **只放开 Agent 的扩展工具，还是同时收窄 DSH 原生工具**（文件、终端、网络）。建议第一版只管扩展工具，原生工具沿用基础模式和 DSH 权限预设。
3. **旧 revision 何时注销**：建议在没有会话引用且超过 7 天后注销。
4. **扩展工具全局注册**会让所有 Agent 都看到它们，除非 `when` 条件排除。需要实测条件工具对提示词缓存的影响：DSH 文档说明可见工具集合变化会影响 KV 缓存。
5. **基础模式怎么复制**：解析 `presets.read` 的 YAML 以支持任意基础模式，还是第一版只支持 Core 维护的几种（见 4.2）。建议后者。
6. 步骤 1 的示例扩展用哪个业务场景，等首个行业确定后替换。

## 7. 0.2.2-alpha.18.7 已实现的做法

本节记录实际落地的行为，和前文设计不一致处以本节为准。

实现校正：前文关于 `ctx.tools.restrict()`、`when` 条件和 Gateway 白名单作为运行时真源的描述属于早期设计，当前版本不采用这些路径。扩展 Host 插件通过 `workbenchAgentKit` 注册带 `moduleId.` 前缀的工具和 Skill，`host-agent-kit-binder.ts` 在每个存活 Agent 自身的 scope 中挂载当前 preset 选中的条目；执行器变化时会撤下并重新挂载。Gateway 继续负责目录、策略投影和审计数据，不负责 AgentKit 工具执行。Agent 文件使用 `.bay/agents/<agentId>@<revision>.json`，旧的单文件名仅作读取兼容。

- **文件**：每个修订一个文件，`.bay/agents/<agentId>@<revision>.json`。旧的 `<agentId>.json` 仍能读取，不再写入。文件名和文件内的标识或修订不一致时忽略该文件，防止复制改名后注册出旧 ID。
- **注册由人决定**：保存只写新修订，不注册。抽屉列表里每个修订有“注册 / 取消注册”按钮，选择写入 `.bay/agents/selection.json`，Host 启动时按它重新注册。同一个 Agent 可以同时注册多个修订。
- **取消注册的提醒**：如果会话目录里还有会话指向这个修订，取消后列出这些会话的标题，提示恢复前需要重新注册。文件保留，操作可撤回。
- **不可用**：修订引用的工具已不在当前工作台工具目录时显示“不可用”和缺少的工具，不能注册；已注册的仍可取消注册。
- **派活范围**：Bay Agent 派活和 `bay_inspect` 只列 DSH 自带模式和当前工作台已注册的专用 Agent。局域网访客发起的请求再排除 `guestAccess` 为 `none` 的 Agent。
- **浏览器和局域网**：两者都运行在房主的 Host 上，已注册的模式直接可用。访客只能读取列表，不能保存、注册或导出。
- **完整包（V6）**：`.bay/agents` 随文件树复制。导入发布后先把复制的 `selection.json` 转成 `suggested.json` 并清空选择，不自动注册；接收方逐个确认后再注册，无需重启。工作台换了新 ID，所以会话目录、会话头、`agent-preset/selected` 事件和任务快照里的 `bay:<旧ID>:` 都改写为 `bay:<新ID>:`。
- **模板包（V4）**：导出时把全部修订和注册选择放进 `workbench.json` 的 `agents` 字段，包签名覆盖它。导入时严格校验字段，在新文件夹写入修订并把来源选择写入 `suggested.json`，不自动注册；接收方逐个确认后再注册。工具白名单属于工作台策略，在接收方打开 Agent 组装抽屉时按已注册修订补齐。
