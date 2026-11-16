# Workbench 容器内页扩展插件开发规范

更新时间：2026-11-11（文档与引用复核；未改变接口版本）
规范版本：1.1
适用基线：Workbench Core `0.1.0-beta.1`、DSH `0.2.2-rc.2`（commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`）
状态：**Core 接口与自动化合同说明；正式桌面扩展生命周期验收仍未完成**

本文是开发新的 Workbench 容器内页扩展时的主规范。可安装的主模板位于 `packages/workbench-core/presets/workbench-creator/skills/workbench-extension-development/templates/workbench-editor/`，Session 变体位于相邻的 `templates/workbench-editor-variants/session-client.js`。若模板与本文不一致，以对应目标 Core/DSH 版本的公开导出、类型、测试和锁定文件为准；不要复制本文以外版本的 Slot 参数或 API。

## 1. 产品与技术边界

容器内页扩展是一个**标准 DSH 插件**，在 DSH 插件包内额外声明 Workbench 能识别的编辑器合同。它不是独立于 DSH Plugin Manager 的第二种安装包，也不是 Workbench Core 内置代码。

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| DSH Plugin Manager / Host | 插件安装、更新、DSH 原生启停、卸载、权限、加载和重启 | Workbench 区域布局和内页许可 |
| Workbench Core | 检测 DSH 插件、精确核对来源、校验声明/兼容性、保存本 Profile 的接入许可、提供内页 Slot 和 owner 上下文、协调内页生命周期 | 安装插件、写 DSH Profile、创建第二套 Session owner、提供代码安全沙箱 |
| 扩展插件 | 注册声明过的内页，用 Core 传入的 owner 执行自身 UI 和功能 | 绕过 DSH 权限、猜全局 Session、接管官方页面或静默创建资源 |
| 工作台布局 | 保存区域中的内页引用、顺序、绑定与受限 JSON 状态 | 安装、启用或卸载扩展 |

所以扩展必须先通过 DSH 原生流程安装并在同一 Profile 中运行；Workbench 设置中的“允许使用”再单独允许其向 Workbench 提供内页。Core 的允许开关只是接入许可，不是 DSH 启用开关，也**不是安全沙箱**。同进程中已加载的 DSH 插件代码不因 Core 撤销许可而变成隔离状态。

## 1.1 v0.1 工作台、区域项目与多会话

v0.1 的持久关系是：

```text
Workbench 根目录
  ├─ Project → 稳定 projectId、根内目录、背景、记忆、会话与任务
  ├─ Area → Project 的临时展示空间（允许零个或多个）
  │          └─ 多个独立 Session → 各自的内页实例
  └─ Bay Agent Main → 工作台根目录
```

- Workbench 创建时拥有根目录及 Project 登记；Area 关联 projectId。多个 Area 展示同一个 Project 时共享背景、记忆、会话和任务，独立保存布局与内页。关闭 Area 移除该区域身份；再次打开 Project 创建新 Area，只显示项目概览，不自动打开旧内页或继续任务。
- Area 不再绑定一个代表 Session。一个 Area 可以同时包含多个对话，内页仍然一个实例绑定一个具体 Session。
- Session 内页必须使用 Core owner 传入的 `workspaceId` 和 `sessionId`。`workspaceId` 是该 Session 对应的 DSH 项目工作区身份，不能由 Area 顺序、当前焦点、标签标题或全局当前 Session 推断。
- 移动内页、在浮动工作区固定/取消固定、切换标签或从 DSH 原版模式返回，都不能改写内页的 Session 来源。只有明确的绑定代际变化才释放旧资源。
- 扩展不能把 Workbench 根目录、绝对路径、机器专属 Workspace ID、Session transcript 或凭据写入可迁移状态。项目文件、终端和对话资源必须通过公开 DSH/Workbench 适配器访问。
- 打开内页、缺少绑定或恢复布局不能隐式创建 Session。需要新对话时只能调用 Core owner 提供的显式创建/绑定入口，并保存返回的绑定身份。

扩展制品与完整工作台包分工不同：扩展制品只携带自己的运行文件和受限内页状态；完整工作台包负责携带根目录文件、区域项目、原生 Session、附件、背景、记忆、任务和编排关系。离线导出只有在扩展依赖可嵌入并通过校验时，才会把扩展制品放入完整工作台包。

## 2. 当前支持范围

- 编辑器渲染 Slot 只支持 `workbench.editor.root` 和 `workbench.editor.session`，对应 `scope: 'root' | 'session'`。
- 模块激活范围是另一维，可为 `root`、`session` 或 `area`。`activation.scope: 'area'` 不代表可以声明 `editor.scope: 'area'`。
- 需要当前 Area 的 Workspace/Session 时，使用 `workbench.editor.session`，并只读 Core 提供的精确 owner 身份。
- 不依赖绑定的工具可以使用 root Slot；打开内页不自动创建 Session。
- 每个 DSH 插件可以提供一个或多个不同 `editorId`。同一插件的每个 Slot 声明重复携带同一个完整扩展身份和完整 editor ID 集合。
- 可声明对话资源路由，但它只描述 Core 可识别的路由，不代表该路由已在真实桌面宿主验收。

不得注册或覆盖 DSH 官方 `root`、`layout.frame`、`main`、`main.conversation`、Sidebar、标题栏等 owner。Workbench 内页必须通过公开 Workbench editor Slot 以附加方式参与。

## 3. 身份合同

DSH Slot 的 `registrant` 必须精确映射到 DSH runtime 插件和已安装 bundle。Core 的核验关系为：

```text
Slot registrant
  -> 唯一 DSH pluginInventory.list() runtime 行
  -> runtime entryId + moduleName
  -> 唯一 pluginManager.listBundles() bundle row
  -> extension.moduleId 与 Workbench consent
