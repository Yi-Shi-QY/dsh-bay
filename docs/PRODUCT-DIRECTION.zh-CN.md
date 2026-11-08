# 湾域产品方向

湾域的长期方向是让 DSH 插件形成一个轻量闭环：

```text
开发 → 验证 → 组合 → 分享
```

当前 `0.2.2-alpha.17.6` 提供多 Area、Area-local Session、官方内页投影、
17.1 Home，以及工作台布局、在线引用和离线嵌入分发。Creator 提供扩展开发
规范与模板，完整包支持经过验证的自包含 Client/Host Bundle 及配置迁移。
更广泛的组合目录、Dynamic Cordis、Agent/MCP/Skill 完整迁移仍属于后续阶段。

## 创建工作台

顶部「＋」与总览的创建入口使用同一紧凑菜单：上方为「新建空白工作台」，
右侧为直达总览导入页的「导入工作台包」图标按钮；下方仅保留两排区域划分小矢量图标，
不显示「区域划分」标题。选择后只填写名称与可选简介，
创建并打开空区域工作台。内页由用户进入工作台后，在对应区域的现有入口自行选择；
创建菜单和命名窗口不提供内页选择，也不再展示多步向导或已保存布局模板。

## 开发

插件作者从标准 DSH 插件包和 Workbench 扩展契约开始，在自己的工作域里使用
Session、Files、Terminal、Browser 和其他原生内页。

## 验证

湾域应逐步把 manifest、版本、依赖、权限、artifact digest、source
provenance、Slot contract 和真实运行结果聚合成清晰的验证报告。

## 组合

Core 已经提供 module identity、composition package、install plan 和事务日志
基础。未来的组合界面应当帮助作者选择模块和布局，但最终安装仍由 DSH 原生
Plugin Manager 负责。

## 分享

分享必须携带精确版本、digest、依赖和来源。离线包、直接来源导入、候选产物和
LAN Share 可以成为不同分享方式，但共享 Session、凭据、绝对路径和机器身份
不能成为默认行为。

## 产品表达

```text
DSH Bay｜湾域
面向 DSH 的多区域插件工作台
从一个想法，做成一个可运行的 DSH 插件。
```
