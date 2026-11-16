/** Shared restart facts and fixed user messages; no browser or process authority. */
export type WorkbenchRestartPhaseV1 = 'accepted' | 'checkpointing' | 'stopping' | 'starting' | 'ready' | 'verified' | 'failed' | 'skipped'
export type WorkbenchRestartAvailabilityV1 = 'available' | 'unsupported' | 'supervisor-owned' | 'debugger-attached' | 'busy' | 'transaction-missing'
export interface WorkbenchRestartStatusV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly transactionId: string
  readonly transactionState: 'restart-required' | 'active' | 'failed' | 'missing'
  readonly phase: WorkbenchRestartPhaseV1
  readonly sourceRunReady: boolean
  readonly replacementRunReady: boolean
  readonly managerSucceeded: boolean
  readonly workbenchVerified: boolean
  readonly diagnosticCode?: string
}
export interface WorkbenchRestartCompletionV1 {
  readonly operationId: string
  readonly transactionId: string
  readonly status: WorkbenchRestartStatusV1
}
export type WorkbenchRestartObserverV1 = (status: WorkbenchRestartStatusV1) => void
export interface WorkbenchManagerRestartBridgeV2 {
  requestRestart(transactionId: string): Promise<{ operationId: string }>
  getRestartStatus(operationId: string): Promise<WorkbenchRestartStatusV1>
  waitForRestart(input: { operationId: string; transactionId: string; timeoutMs?: number; onStatus?: WorkbenchRestartObserverV1 }): Promise<WorkbenchRestartCompletionV1>
  resumeRestart(onStatus?: WorkbenchRestartObserverV1): Promise<WorkbenchRestartCompletionV1 | undefined>
}
export type WorkbenchManagerRestartBridgeV1 = WorkbenchManagerRestartBridgeV2

const messages = {
  'restart-unsupported': '当前启动方式不支持一键安全重启。请先关闭此 DSH 实例，再使用相同 Profile 重新启动。已安装模块和工作台布局会保留。',
  'restart-busy': '已有安装或重启操作正在进行，请等待当前操作完成。',
  'transaction-missing': '当前安装事务没有可用的重启标识，请先刷新或恢复事务状态。',
  'checkpoint-failed': '工作台状态保存失败，当前实例仍在运行。请在 Manager 中查看恢复记录。',
  'restart-failed': '未能确认重启完成。安装事务仍会保留，请刷新状态或在 Manager 中查看恢复记录。',
} as const
export class WorkbenchRestartError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); this.name = 'WorkbenchRestartError' }
}
export function restartFailure(code: unknown): WorkbenchRestartError {
  return new WorkbenchRestartError(typeof code === 'string' && Object.hasOwn(messages, code) ? code as keyof typeof messages : 'restart-failed')
}
export function workbenchRestartMessage(status: WorkbenchRestartStatusV1): string {
  if (status.phase === 'failed' || status.phase === 'skipped') return restartFailure(status.diagnosticCode).message
  return { accepted: '重启请求已接受，正在等待 Manager 保存状态', checkpointing: '正在保存工作台状态', stopping: '正在关闭当前实例', starting: '正在启动同一实例', ready: '正在验证内页模块', verified: '重启和内页模块验证已完成' }[status.phase]
}
export function isWorkbenchRestartComplete(status: WorkbenchRestartStatusV1): boolean {
  return status.phase === 'verified' && status.managerSucceeded && status.replacementRunReady
    && status.workbenchVerified && status.transactionState === 'active'
}
