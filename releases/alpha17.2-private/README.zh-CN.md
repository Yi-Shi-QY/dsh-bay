# 17.2 私有试用交付

版本：0.2.2-alpha.17.2。宿主：DSH 0.2.2-rc.1。保留 17.1 工作台首页、创建向导与全关闭承接。

安装文件：dsh-workbench-core-0.2.2-alpha.17.2-339c85d01866.tgz

SHA-256：339c85d0186629a8fb9549c7238a8ff2385c7a4837df1162849e46c80a66882a

这是真正重新构建并解包核对过的 17.2 包。请在 DSH 原生插件管理器中选择此本地文件安装，随后重启。建议先用独立测试 Profile。不要误装 alpha17 或 alpha17.1 的历史文件。

新增三模式分发、签名与精确依赖锁、自包含运行制品准备、受限原生安装、重启续办、配置恢复、冲突阻断、延期恢复和导入记录。模型、外部服务、Session、工作目录与凭据仍由接收者自行配置。

已验证：107 个测试文件 / 642 项通过；build 和 rc1 身份检查通过；真实隔离 DSH Profile 中安装私有纯 Client 与 Client+Host 扩展，重启恢复两 Area/三个保留标签/配置，验证 Host 功能及第二次重启持久性。验收安装包摘要与本文件一致。接收方使用独立空 store 和进程级网络阻断，并未声称物理断网。

未通过的发布门禁：typecheck 仍有 112 项既有 RC1 Sidebar/Workspace 声明错误，无新增；严格 pack:core 保持阻断。本文件是单独生成的 experimental 私有试用包，不是稳定发布。全面原生桌面 smoke、外部私有 Registry 部署和操作系统级离线验收仍需完成。

candidate.json 是交付身份与验证索引，tests.log/build.log/typecheck.log 区分源码、构建和类型门禁；receiver-evidence.json 与截图记录真实安装。acceptance-private-workbench.wbpkg 仅为两个合成示例扩展组成的验收样例，不是 Core 安装包。
