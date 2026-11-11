# DSH Bay 正式发布准备核查

> 归档日期：2026-11-11。本文保留历史设计与证据，正文状态只代表原记录时点。现行规则见[当前说明](../../PUBLISHING.zh-CN.md)；归档原因见[归档索引](../README.md)。原文内容保留，相对链接已修正。

核查日期：2026-11-07（Asia/Shanghai）。核查基线：main / 799cc6c21e04915b4dcd8b450cad1df990639431。

产品品牌统一为 **DSH Bay**，npm 安装包名为 `dsh-bay`。对外介绍、站点标题、安装说明和发布公告使用 DSH Bay；不使用“DSH 工作台空间”作为产品名称。现有 `workbench.core`、源码目录和持久化键属于兼容性标识，不在品牌文案整理中直接改名。

结论：可以进入发布准备，但当前尚不具备正式发布条件。以下状态来自本次实际查询；没有执行 npm 发布、创建 GitHub Release、修改仓库可见性或 DNS。

## 远程仓库

- 仓库：[Yi-Shi-QY/dsh-bay](https://github.com/Yi-Shi-QY/dsh-bay)。经现有 Git 凭据查询 GitHub API 确认为 Private，默认分支为 main，当前账号具有管理和推送权限。匿名 API 返回 404 不能解释为仓库不存在。
- `git ls-remote` 和 GitHub commits API 均确认远端 main 为 `799cc6c`，与本地 HEAD 一致。
- GitHub Release 列表为空；唯一远端 tag 为 `v0.2.2-alpha.17`，其提交为 `ea963f8ab193b8b3de36d83e94c12713b143ecfe`，不是 17.5。
- 最新 [DSH Bay quality / run 42229866650](https://github.com/Yi-Shi-QY/dsh-bay/actions/runs/42229866650) 对应当前 main，结果为 failure。依赖安装成功，失败发生在 `pnpm verify` 的测试步骤：118 个文件通过、4 个文件失败；752 项通过、9 项失败。
- 失败涉及 `dsh-native-plugin-manager.spec.ts`、`distribution-native.spec.ts`、`distribution-transactions.spec.ts` 和 `distribution-v4.spec.ts`。原生适配器测试使用 Windows 固定路径，在 Ubuntu 上触发 `dsh-native-artifact-path-invalid`；三个安装集成测试构造了相对 Node 可执行文件的 `node_modules/corepack/dist/pnpm.js` 路径，需在 CI 环境验证实际可用性。后者目前是待验证的环境依赖，不能将全部 9 项失败都归因于同一问题。
- 当前只有 `.github/workflows/quality.yml`，执行 `pnpm verify`；该命令不包含独立的 `pnpm typecheck` 或严格打包验证。尚无发布 workflow、仓库级 Actions secrets 或 deployment environments。没有 secrets 不等于无法发布，但目前没有已配置的仓库级凭据发布链路。
- `homepage` 为空，`has_pages=false`，Pages API 返回 404：当前仓库未配置 GitHub Pages。
- main 分支保护查询返回 403，提示需升级方案或公开仓库才能启用该功能；本次未修改设置。

## npm

- [官方 registry 的 dsh-bay 查询](https://registry.npmjs.org/dsh-bay) 返回 HTTP 404，未发现公开发布记录。此结果不保证名称一定可注册，也不证明当前账号有发布权限。
- 本机默认 registry 为 `https://registry.npmmirror.com`；对官方 registry 执行 `npm whoami` 返回 ENEEDAUTH。未发现当前用户 npm 配置中的 token 或 NPM_TOKEN / NODE_AUTH_TOKEN 环境变量。需要在选定发布账号下完成登录或配置发布认证；不把凭据写入仓库。
- npm 上的 [@dsh-workbench/core](https://registry.npmjs.org/@dsh-workbench%2Fcore) 已由另一维护者 `ckang1229` 发布，latest 为 `1.1.16`，repository 指向 `novaeth/dsh-workbench`。它不是本仓库的 npm 发布记录，不能把此包当作 DSH Bay 的发布渠道或要求用户从 npm 安装它以获取本项目历史版本。本地旧私有包兼容说明必须明确区分来源。
- 当前可发布子包为 `packages/workbench-core`，name 为 `dsh-bay`，version 为 `0.2.2-alpha.17.5`，private=false；根包 `dsh-bay-workspace` 保持 private=true。
- 实际安装包还缺少 repository、homepage、bugs、keywords、engines、publishConfig 等对外元数据；根 package.json 的这些字段不会自动成为子包的 npm 元数据。包 description 也需要改成以 DSH Bay 为主体的产品描述。
- 发布版本号与 dist-tag 尚待确定。当前 alpha 身份不能直接作为稳定版宣传；仅声明 DSH `0.2.2-rc.1` 兼容，不推断其他 DSH 版本兼容。

## 域名与站点

- 当前仓库和已查询的 GitHub 仓库配置中未发现产品域名、站点部署配置或 CNAME；package homepage 当前仍使用 GitHub 地址，不能视为已经上线的独立官网。
- 本次上下文尚未提供正式域名，因而未对任意猜测的域名下注册、归属或可用性结论。仍需提供完整域名以及注册商 / DNS 平台（如已购买）。
- 得到准确域名后，再核对注册状态、NS、A/AAAA/CNAME、HTTPS 证书、根域与 www 重定向、部署平台及站点内容。
- 官网标题和可见品牌使用 DSH Bay；安装页、兼容范围、迁移说明、下载入口和问题反馈必须对应本次实际发布版本。

## 当前安装包与文档

- 当前私有包：`releases/alpha17.5-rc1-private/dsh-bay-0.2.2-alpha.17.5.tgz`。本次重新计算 SHA-256：`61d13a16bb197e5979856b0fd65cb4c87a8b1f823686cd01e92946f9509f40af`，与 candidate 记录一致。
- 归档共 255 个文件，manifest 的 name/version 正确；忽略对象字段顺序后，归档 manifest 与当前源 package.json 语义一致。
- 归档包含 THIRD_PARTY_NOTICES.txt，但包根目录没有 README.md 或 LICENSE；模板子目录中的 README/LICENSE 不能代替 DSH Bay 安装包自身的说明与许可证文件。
- 本次重跑 `pnpm check:rc1` 通过。本次没有重跑全量本地测试、typecheck、build 或重新生成包；昨日 Windows 本地 761 项通过的记录不能替代本次实际失败的 Ubuntu CI。
- README.md 的当前版本仍写 17.2，README.zh-CN.md 仍写 17，CHANGELOG.md 只有 alpha.17；docs/VALIDATION.md 仍以旧版本和旧类型错误基线为主。应补充 17.5 的最新验证入口，历史记录保留为历史，避免覆盖旧验收结论。
- 当前 private-staging 包不等于已完成正式验收。当前归档仍需进行 clean DSH rc1 Profile 的真实安装、模式退出重入、多轮输入、浮窗层级、自定义内页完整离线导出导入及重启恢复验收。旧归档的验收记录不能自动继承。

## 按依赖顺序准备

1. 修复并复现 Linux CI 的 9 项失败，保留现有路径边界校验；补齐跨平台测试夹具及真实可用的包管理器入口。Windows 本地和 Ubuntu CI 均通过后，再进入最终打包。
2. 将 typecheck 和严格归档检查纳入发布验收，绑定发布 commit、构建输入、包内容与 SHA-256。核查跨平台换行策略，避免只在单机通过。
3. 整理 DSH Bay 对外文案，补齐子包 npm 元数据、包根 README/LICENSE、17.5 changelog、安装与迁移说明、最新验证记录。
4. 确定 npm 发布账号、版本号和 dist-tag；验证名称与认证权限。决定源码是否公开；公开 npm 包不自动使私有 GitHub 仓库或其中的 Release 可被用户访问。
5. 确认实际域名和部署平台，完成 DNS/HTTPS、官网及下载文档关联。域名尚未确认不妨碍先完成源码、CI 和包文案准备。
6. 对最终同一归档完成 clean Profile 验收，再创建对应 tag/Release 和执行 npm 发布；发布后检查官方 registry 安装及文档入口。发布动作尚未执行。

## 查询依据

- GitHub authenticated REST：仓库、main commit、tags、releases、Actions runs/jobs、check annotations、Pages、branch protection、environments、Actions secret 名称清单。只读取元数据，没有展示或保存凭据内容。
- npm official registry：`dsh-bay`、`@dsh-workbench/core`；本机 `npm config get registry` 与针对官方 registry 的 `npm whoami`。
- 本地：quality.yml、根与子包 package.json、pack.mjs、README/CHANGELOG/VALIDATION、candidate.json，以及现有 tgz 的文件清单、manifest 和 SHA-256。

## 域名候选补充：2026-11-07 00:26（Asia/Shanghai）

已对候选进行注册局 RDAP 初筛：`dshbay.com`、`dsh-bay.com`、`dshbay.dev`、`dsh-bay.dev`、`dshbay.app`、`dsh-bay.app`、`getdshbay.com`、`usedshbay.com`、`dshbay.net`、`dshbay.org` 均返回 HTTP 404，未返回注册对象。`dshbay.io` 未能通过 IANA bootstrap 找到权威 RDAP 入口，未确认其状态。

推荐以 `dshbay.com` 为主域名；可选 `dsh-bay.com` 作品牌对应的跳转域名。偏开发者定位可考虑 `dshbay.dev`，偏产品入口可考虑 `dshbay.app`。这只是候选推荐，尚未选定、购买或配置正式域名。

Porkbun 公布的非溢价一年期参考价（USD）：.com 首年/续费均 11.81；.dev 首年 8.75、续费 12.87；.app 首年 8.75、续费 14.93。来源：https://porkbun.com/products/domains 。这些是后缀基准价，不是逐个域名的结账报价。RDAP 未返回注册对象不保证可购买，仍须在注册商核对即时可用性、保留/溢价状态与最终金额。

原始查询结果保存在本机 `releases/validation/domain-availability-2026-11-07.json`（已被仓库忽略，不含凭据）。

## dshbay.ai ????

2026-11-07 00:36?Asia/Shanghai???? IANA bootstrap ?? Identity Digital ??? RDAP?dshbay.ai ?? HTTP 404 / Object not found??????????????????????????????

Porkbun ? .ai ???????https://porkbun.com/tld/ai???????????? USD 82.70/???????????? 2 ????????????? 2 ? USD 165.40???????????????????
