# DSH Bay 17.6 RC1 私有候选包

- 安装包：`dsh-bay`
- 版本：`0.2.2-alpha.17.6`
- 兼容目标：DSH `0.2.2-rc.1`
- 状态：`private-staging / experimental-unvalidated`

## 安装包

```text
dsh-bay-0.2.2-alpha.17.6.tgz
```

`candidate.json` 记录 SHA-256、完整性摘要与文件大小。此包用于本地实测，
不代表已发布或已完成 DSH 桌面验收。

当前快照包含本轮标签状态与悬浮信息、对话绑定入口与文件夹菜单，以及紧凑卡片式设置页。
扩展启用和权限在卡片内管理，标签文字大小与关闭按钮偏好集中在工作台设置中。
安装包与最新 `alpha17.6-ui-cards-private` 实测包内容一致，SHA-256 为：

```text
2ca262e151b702b2fd3c51f3aede773e9744b4913c38f2fe48b36366f8524c77
```

本轮相关测试共 11 个文件、140 项通过，类型检查、构建、RC1 身份和安装包校验通过。
设置页已在独立浏览器环境检查 1440×980 和 390×844 布局及交互；这不等同于 DSH 桌面验收。
当前快照未重跑完整测试集，详细范围见 `package-name-verification.json`。

安装前请在目标 Profile 中停用旧的 `@dsh-workbench/core`，再安装并启用
`dsh-bay`，之后重启 DSH。避免两个 Core 同时注册工作台。
