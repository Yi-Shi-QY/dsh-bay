# DSH RC2 官方容器内页修复与核对

日期：2026-11-13。修复候选：DSH Bay `0.2.2-alpha.18.4`；宿主：DSH `0.2.2-rc.2`。本记录对应用户在 18.3 中报告的“新建对话、对话在普通容器及浮动工作区都空白”。制品和最终测试结果见 [VALIDATION.md](VALIDATION.md)。

## 根因与修复

官方 `ConversationContent` 已来自 RC2，但 Bay 的私有渲染器仍以旧提交 `477b4f420553e8a52c2fbccc464d7561b239c443` 为来源，未跟随上一轮 Sidebar / Workspace 复制源码更新。RC2 的 `conversation.content` 将消息、视图、输入区放在 `conversation.hero.frame` 的 `children` 中；该插槽类型为 `hoc`。旧渲染器未实现此类型，按普通列表分发，丢掉 `children`。即使没有安装装饰层也会丢内容，因此普通容器和浮动工作区同时空白。

修复将 `scoped-slots.tsx`、`bindings.tsx`、`bind.ts`、`errors.ts` 对齐 RC2 提交 `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c` 的 npm 源码，保留 Bay 按渲染宿主隔离的子插槽缓存及稳定的私有 Factory 入口。同步支持 HOC 分层与故障回退、Markdown 围栏按 key 包装、inline 插槽、按 `(key, member)` 读取数据源。装饰层出错时保留内部对话内容，行为沿用官方实现。

同轮复现并修复另外三处问题：

1. **子代理状态错绑父会话**：嵌套 `SessionProvider` 已切换数据源，但普通插槽的 `storeOf` 忽略实际绑定，始终使用 Area 的父 Session。改为按传入 Session 区分存储；root 存储保持无 Session key。同一 Session 的原生存储继续由多个 Area 共享，Area 销毁仅释放引用。
2. **计划任务恢复丢失任务身份**：官方任务详情和标题用导航参数或官方侧栏的本机历史确定任务；只保存了 Bay 资源地址的内页无法恢复。现在从 `dsh-resource://schedule-task/session/<session>/<task>` 还原导航参数，标题和正文使用同一目标，不依赖官方侧栏 tab-id 缓存，也不改变工作台包格式。
3. **对话组件晚注册后不恢复**：私有 Factory 根入口在定义缺失时直接返回，未订阅注册变化；Area 宿主还因定义缺失而不创建。现在允许先显示等待内容，并在注册到达、移除时更新。

## 12 类官方内页核对

这里的“回归”指自动化和源码合同核对，不等同于已完成真实 DSH 桌面交互验收。

| 内页 | 核对内容与本轮结论 | 证据范围 |
| --- | --- | --- |
| 新建对话 | 修复 HOC 丢失内容；保留项目选择和放置回调 | 官方 `ConversationContent`、`PixelWhale`；无装饰层、正常装饰层、异常装饰层三个场景 |
| 对话 | 修复同一 HOC 根因及晚注册恢复 | 官方内容、页头、视图组件；普通 Area / 浮动运行身份 |
| Agent 轨迹 | 与对话共用的内容骨架一并恢复，保持固定轨迹视图 | 官方视图选择组件，轨迹叶节点使用测试夹具；检查 Inspect 路由 |
| 子 Agent 对话 | 修复共同渲染问题及父子 Session 存储混用 | 官方 `SidebarChatTab`、`ConversationSlotPanel`、对话内容及视图组件，父子同时显示 |
| 工作区文件 | Bay 默认使用项目级文件内页；保留官方文件树、动作与资源接口，未发现新的 RC2 接口断点 | 现有文件/资源回归和官方 Files 注册合同；文件导航 Factory 仍使用实际 Session |
| 终端 | 保留 Area occurrence、控制器身份、保留/关闭语义 | 原生适配器和终端保留回归；未启动真实桌面终端作验收 |
| 浏览器 | 保留精确 Session 的控制器和按 tab 分隔的状态，重挂载不当作显式关闭 | 控制器身份、嵌套动作、发生项与持久状态回归；未验证真实 Electron 页面 |
| 文件预览 | 正文、动作、不可预览提示及子 renderer 的 tabInfo 接口仍匹配 RC2 | 官方 TextPreview 注册和 document hook 合同；既有子插槽/资源回归，不宣称逐个验证所有文档格式 |
| 变更审阅 | 正文存储和摘要/diff 数据源合同可用；保持会话坐标和同 Area 资源路由 | 官方 ReviewTab 注册合同及路由回归 |
| 计划 | 保留普通及子代理计划地址、审阅导航；数据源随渲染器支持 member 参数 | 官方 Plan 注册合同、计划路由与 keyed source 回归 |
| 计划任务 | 地址恢复时补齐任务身份；与官方侧栏历史解耦 | 使用真实 `ScheduleTaskTabTitle` 和 `TaskTabBindings` 复现缺失导航；正文共用同一目标解析 hook |
| 功能指南 | 保留 chain 回退、guide-entry 的 tabInfo 和同 Area 打开动作 | 官方 GuideBody / guide hook 合同和现有动作过滤、插槽回归 |

## 官方新增页面检查

从 GitHub 的 RC1 提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` 读取上述九个稳定侧栏提供包的注册源文件，与本地精确 RC2 源码对照：九个包在两版均各有一个 `sidebar.right.pane.tab` 正文注册。RC2 安装依赖中全部稳定 `dsh-client-ui-*` 源码也已扫描，九个正文全部有 Bay 映射。本轮没有发现需要新增映射的稳定侧栏类型。

官方全局任务管理页 `TaskManagerPage` 在 RC1 已存在，当前 `main: schedules` 实现含全局工作区/新建会话操作，尚不能直接当作一个 Area 内页复用。现有“计划任务详情”已适配；本轮不把全局任务管理页冒充新增的 RC2 内页。

另查到实验包的 Forge/变更页、Session Inspector、LiveShare viewer 入口和统计视图。它们分别依赖实验能力、调试环境或分享角色；本轮不作为稳定官方内页直接上架，也不宣称已适配。

## 防止再次漏检

- `check:compat` 同时核验 Sidebar/Workspace 和四个私有渲染器文件。渲染器记录上游及适配后两个 SHA-256、代际、提交与具体改动；统一 LF 计算，不受 Windows CRLF 检出影响。
- 回归测试直接运行 RC2 对话骨架和子代理正文。此前测试用简化的 Factory 替身，没有覆盖官方 `conversation.hero.frame` 调用，因而没有发现空白问题。
- 另覆盖 Markdown HOC key 过滤、inline DOM、数据源 member、root 存储身份、Factory 晚注册，以及扫描稳定官方源码的侧栏正文数量。以后新增稳定页面或复制源变化会触发复查。

## 实机验收顺序

先安装 18.4 测试包并重载插件，检查普通容器和浮动工作区各自的“新建对话 → 选项目 → 输入/发送 → 已有对话 → 轨迹”。再验证父子对话同时打开、终端/浏览器切换内页和恢复、文件预览、变更审阅、计划和计划任务。对需要业务资源的内页，应从真实对话中的对应资源打开。需要第二设备的共享和恢复路径仍须单独验收；本轮自动化不代替该结果。
