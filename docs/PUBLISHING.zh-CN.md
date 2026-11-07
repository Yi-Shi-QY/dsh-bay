# DSH Bay 对外发布清单

这份清单描述从当前私有候选到公开 npm 包和官网的最短路径。发布动作必须
绑定同一份源码提交、构建输入、归档和校验摘要。

## 当前仓库边界

- 唯一可发布运行时：`packages/workbench-core`。
- 默认安装包：`dsh-bay`。
- 兼容目标：DSH `0.2.2-rc.1`。
- 安装、更新、停用和卸载继续由 DSH 原生 Plugin Manager 负责。
- `node_modules`、`lib`、`tmp`、`output` 和本地试用目录不进入发布提交。

## 发布前门禁

1. `pnpm check:rc1`、`pnpm test`、`pnpm typecheck`、`pnpm build` 和
   `pnpm pack:core` 在同一提交上通过。
2. 在干净 DSH rc1 Profile 中验证进入/退出工作台、重启恢复、多轮输入、
   浮动工作区、锁定布局、容器内页和离线包导出导入。
3. 检查 package manifest、`files` 白名单、依赖闭包、许可证、第三方声明、
   provenance、source digest、lockfile digest 和 SHA-256。
4. 更新 README、CHANGELOG、兼容矩阵、安装迁移说明、FAQ 和已知限制。
5. 确认版本阶段、npm dist-tag、GitHub 可见性、域名和静态站点托管方式。

## 渠道职责

| 渠道 | 职责 |
| --- | --- |
| 官网 | 品牌、定位、真实演示、安装文档、兼容矩阵、FAQ 和发布记录 |
| npm | 分发 `dsh-bay` 包和机器可读的版本元数据 |
| GitHub | 源码、问题反馈、变更记录、Release 和 provenance |
| DSH Plugin Manager | 用户 Profile 内的安装、启用、更新、停用和卸载 |
| 生态目录 | 在公开包和文档稳定后申请收录，不在 DSH Bay 内重复建设市场 |

## 发布顺序

1. 冻结发布提交，记录构建输入和归档 SHA-256。
2. 创建对应 Git tag 和 GitHub Release，附安装包、校验文件和变更记录。
3. 从发布提交执行 npm publish，使用与版本阶段一致的 dist-tag。
4. 从官方 npm registry 和干净 DSH Profile 反向安装一次。
5. 检查官网安装入口、兼容说明、下载链接和校验摘要均指向同一版本。
6. 保留回滚版本与停用旧包的迁移说明，不自动修改用户 Profile。

## 官网首发范围

首发官网只提供静态内容、文档、下载、发布记录和问题反馈。账号同步、
在线布局分享、作品社区、远程工作区和云端执行需要独立的后端、身份、存储
和运维方案，暂不放入首发承诺。
