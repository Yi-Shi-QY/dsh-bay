# v0.1 公测验证记录

目标候选：`dsh-bay@0.1.0-beta.1`，兼容 DSH `>=0.2.2-rc.2 <0.2.3`。

## 自动化验证

| 检查 | 状态 | 记录 |
| --- | --- | --- |
| `pnpm check:public` | 通过 | 扫描 Git 公开索引中的 661 个文件；未发现禁止目录、凭据格式、本机路径或内部候选版本 |
| `pnpm check:dsh-dependencies` | 通过 | 检查 87 组直接依赖声明和 370 个源码文件 |
| `pnpm check:compat` | 通过 | 检查 36 个 RC2 来源文件和 4 个 renderer 文件 |
| `pnpm test` | 通过 | 178 个测试文件、1222 个用例 |
| `pnpm typecheck` | 通过 | Host 与 Client TypeScript 项目 |
| `pnpm build` | 通过 | 构建 `dsh-bay@0.1.0-beta.1` |
| `pnpm pack:core` | 通过 | 生成候选包；`pnpm --filter dsh-bay pack --dry-run` 白名单复核通过 |

候选制品：`releases/0.1.0-beta.1/dsh-bay-0.1.0-beta.1.tgz`，大小 1,437,799 字节。SHA-256：`5aaec0b9da274bc0b150503a9b4782f03632c2ea012cd0a32ea8f03dc76487af`；SHA-512 integrity：`sha512-Cc9sBhaTEnMav/up/VhMKAYrJ3kZPn9GY2nv6l5RNTaocfyMTLs7h3Pv3K2MuEPifPejyYfi7TKXl6oTKVjncQ==`。候选元数据为 `public-beta`，包名、版本、DSH 代际和兼容范围均与清单一致。该校验值对应本次本地构建，不表示已发布。

## 仍需人工验证

- 在指定 DSH RC2 Host 中安装并启动 Core。
- 使用 Creator 模板完成一个新插件的创建、修改和重新验证。
- 导出、复制到另一份工作区并导入布局包和完整工作台包。
- 在隔离的局域网环境验证房主、访客、断线重连和权限边界。
- 检查无凭据、Session transcript 和本地绝对路径进入导出包。
- 启用并验证 GitHub 私密漏洞报告渠道，完成公开仓库来源与许可证复核。
- 公开索引已经初始化为单提交；仍需由未参与整理的人复核 allowlist 和提交内容。

自动化测试不替代目标 DSH 环境中的安装、模型服务和局域网验收。