```

Core 不以显示名、模糊包名或时间戳猜归属。缺少 `entryId`、映射冲突、重复 runtime/bundle 认领、清单暂不可读都会 fail closed：扩展不进入“添加内页”，并保留诊断原因。

以下名称应按用途区分，并按本模板保持精确一致：

| 身份 | 含义 | 本模板要求 |
|---|---|---|
| `package.json.name` | DSH 包的 JS module specifier | 示例为 `@local/workbench-editor-example` |
| DSH bundle patch row `name` | 交给 DSH 加载器的 module specifier | 与 `package.json.name` 完全一致 |
| Client 插件对象 `name` | Cordis runtime `moduleName` | 与包名完全一致 |
| Slot `registrant` | 声明此 slot 的 DSH runtime 插件身份 | 显式设置为同一包名；不要依赖嵌套时继承的 Fiber 名称 |
| DSH runtime `entryId` | DSH 加载实例标识 | 由 DSH 生成；扩展不能自选或伪造，用于 Core 精确映射 |
| `dsh.workbench.moduleId` / runtime `extension.moduleId` | Workbench 稳定扩展身份 | 两处完全一致，升级/改显示名时保持不变 |
| `editorId` | 某个具体内页的稳定身份 | manifest、Slot id 和完整 `extension.editorIds` 一致且唯一 |

身份不一致时不要尝试修改 Core 数据或手动写 Profile；先检查实际加载的包名、DSH bundle row、Slot `registrant` 和运行时 `moduleName`。

## 4. DSH 插件包结构

可安装包需采用当前 DSH 支持的 Bundle / Client Plugin 结构。仓库模板至少包含：

```text
my-workbench-extension/
├── package.json
├── cordis.patch.yml
├── index.js
└── client.js
```

- `package.json` 的 `dsh.bundle.patch` 指向 patch 文件。
- `dsh.client` 声明网页 Client 插件入口、注入的 Slot API 包和加载策略。
- `cordis.patch.yml` 注册 DSH bundle row。
- `client.js` 通过 DSH Client Module Loader 导出插件；Slot 注册必须使用当前 DSH/Workbench 公共 Slot API。
- `index.js` 是 DSH Bundle 入口，内容按该 DSH 版本的官方插件规范实现。不要从其他代际包复制入口内容。

模板当前的关键清单形状如下。实际扩展必须把所有示例身份、版本和声明替换成自身值，并用目标版本验证：

```json
{
  "name": "@example/my-workbench-extension",
  "version": "1.0.0",
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-slots"]
    },
    "workbench": {
      "schemaVersion": 1,
      "moduleId": "example.my-extension",
      "kind": "extension",
      "delivery": "direct-source",
      "version": "1.0.0",
      "coreCompatibility": ">=0.1.0-beta.1 <0.1.1",
      "dshGeneration": "0.2.2-rc.2",
      "activation": "restart-only",
      "scope": "root",
      "editorIds": ["example.my-extension.main"],
      "permissions": [],
      "requiredCapabilities": [],
      "editors": []
    }
  }
}
```

`dsh.workbench` 是包内的可发现描述，不会代替 runtime Slot 合同。当前 Core 的身份接入主要读取活跃 Slot 的 `inject()` 元数据，并与 DSH inventory 对照。包声明中的 editor list 和 runtime list 必须保持一致；Core 不会因为 npm 清单里出现 `moduleId` 就推断插件已安装或已启用。

DSH 权限和 Workbench 声明中的 `permissions` / `requiredCapabilities` 应按实际功能最小化。它们是依赖/能力描述，不是自行授予权限；实际 DSH 权限仍由 DSH Plugin Manager/Host 管理。当前 Core 的 identity check 不提供发布者签名、artifact digest 校验或安全沙箱证明。

## 5. Slot 注册和元数据保留

DSH `SlotCore` 会规范化并只保留已知 Slot option。把自定义 `declaration` 或 `extension` 直接放在 `ctx.slots.register({ ... })` options 上会被丢弃，Core 就读不到合同。

必须通过 Slot 保留的 `inject` 面返回 `workbenchEditor`：

```js
const packageName = '@example/my-workbench-extension'
const declaration = {
  editorId: 'example.my-extension.main',
  scope: 'root',
  label: '示例扩展',
  requiredBinding: 'none',
  binding: { requirement: 'none', unbound: 'available', sharing: 'none' },
  state: { schemaVersion: 1, maxBytes: 16384, restore: 'if-valid', share: 'portable' },
  runtime: { background: 'pause', collapsed: 'dispose', reacquire: 'on-visible' },
}
const extension = {
  schemaVersion: 1,
  moduleId: 'example.my-extension',
  apiVersion: 1,
  editorIds: ['example.my-extension.main'],
  coreCompatibility: '>=0.1.0-beta.1 <0.1.1',
  dshGeneration: '0.2.2-rc.2',
}

