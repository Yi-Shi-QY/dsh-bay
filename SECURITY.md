# DSH Bay 安全策略

## 报告安全问题

请使用 GitHub 的 Private Vulnerability Reporting 或维护者提供的私密安全渠道报告漏洞。不要在公开 Issue、Pull Request 或讨论中发布凭据、Session transcript、工作台导出包、利用代码或完整攻击步骤。

报告应尽量包含受影响的 DSH Bay 版本、DSH 版本、影响范围、复现步骤和临时缓解方式；请先脱敏所有日志和本地路径。

## 处理流程

维护者会确认收到报告，复现并评估影响，准备修复或缓解方案，在修复可用前限制细节公开，并在发布说明中记录受影响版本和升级建议。报告者可以在安全修复发布后参与公开致谢，除非其要求不署名。

## 开发者要求

贡献者不得提交 API key、DSH credentials、真实用户数据、机器标识、私有 artifact URL 或包含秘密的测试夹具。发布前必须从干净目录执行敏感信息扫描，并复核源码、Git 索引和 npm tarball。
