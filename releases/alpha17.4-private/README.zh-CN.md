# DSH Bay 17.4 私测包

版本：`0.2.2-alpha.17.4`
DSH 基线：`0.2.1-rc.5`

这是根据当前 17.4 源码生成的浮动工作区 UI 私测包，包含回归后的中性浮动工作区视觉、湾域工作台 SVG 图标、对话标记色联动和顶栏优化。

## 重要状态

- `pnpm check:rc5`：通过。
- 全量测试：120 个文件、746 项测试通过。
- `pnpm build`：通过。
- `pnpm check:rc5`：通过。
- 正式 `pnpm pack:core`：被既有 112 个 generated/upstream Sidebar/Workspace 类型错误阻断。
- 本归档是 experimental/private trial，不是正式发布包。
- 打包期间没有修改日常 DSH Profile，也没有执行安装验收。

## 文件校验

- SHA-256：`a623500f6b167782a793729da194fe34fea9f788a4f42df924f7ea55cba186a4`

安装前请先核对 `SHA256SUMS.txt` 和 `candidate.json`。
