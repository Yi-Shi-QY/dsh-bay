/** Stable, recipient-safe diagnostics. Never render arbitrary Host exception text. */
const errors = {
  'profile-unowned-module': ['当前 Profile 已存在未由 Workbench 管理的内页模块。', '验证并认领，或使用原安装来源处理。'],
  'profile-identity-conflict': ['当前 Profile 中的同名内页模块版本或摘要不匹配。', '使用原安装来源卸载或升级后重新检查，Workbench 不会覆盖它。'],
  'owned-module-not-verified': ['内页模块文件或身份尚未通过验证。', '检查操作记录；已接管的精确身份可执行修复。'],
  'restart-required': ['安装事务等待重启验证。', '使用一键安全重启，或关闭此实例后使用相同 Profile 重新启动。'],
  'restart-unsupported': ['当前启动方式不支持一键安全重启。', '请先关闭此 DSH 实例，再使用相同 Profile 重新启动。已安装模块和工作台布局会保留。'],
  'restart-busy': ['已有安装或重启操作正在进行。', '等待当前操作完成后刷新状态。'],
  'restart-failed': ['尚未确认 DSH 重启完成。', '刷新操作状态，或在 Manager 中查看恢复记录。'],
  'catalog-invalid': ['扩展目录无效或未通过信任校验。', '重新导入完整的受信签名目录。'],
  'catalog-revoked': ['此扩展已被目录撤销。', '获取新的受信目录；当前扩展禁止安装、认领、修复和激活。'],
  'module-incompatible': ['扩展与当前 DSH 版本或能力不兼容。', '检查 DSH 代际、Core 版本和所需能力。'],
  'source-not-allowed': ['此来源请求不符合允许的格式。', '选择合法的 npm 包或 HTTPS Git 仓库。'],
  'source-resolution-failed': ['无法解析所选来源。', '检查网络、版本、仓库地址或 Host 配置的凭据后重试。'],
  'package-manifest-invalid': ['扩展包缺少有效的 Workbench 清单。', '选择具有完整身份、权限和兼容性声明的扩展包。'],
  'artifact-integrity-mismatch': ['扩展包完整性校验失败。', '重新获取精确版本的可信制品后检查。'],
  'version-downgrade': ['目标版本低于当前版本，已阻止降级。', '保留当前版本，或选择兼容的较新版本。'],
  'source-change-requires-confirmation': ['当前模块来自另一来源。', '检查两个来源的精确身份，在独立来源切换流程中确认。'],
  'transaction-recovery-required': ['已有安装事务需要恢复或重启。', '先完成当前事务的恢复，再开始新的操作。'],
} as const

export type WorkbenchUserErrorCodeV2 = keyof typeof errors
export interface WorkbenchUserErrorV2 {
  readonly code: WorkbenchUserErrorCodeV2
  readonly message: string
  readonly nextAction: string
  readonly diagnosticId?: string
  readonly transactionId?: string
}
export function workbenchUserError(code: unknown, fallback: WorkbenchUserErrorCodeV2 = 'transaction-recovery-required'): WorkbenchUserErrorV2 {
  const key = typeof code === 'string' && Object.hasOwn(errors, code) ? code as WorkbenchUserErrorCodeV2 : fallback
  return { code: key, message: errors[key][0], nextAction: errors[key][1] }
}
export class WorkbenchOperationError extends Error {
  readonly userError: WorkbenchUserErrorV2
  constructor(code: unknown, fallback?: WorkbenchUserErrorCodeV2) {
    const detail = workbenchUserError(code, fallback)
    super(`${detail.message} ${detail.nextAction}`)
    this.name = 'WorkbenchOperationError'
    this.userError = detail
  }
}
