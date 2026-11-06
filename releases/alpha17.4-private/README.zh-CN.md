# DSH Bay 17.4 私测包

版本：`0.2.2-alpha.17.5`
DSH 基线：`0.2.2-rc.1`

这是根据当前 17.4 源码生成的工作台 UI 私测包，包含浮动工作区视觉和菜单优化、对话标记色联动，以及新增的“区域容器标签色框”设置。关闭该设置后只隐藏区域和浮动工作区的标签色装饰线框，不影响绑定标签、颜色数据和工作台交互。

## 重要状态

- `pnpm check:rc1`：通过。
- 相关测试：4 个文件、67 项测试通过。完整测试运行有 1 个分发事务时序失败；单独重跑该测试通过。
- `pnpm build`：通过。
- 正式 `pnpm pack:core`：被既有 112 个 generated/upstream Sidebar/Workspace 类型错误阻断。
- 本归档是 experimental/private trial，不是正式发布包。
- 打包期间没有修改日常 DSH Profile，也没有执行桌面或 Browser Companion 安装验收。

## 文件校验

- SHA-256：`f05444f0639492611b7b790510cbf6f343241a09a9068325627c88a13feb11f9`
- 包大小：`1046425` bytes

安装前请先核对 `SHA256SUMS.txt` 和 `candidate.json`。
