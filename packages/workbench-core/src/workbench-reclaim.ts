/** Progress records facts, not elapsed-time estimates. Window IDs fence handoffs. */
export type ReclaimPhase = 'notifying' | 'saving' | 'releasing' | 'restoring' | 'checking' | 'complete'
export interface WorkbenchReclaimProgress {
  phase: ReclaimPhase
  forced?: boolean
  recovery?: 'page-closed'
  error?: string
}
export const reclaimPhases: readonly ReclaimPhase[] = ['notifying', 'saving', 'releasing', 'restoring', 'checking', 'complete']
export const reclaimLabels: Record<ReclaimPhase, string> = {
  notifying: '正在通知浏览器准备交还工作台…',
  saving: '正在保存浏览器中的布局和内页状态…',
  releasing: '正在同步浮动标签并交还控制权…',
  restoring: '正在读取最新工作台并恢复浮动工作区…',
  checking: '正在恢复桌面区域和当前对话…',
  complete: '工作台已收回，可以继续工作。',
}
export function decodeReclaimProgress(value: unknown): WorkbenchReclaimProgress | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Partial<WorkbenchReclaimProgress>
  if (!reclaimPhases.includes(row.phase as ReclaimPhase) || (row.forced !== undefined && typeof row.forced !== 'boolean') || (row.recovery !== undefined && row.recovery !== 'page-closed') || (row.error !== undefined && typeof row.error !== 'string')) return undefined
  return { phase: row.phase as ReclaimPhase, ...(row.forced ? { forced: true } : {}), ...(row.recovery ? { recovery: row.recovery } : {}), ...(row.error ? { error: row.error } : {}) }
}
