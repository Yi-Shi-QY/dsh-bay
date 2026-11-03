# 湾域产品方向

湾域的长期方向是让 DSH 插件形成一个轻量闭环：

```text
开发 → 验证 → 组合 → 分享
```

当前 `0.2.2-alpha.17` 仓库先冻结 Core 运行时，提供多 Area、Area-local
Session、官方内页投影、布局恢复和模块身份/产物契约。Creator、可视化验证、
组合向导和目录分享属于后续产品层，不能在当前 Core-only 候选中提前宣称已经
完成。

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