return {
  name: packageName,
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('workbench.editor.root', () => ctx.slots.register({
      name: 'workbench.editor.root',
      id: declaration.editorId,
      label: declaration.label,
      order: 500,
      registrant: packageName,
      inject: () => ({ workbenchEditor: {
        schemaVersion: 1,
        declaration,
        extension,
        presentation: { icon: 'extension' },
      } }),
    }, Editor))
  },
}
```

多内页扩展的每个 Slot 都应提供完整相同的 `extension` 身份，其中 `editorIds` 列出该扩展全部 editor ID；每个 Slot 自己的 `declaration.editorId` 与 Slot `id` 一致。

### 每个内页的 SVG 图标

新建或更新内页时，必须提供与功能对应、在小尺寸仍可辨认的 SVG 图标。同一扩展中的不同内页也应有可区分的图形；不要给所有内页复制同一个通用拼图图标。图标是小空区域中识别内页的主要线索。

在同一 `workbenchEditor` metadata 中声明 `presentation.iconSvg`。它是受限的路径描述，不是完整 SVG 字符串：

```js
presentation: { iconSvg: { version: 1, paths: [
  'M7 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  'M3 7h4M3 12h4M3 17h4M10 8h7M10 12h7M10 16h4',
] } }
```

上例是笔记本图形；请按内页功能重新设计，不能仅替换名称。Core 统一使用 `viewBox="0 0 24 24"`、无填充、`currentColor` 描边、圆角端点和转角；图标应留出边缘余量，避免过密细节。路径只允许 M/L/H/V/C/S/Q/T/A/Z 命令，每个路径最多 1024 字符，总计最多 4096 字符，最多 12 个路径。拒绝 SVG 标记、样式、事件、颜色、外部链接和图片；禁止 `innerHTML`。

开发时可用 Core client 导出的 `normalizeWorkbenchEditorSvgIcon()` 校验，返回 `undefined` 表示描述无效。校验通过只表示结构安全，不能代替视觉验收。必须验证 16/20/24px、浅色/深色主题、仅图标状态，以及悬停和键盘聚焦时名称可读。相同图标用于空区域、标签、添加/替换菜单、区域预览和设置目录。

原有 `presentation.icon` 语义 token 继续兼容：`plus-message`、`message`、`trajectory`、`folder`、`terminal`、`browser`、`file-preview`、`changes`、`plan`、`schedule`、`guide`、`subagent`、`tool`、`extension`、`panel`。官方内页使用对应的独立语义图形。旧扩展没有有效图标时，Core 根据插件和内页身份生成稳定的几何回退标识，保留使用能力；该标识不保证功能语义或全局唯一性，也不满足新扩展的图标设计验收要求。

## 6. 扩展声明字段

### Runtime `extension`

| 字段 | 约束与用途 |
|---|---|
| `schemaVersion` | 当前固定为 `1`。 |
| `moduleId` | 稳定且唯一的扩展 ID，格式受 Core validator 限制；升级时不随显示名称变化。 |
| `apiVersion` | 当前固定为 `1`。 |
| `editorIds` | 1 至 32 个合法、唯一 ID；必须等于该插件实际注册的 Workbench editor ID 集合。 |
| `coreCompatibility` | 非空、最长 128 字符的 Core 兼容范围；当前实现支持精确版本和比较范围。同一 Beta 兼容线也会接纳此前的精确版本声明。 |
| `dshGeneration` | 非空、最长 64 字符的 DSH 代际；当前实现按目标 DSH generation 精确匹配。 |

### Editor `declaration`

| 字段 | 约束与用途 |
|---|---|
| `editorId` | 必须与 Slot `id` 一致，并属于 `extension.editorIds`。 |
| `scope` | 仅 `root` 或 `session`，必须与注册的 Slot 一致。 |
| `label` | 非空用户可见名称，最长 256 字符。 |
| `requiredBinding` | `none`、`workspace`、`session`；保留为兼容的简写字段。 |
| `binding` | 可选的完整绑定策略；若提供，`requirement` 必须与 `requiredBinding` 一致。新扩展建议始终提供。 |
| `state.schemaVersion` | 正整数；扩展状态 JSON 的版本。 |
| `state.maxBytes` | 1 到 262144 字节；写入、分享导入/导出及挂载现存本机状态时受 Core 限制。 |
| `state.restore` | `always`、`if-valid`、`never`。当前表示**分享包导入时**是否恢复扩展状态，不定义本机布局恢复策略。 |
| `state.share` | `portable`、`reference-only`、`forbidden`，见下文分享规则。 |
| `runtime.background` | 内页所在区域可见但不活跃时的 `keep`、`pause` 或 `dispose` 策略。 |
| `runtime.collapsed` | 区域收起时的 `keep`、`pause` 或 `dispose` 策略。 |
| `runtime.reacquire` | `on-visible` 或 `on-activate`，用于决定何时重建已释放的视图资源。 |
| `conversationResources` | 可选的对话资源路由声明，见第 11 节。 |

Core 对 Slot metadata 做运行时校验。声明无效、ID 冲突、扩展内声明不完整或来源身份不唯一时，失败的扩展不会进入可用目录；其他扩展仍可继续发现。

## 7. 渲染 scope、绑定和未绑定行为

`scope` 决定扩展注册到哪个 Workbench Slot；绑定则说明该内页是否需要区域资源。二者相关但不等同。

| 需求 | Slot / scope | 建议声明 |
|---|---|---|
| 独立工具，不读当前对话或 Workspace | `workbench.editor.root` / `root` | `requiredBinding: 'none'`, `binding.requirement: 'none'`, `unbound: 'available'`, `sharing: 'none'` |
| 需要工作区上下文但不需要具体 Session | 当前公开合同没有独立 Workspace Slot；按目标版本公开 owner 能力选择 session Slot 并允许无 Session pending，或等待 Core 增加明确 Workspace-only 合同 | 不得假设 root owner 能取得 Workspace |
| 需要所属 Area 的 Workspace 和确切 Session | `workbench.editor.session` / `session` | `requiredBinding: 'session'`, `unbound: 'pending'`, v0.1 使用 `sharing: 'independent'` |
| 需要扩展自己挑选或创建的资源 | 只使用已公开且显式授权的 Core API | 不可仅凭 `binding.sharing: 'independent'` 就假定存在创建 API |

`binding` 的字段含义：

- `requirement`: `none`、`workspace`、`session`。Core 按此合同决定是否需要绑定。
- `unbound`: `available` 表示未绑定也能工作；`pending` 表示显示等待资源/操作；`hidden` 表示在缺少资源时不提供入口。pending 不等于自动创建。
- `sharing`: `none`、`area`、`independent` 是宿主声明枚举。v0.1 的 Session 内页使用 `independent`，每个内页明确保存自己的来源对话；无绑定内页使用 `none`。`area` 仅作为旧声明字段保留，不允许据此读取区域首个对话或批量重绑。区域保存项目目录；切换标签、移动视图不更改会话与任务归属。

项目内页使用 `owner.projectId`；无 Session 的项目页也能取得它。Area ID 只表示展示位置，不能作为背景、记忆或任务持久化主键。浮动 Session 页从其精确 Workspace 解析项目；Main 和全局内页可没有 projectId，不能自行猜测。

Core 传给编辑器的 owner 可能包含 `instanceId`、`areaId`、`projectId`、`workspaceId`、`sessionId`、`bindingGeneration`、`areaClaim`、`state`、`lifecycle` 以及受支持的回调。session 编辑器只使用当前实例传入的精确 ID。空 `sessionId` 时应渲染声明的 pending/恢复 UI，不要查全局 current Session、扫描 Session 列表或根据焦点/区域顺序猜测。

异步读取内容时使用 `owner.renderLoading?.({ label: '内容名称' })` 返回 Core 的统一加载画面；列表局部读取可传 `compact: true`。它自动沿用工作台主题和内页图标，无需引用 Core 内部文件或复制 CSS。仅在实际请求未完成时显示，失败后展示错误和重试入口，不能把空结果、未绑定或永久缺失的资源当成加载。Core 也为使用 React.lazy/Suspense 的内页提供统一 fallback；扩展自行管理的请求仍需主动使用 `renderLoading`。已存在的输入组件和原生会话不能为展示过渡而反复卸载重建。

## 8. 状态、恢复与分享

扩展状态必须是小型、版本化、JSON-safe 数据。不要写入 DOM 节点、函数、循环引用、凭据、完整消息/对话历史、绝对路径、Profile 身份、进程句柄、实时连接或只能在作者机器工作的本地资源标识。

`owner.setState(nextJson)` 将状态交给 Core 持久化。扩展必须把 `maxBytes` 当硬预算，不要以高频逐 token、逐帧或大对象快照调用。页面关闭不保证未完成的异步副作用能成功保存；按公开 lifecycle 做清理，不要私自另存第二份布局事实源。

`state.restore` 当前只约束**导入分享包**：

| 值 | 导入行为 |
|---|---|
| `never` | 不调用扩展 import descriptor，导入为空状态。 |
| `if-valid` | 状态大小限制通过且 JSON 对象的 `schemaVersion` 与声明相等后才恢复。 |
| `always` | 不要求 schemaVersion 相等，但仍须是安全 JSON、通过大小限制，并通过可用的 import descriptor。扩展需自行兼容旧状态。 |

这不是本机工作台恢复开关。本机布局会保留状态与内页引用；如果保存值超过当前声明上限，Core 阻止该内页挂载并展示清空状态后继续的恢复操作。不要把 `restore: 'never'` 误解为本机启动时清除状态。

| `state.share` | 分享导出/导入行为 |
|---|---|
| `portable` | 允许在尺寸/schema 检查和 portability descriptor 转换后传输状态。只包含接收方可安全使用的数据。 |
| `reference-only` | 可分享布局引用，但不导出或导入扩展状态；即使提供 descriptor 也不能绕过。 |
| `forbidden` | 不通过 Workbench 分享包传输该内页状态。 |

Portability descriptor 是运行时函数，不会序列化进包。descriptor 的输入/输出都必须是有限 JSON，且输出继续受 `maxBytes` 限制。接收方重新绑定自己的 Workspace/Session；扩展不得从作者机器复制绑定身份。

### 8.1 与完整工作台包的关系

扩展状态分享和完整工作台迁移是两个层次：

| 内容 | 扩展分发制品 | 完整工作台包 V6（读取器继续支持当前 v0.1 V5） |
|---|---|---|
| 扩展 `package.json`、Client/Host 入口、Bundle patch、许可证 | 必须由 `distribution.runtimeFiles` 精确列出 | 按 `embed`、`reference`、`forbid` 策略记录制品锁；仅 `embed` 随 V6 离线携带 |
| 内页的受限 JSON 状态 | 由 `portability.exportState/importState` 转换 | 随布局和内页引用恢复 |
| 工作台根目录、区域项目文件和空目录 | 不包含 | 包含全部工作文件，按导出排除项报告处理 |
| 原生 Session、附件和子会话 | 不包含 | 由 Host 的原生 Session 迁移适配器收集和恢复，未知必要事件阻断 |
| 背景、记忆、Work Item、Assignment、Attention 和编排审计投影 | 不包含 | 随工作台定义和完整包作业恢复；导入任务保持待继续 |

因此，扩展的 `state.share: 'portable'` 只表示它的内页状态可以跨机器传递，不表示它可以读取或携带整个项目目录。接收方没有对应扩展、Core/DSH 版本不匹配或依赖没有嵌入时，完整包必须保留内页引用并显示待恢复原因，不能把扩展替换为空白页面后报告完整恢复。

#### 现有扩展升级与 V6 预检

发布更新包时递增 DSH `package.json` 版本并重算 artifact digest/integrity；包版本与内页状态 `schemaVersion` 独立。

V6 导出会先从当前运行时目录读取每个保留内页的声明和 portability descriptor，再创建 Host 导出作业。出现“缺少内页配置导出处理器”时，优先检查目标 `editorId`/`scope` 对应的**运行时 Slot 注册结果**：可迁移内页必须声明 `state.share: 'portable'` 并提供 `portability.exportState`；导入恢复还必须提供 `portability.importState`。仅在源码、静态 manifest 或未加载的更新包中实现处理器，不会通过当前运行时的检查。

升级已有扩展时应保留原 `packageName`、`moduleId` 和 `editorId`，除非明确进行破坏性替换。Creator 应从扩展实际的 `owner.setState()` 写入和既有布局状态中建立旧状态 fixture，确认字段用途后再实现转换：`exportState` 只输出接收方可用的白名单 JSON；`importState` 校验并迁移已支持的旧 schema，返回扩展当前页面可读取的状态。凭据、Profile/Session/Workspace 身份、本机绝对路径和活动句柄不得导出；需要本机服务的字段应在接收方保持未配置，并要求用户重新连接。

测试需覆盖旧状态和当前状态的往返、未知/损坏 schema、`maxBytes`、私密字段剔除以及真实运行目录可见处理器。候选扩展应在隔离 DSH Profile 安装并允许后，再通过 V6 页状态预检、Host 导出作业和干净接收 Profile 的恢复流程。无法安全投影的状态不得为了通过检查而强行声明 `portable`；应明确报告该页阻断完整包迁移的限制。

## 9. 生命周期和资源释放

Workbench 的视图生命周期与 DSH 后台任务生命周期是两回事。`background`、`collapsed` 和 `reacquire` 声明控制视图资源策略，不表示 Core 会取消 DSH 模型任务、终端进程或外部操作。

| 策略 | 扩展实现要求 |
|---|---|
| `keep` | 视图可以保留；仍需避免无意义轮询和昂贵刷新。 |
| `pause` | 监听传入 lifecycle，在隐藏/收起时暂停非必要订阅、动画或刷新；重新可见后校验快照再继续。 |
| `dispose` | 释放可重建的视图资源，清理监听和订阅；重建后从 Core owner 状态及 DSH 权威服务恢复。 |
| `on-visible` | 视图达到可见状态时重新获取需要的资源。 |
| `on-activate` | 只有内页重新激活时才重新获取资源。 |

`lifecycle.visibility` 可为 `visible`、`background`、`collapsed`，`lifecycle.focused` 与可见性分开。可见但未聚焦不代表后台；不应仅因失焦停止可见内容。卸载、撤销 Workbench 许可、Slot 移除和组件 unmount 时清理所有事件监听、计时器和订阅。延迟到达的回调应校验 `instanceId` 和绑定代际，避免旧实例更新新绑定。

关闭标签只关闭内页视图，不等于删除 DSH Session 或取消任务。若用户触发了真正的外部取消命令，必须由对应 DSH 原生 API 明确执行并给出结果。

## 10. 对话资源路由

确实需要接收对话输出资源的 editor 可在 `conversationResources` 中声明路由：

```js
conversationResources: [{
  resourceType: 'report',
  editorId: 'example.my-extension.main',
  resourcePatterns: ['dsh-resource://workbench-report/**'],
  defaultPlacement: 'activate-or-add',
}]
```

`resourceType` 必须符合 ID 规则、在该声明内唯一；`editorId` 必须等于当前声明；patterns 非空且每项最长 256 字符。`defaultPlacement` 为：

- `activate-or-add`: 激活当前 Area 已有目标内页，否则添加/打开。
- `new-tab`: 在当前 Area 新建标签。
- `replace-current`: 按 Core 当前命令语义替换目标内页。
- `official-sidebar`: 请求回退到 DSH 官方 Sidebar owner。
- `disabled`: 不由 Workbench 打开。

路由仍受用户全局对话资源设置、Area 身份和 Core 实际 opener 能力控制。只声明 pattern 不等于功能验收通过；必须用真实资源点击验证当前区域、加载、关闭和恢复行为。扩展不得直接接管 DSH 全局 Sidebar，也不得仅凭可构造 URL 访问任意本机文件。

## 11. 权限、能力和安全要求

- 只请求实现功能所需的 DSH 权限和能力，给每项写出用户可理解的理由。
- Workbench `permissions`、`requiredCapabilities` 是声明，不构成权限授予；DSH Plugin Manager/Host 才是授权权威。
- Workbench consent 只允许 Core 将声明的 contributions 纳入 Workbench；它不是代码执行隔离。任何 DSH 同进程插件都不应被当作不可信代码沙箱化运行。
- 不读取 DSH Profile 文件，不直接修改插件清单，不自行安装、更新、启停或卸载其他插件。
- 不访问 Core 私有 repository、内部 store、任意 Session 列表或官方全局 current Session。
- 不接管官方 Conversation、Root、Sidebar、桌面标题栏或其他插件 owner。
- 不把凭据、对话记录、绝对路径和进程/连接句柄写入 Workbench layout、分享包或日志。
- 当前身份校验能证明 DSH 公开 inventory 中的 runtime/bundle 精确映射，不证明发布者身份、代码签名或包字节完整性。不要在 UI 或文档中宣称已验签。

## 12. Core 接入许可和插件生命周期

标准使用流程：

```text
DSH Plugin Manager 安装标准插件包
→ 按 DSH 提示启用/重启
→ 确认同一 Profile 的 DSH runtime 和 bundle row 均存在
→ Core 发现 Slot 并核对 registrant、entryId、moduleName 与 bundle
→ Core 校验扩展身份、每个 editor 合同和 Core/DSH 兼容性
→ 用户在 Workbench 设置中明确允许
→ 扩展 editor 出现在可用内页目录
→ 用户把内页加入某个工作台区域
```

以下状态不能混为一谈：

| 用户操作 | 改变的对象 | 不会自动改变 |
|---|---|---|
| 允许/撤销 Workbench 使用 | Profile 内 Core consent | 不安装或启用/停用 DSH 插件；不删除布局引用 |
| 添加/移除内页 | 某个工作台布局 | 不安装、卸载 DSH 包；不影响其他工作台引用 |
| DSH 停用插件 | DSH runtime 状态 | 不应删除 Workbench consent、布局和可恢复状态 |
| DSH 卸载插件 | DSH 包可用性 | 不应静默清理 Workbench 布局引用 |
| 更新 DSH 包 | DSH 包版本和 runtime | 合同变化时 Core 可要求重新确认；失败时旧布局应保留 |

安装、启用、更新、停用、卸载、重装均由 DSH 原生 Plugin Manager 完成。Workbench Core 只读投影状态和单独保存 Workbench consent。Core 许可撤销、包停用或包缺失时，布局引用应保留并显示恢复说明；只有用户明确执行清理数据和所有引用的操作时才能删除它们。

## 13. 浏览器与桌面差异

扩展运行在 DSH 提供的 Client 环境中，Workbench 内页本身不应假定桌面 Electron preload 存在。文件系统、目录选择、进程、终端和 Browser 宿主能力必须通过当前 DSH 公共能力接口探测；浏览器环境不支持时给出受限/不可用 UI，不访问 Electron 私有对象或拼凑桌面全局变量。

依赖 Web API 的内页也要处理窄视口、页面隐藏、断线和重新挂载。不要把桌面端能跑推断为浏览器可用，或反过来。宿主能力必须逐项验收。

## 14. 开发、测试和交付步骤

1. 从当前 Creator 模板复制独立 DSH UI Plugin；替换 `package.json.name`、bundle row、Client 插件 `name`、Slot `registrant`、`moduleId` 和全部 `editorId`。
2. 按资源需要决定 root/session Slot；为每个 editor 填完整声明，并在 `package.json` 的 `dsh.workbench` 描述中镜像同一组身份与版本。
3. 使用目标 Core 发布的公开 client 类型与 validator。扩展插件启动时不得硬依赖 Core runtime 才能完成 DSH 插件加载；不要 import Core 私有 `src/` 路径。
4. 构建标准 DSH Bundle/Client Plugin。使用仓库/DSH 当前版本规定的命令，不从 Profile 目录直接运行 pnpm，也不手改 Profile 文件。
5. 自动化测试至少覆盖：身份同步和唯一性、Slot inject metadata 可读、无绑定/pending 行为、一个 Area 内多个独立 Session、精确 Area/项目 binding、状态 schema/字节限制、resource 路由、隐藏/收起/重新激活与卸载清理。
6. 对 `dsh.workbench.distribution` 运行精确 runtime file、静态依赖闭包和 `exportState/importState` 检查；使用 `offline-embedded` 生成工作台包，确认扩展制品带有 digest/integrity，而不是只写一个在线引用。
7. 在隔离 DSH 测试 Profile 中，经 DSH Plugin Manager 安装并启用；如需重启，等待完整重启后再验收。
8. 分别验证 DSH 清单/runtime 状态、Core 扩展中心状态、Workbench consent、实际添加/使用内页和布局恢复。遇到身份映射失败时记录 `registrant`、runtime `entryId/moduleName`、bundle row 和 Core 显示的 diagnostic code。
9. 关闭项目的全部 Area 后，完整包仍须包含该 Project 的文件与资料；关闭区域不是从包中排除项目。项目内部 `.bay/project.json`、`context.md` 与 `memory/` 由 Host 维护，不能作为扩展缓存排除。在干净接收环境中导入完整工作台包，验证根目录文件、区域项目、至少三个 Session、附件和扩展内页状态分别恢复；缺少扩展或环境时应保留待恢复状态，不自动创建替代 Session。
10. 记录包名、版本、Core/DSH 兼容声明、artifact SHA-256（若发布流程生成）、测试命令和逐项结果。只对真实完成的状态使用 `installed`、`active` 或 `desktop-verified`。

不要默认向用户活动 Profile 安装；测试 Profile 可以隔离数据但不是恶意代码沙箱。安装或运行插件可能具有 DSH 所授予的宿主权限。

## 15. 发布前验收清单

- [ ] 标准 DSH Plugin Manager 能发现和安装包；包名和 bundle row 一致。
- [ ] DSH 运行插件 `moduleName`、Slot `registrant` 和 bundle row 精确映射；Core 不显示身份未核实。
- [ ] `package.json` editor ID 集、runtime `extension.editorIds` 和实际 Slot ID 集完全一致且唯一。
- [ ] `inject()` 返回的 `workbenchEditor` metadata 在目标 DSH Slot 实现下可由 Core 读到。
- [ ] root/session Slot、binding requirement、unbound UI 与真实工作流相符。
- [ ] 打开内页不会隐式创建 Session；一个 Area 内的多个 Session 内页互不串用，多个 Area 共享项目时读取同一份背景和记忆，不自动改绑 Session。
- [ ] 保存值是 JSON-safe 且在 `maxBytes` 内；Schema 变化和超限能恢复，不静默丢数据。
- [ ] `portable`、`reference-only`、`forbidden` 的导出导入行为符合声明。
- [ ] `distribution.runtimeFiles` 包含所有运行入口、Bundle patch 和许可证，没有源码、source map、安装脚本或未列出的依赖。
- [ ] `offline-embedded` 工作台包中存在与扩展 artifact digest/integrity 一致的嵌入制品；接收方缺少扩展时显示待恢复，而不是伪造空白内页。
- [ ] 完整包恢复的是工作台根目录、Area 项目、原生 Session 和扩展状态；扩展 artifact 本身没有携带作者机器路径、Profile 或 Session transcript。
- [ ] 隐藏、收起、关闭、许可撤销、DSH 停用、卸载、更新后均释放可释放资源并保留布局引用。
- [ ] 声明的对话资源路由真实点击后只作用于正确 Area，并能关闭和恢复。
- [ ] 浏览器/桌面各自支持的能力经过真实宿主验证；不支持项说明准确。
- [ ] DSH 官方主对话、Sidebar、标题栏及其他插件 owner 未被覆盖。
- [ ] 构建成功、包已安装、插件已运行、Core 已允许和桌面已验收分别记录。

自动化测试通过不等于 DSH 桌面端真实 Profile 验收通过。不能只凭 slot 注册、静态 bundle row、Catalog 项或 DOM 挂载就标记功能通过。

## 16. 禁止实现模式

- `scope: 'area'` 作为 editor render scope。
- 把 Workbench 声明直接附加到会被 DSH 丢弃的 Slot options。
- package name、Cordis plugin `name`、bundle row name、registrant 使用不同字符串。
- 每个 Slot 只列当前 editor 的 `extension.editorIds` 子集。
- 通过 DSH 当前 Session、全局状态、焦点、Area 序号或扫描列表推断绑定。
- 打开内页时自动创建 Session、Workspace、终端或后台任务。
- 把 Core opt-in 当成插件 enable、权限授予或安全隔离。
- 扩展直接写 DSH Profile、安装依赖、变更官方 owner 或调用私有 Electron API。
- 把本机私有状态、凭据、完整对话或机器绝对路径放进分享包。
- 生命周期销毁时把视图关闭伪装成后台任务取消。
- 只验证 Slot 存在就宣称扩展“已加载可用”。

## 17. 故障排查

| 表现 | 首要检查 | 正确处理 |
|---|---|---|
| 扩展未出现在扩展中心 | Core 与 DSH 是否在同一 Profile；DSH 插件是否运行；是否注册公开 editor Slot | 先核对 DSH Plugin Manager 和 runtime inventory，再查 Slot 注册，不手工改设置文件 |
| 显示 `identity-unverified` | Slot `registrant`、runtime `entryId/moduleName`、bundle row 的 `entryId/moduleName` | 必须一一精确匹配；修复 bundle patch 或 Client 插件 `name` 后按 DSH 方式更新/重启 |
| 显示 `inventory-unavailable` | DSH remote 是否注入、连接是否就绪、`pluginInventory.list()` / `pluginManager.listBundles()` 是否失败 | 读 UI 诊断中的 operation/code，恢复连接后刷新；不要把暂时读不到说成插件未安装 |
| 显示 `invalid-contract` | Slot inject metadata、声明字段、editor ID 是否重复/遗漏 | 将 validator 错误、实际 Slot ID 和包清单逐项对照 |
| 显示 `incompatible` | `coreCompatibility` 范围和 `dshGeneration` 与实际运行版本 | 确认 Core 兼容范围覆盖当前版本，且 DSH 代际完全一致 |
| 显示未允许或需重新确认 | Workbench consent 是否存在、合同 fingerprint 是否变化 | 在 Workbench 设置中明确允许/重新确认；这不会替代 DSH 启用 |
| 扩展已允许但添加菜单没有内页 | 每个实际 Slot 是否注册、runtime extension ID 集是否完整、Slot `scope` 是否对应 | 查 editor catalog、DSH Slot ledger 与声明集；不要仅检查 package.json |
| 内页显示 pending | 声明要求的精确 Workspace/Session 是否由该内页 owner 提供 | 由 Core 的绑定动作完成；不要通过全局 Session 或同区域第一张标签猜测 |
| 状态超限导致内页不挂载 | 保存 JSON 的编码大小是否超过声明 `maxBytes` | 先备份/检查状态，再使用 UI 明示的清空恢复操作；不要直接删布局记录 |
| 更新后旧标签不可用 | DSH 新版本是否运行、editor ID 是否稳定、Core 是否要求重新确认 | 先恢复兼容版本/重新允许；旧布局引用应保留 |

Core 目前会在身份映射失败时显示结构化诊断 code、registrant、runtime entryId/moduleName 和 bundle 名称。diagnostic 是定位信号，不是包签名或信任证明。

## 18. 当前实现与待验收状态

Workbench Core `0.1.0-beta.1` / DSH `0.2.2-rc.2` 提供 Slot inject metadata 读取、DSH runtime/bundle inventory 注入与唯一映射、声明校验、Profile-local Workbench consent、扩展状态过滤、撤销/缺失时布局引用保留、刷新竞争保护和身份诊断 UI，并由 Core Host 全局 Skill registry 提供 `workbench-extension-development`，供 DSH 原版 Cordis Creator 通过原生 Skill 工具发现。RC2 Agent Teams 默认关闭并按 root Session 保存选择；原生 SubAgent 工具支持具名及嵌套成员。Workbench 不另加 AgentTeam 控制入口，Bay Agent 的 Work Item / Assignment 生命周期仍独立。v0.1 同时提供 Area 项目目录、多 Session 内页来源、浏览器/桌面共享的工作台状态，以及 `offline-embedded` 扩展制品收集。扩展发现、状态策略和模板离线制品校验已有自动化覆盖；原版 Creator 真实会话生成扩展、桌面安装/重启和跨机器完整包恢复仍需实测。

本规范本身不表示任何第三方测试插件已经成功安装或激活。`packages/workbench-svgdeepseek-pet` 是历史测试扩展，**不是本规范或当前 Core 验收的前置条件**；相关源码、制品和证据仅用于历史追溯。

仍需独立完成的验收包括：干净桌面 Profile 下扩展发现设置 UI；DSH 原生安装、启停、升级、卸载和重装恢复全流程；实际布局 stale reference 恢复；Creator 产物端到端安装；各扩展真实功能及资源路由；不同宿主能力表现；包含扩展制品的完整工作台 V6 跨平台导入（并验证 v0.1 V5 向后导入）。离线制品检查和 Profile 发布身份签名只能证明清单、摘要和发布者内容一致，不等于扩展作者认证、代码安全保证或运行时安全沙箱。自动化通过只表示代码合同测试通过。

## 19. 最小发布信息

每次交付至少附上：

```text
DSH package name / version:
Workbench moduleId:
Workbench editorIds:
Workbench Core compatibility:
DSH generation:
Requested DSH permissions/capabilities and reasons:
State schema / maxBytes / restore / share:
Binding and unbound behavior:
Lifecycle policy:
Artifact SHA-256 (if produced by release pipeline):
Automated checks:
DSH test Profile result:
Workbench consent result:
Desktop host result:
Known unsupported/unverified behavior:
```



## 20. v0.1 分发要求

扩展包支持普通持久 Bundle 的 client-only 和 client-host。声明 distribution.version=1、exportPolicy、runtimeKind、精确 runtimeFiles、requires；包含所有入口、必要静态资源、Bundle 配置和 LICENSE。Bundle row ID 必须全局唯一。依赖打入产物，或使用本代宿主提供的精确 peer；禁止安装构建脚本。client-only 只能有模板中的空 Host shim。扩展必须使用 `exportPolicy: 'embed'` 并通过静态闭包检查，才能作为离线制品进入分享包。`offline-embedded` 是扩展/布局分发的模式；完整工作台迁移格式为 V6（导入器继续支持当前 v0.1 V5），其格式标识为 workbench-complete，两者不能混称。

inject 返回的 workbenchEditor 同时提供 portability.exportState/importState 与 distribution；Host 根据原生清单和文件校验补充 provenance。仅处理器输出的受限 JSON 可迁移，无状态内页使用明确空投影。配置恢复须精确匹配包名、版本、运行摘要、editor ID、scope 和授权，缺失项保留 Host 待恢复数据。

新安装和启用后必须重启；实际注册通过才恢复配置并提交工作台。扩展 artifact 不迁移 Session、模型、工作目录、凭据或整个 Profile；完整工作台 V6 另行负责根目录文件、Area 项目、Session、附件、记忆和任务关系。签名不是沙箱，静态闭包检查不是任意代码安全证明。
## 21. v0.1 浮动展示补充契约

浮动内页沿用既有 owner 绑定/权限/状态校验。当前提供可选 `presentation.floating`（false 禁止浮窗）、`owner.presentation`、稳定 `owner.runtimeIdentity`、`registerCloseGuard`。位置不是实例身份；浮窗固定到 Area 不能重建任务或原生 occurrence。Settings 投影、工作台文件信封和完整包是独立版本层，不能从 Settings V4 推断文件或包格式。

生命周期隐藏必须撤销焦点，pause 仅暂停展示工作，dispose 仅释放可恢复视图；不得取消底层任务。未保存内容必须注册关闭保护。Core 的关闭、删除/归档和受控刷新/关闭流程等待该保护；操作系统强杀、崩溃及原生未提供异步拦截的退出只能提示，无法保证恢复。

资源通过 owner 打开接口接入；不允许借用原生全局侧栏 owner。需要真实 Area 几何或没有完整绑定/生命周期契约的内页应声明禁止浮窗。完整示例及验收清单见[模板的项目身份与实例生命周期](templates/workbench-editor/README.md#180-项目身份与实例生命周期)。

## 项目归属修订（2026-11-10）

工作台文件信封 schemaVersion 为 2，projectModelVersion 为 1；项目元数据 schemaVersion 为 1，完整包外层为 V6，导入器继续支持当前 v0.1 V5。旧读取器须拒绝未知信封版本。扩展自己的 state.version 与上述版本独立，仅在扩展状态结构变化时升级。

必须回归：关闭所有区域 → 重新关联原项目 → 手动打开内页；同项目两个区域；区域换绑后原会话仍读原项目；浮动与区域转移；零区域完整包导入。关闭视图只能释放本视图资源，不能删除项目文件或会话、取消其他视图的任务。

## 22. 给专用 Agent 提供工具和 Skill（0.1.0-beta.1）

专用 Agent 组装时勾选的工具和 Skill，只有扩展在 Host 端注册了执行器才会生效。只在客户端工具目录登记的条目，组装页会标为"不可用"，Host 拒绝注册使用它的修订。

在扩展的 Host 插件里，通过 Cordis 服务 `workbenchAgentKit` 注册：

```js
export const inject = ['workbenchAgentKit']
export function apply(ctx) {
  const kit = ctx.get('workbenchAgentKit', false)
  if (!kit) return
  ctx.effect(() => kit.register({
    moduleId: 'workbench.quote',
    tools: [{
      id: 'workbench.quote.lookup',        // 必须以 moduleId 加点开头，并与客户端工具目录 id 相同
      description: '按客户读取报价单',
      input: { type: 'object', properties: { customer: { type: 'string' } }, required: ['customer'] },
      effect: 'read',                      // read | write | external
      async execute(args, call) { /* call.workbenchId、call.guest、call.signal */ return { rows: [] } },
    }],
    skills: [{ id: 'workbench.quote.flow', description: '报价流程', content: '# 报价流程\n…' }],
  }))
}
```

规则：

- 注册的工具和 Skill 默认对任何 Agent 都不可见。Core 只把某个专用 Agent 修订勾选的条目挂进该 Agent 自己的作用域，Agent 结束或切换模式时撤下。
- 工具在模型侧的名字是 id 中非 `[A-Za-z0-9_-]` 的字符换成 `_`；Skill 名字是 id 转成小写短横线形式。
- 执行器必须按 `call.workbenchId` 限定数据范围，并遵守 `call.signal`。
- 访客调用时 `call.guest` 为真。`guestAccess: read-only` 的 Agent 只能调用 `effect: 'read'` 的工具；`none` 一律拒绝。原生的协作者审批仍然生效。
- Skill 只在 Agent 启用了"Skill"积木时挂载。
