import type { WorkbenchWindowRequestV1 } from './workbench-window-controller.ts'

export type WorkbenchBrowserLocalPhaseV1 = 'preparing' | 'opening' | 'reclaiming' | 'idle'
export type WorkbenchBrowserLifecyclePhaseV1 =
  | 'idle' | 'preparing' | 'opening' | 'initializing' | 'ready' | 'reclaiming'
  | 'reclaimed' | 'closed' | 'failed' | 'expired'

export interface WorkbenchBrowserLifecycleProjectionV1 {
  readonly phase: WorkbenchBrowserLifecyclePhaseV1
  readonly label: string
  readonly detail: string
  readonly busy: boolean
  readonly canReclaim: boolean
  readonly desktopLocked: boolean
  readonly browserControlsWorkbench: boolean
}

function projection(
  phase: WorkbenchBrowserLifecyclePhaseV1,
  label: string,
  detail: string,
  busy: boolean,
  canReclaim: boolean,
): WorkbenchBrowserLifecycleProjectionV1 {
  const browserControlsWorkbench = phase === 'ready' || phase === 'reclaiming'
    || phase === 'failed' && canReclaim
  const desktopLocked = ['preparing', 'opening', 'initializing'].includes(phase) || browserControlsWorkbench
  return { phase, label, detail, busy, canReclaim, desktopLocked, browserControlsWorkbench }
}

/** Host request state wins over local click feedback whenever it is available. */
export function projectWorkbenchBrowserLifecycleV1(
  request?: WorkbenchWindowRequestV1,
  localPhase?: WorkbenchBrowserLocalPhaseV1,
): WorkbenchBrowserLifecycleProjectionV1 {
  const status = request?.status
  if (status === 'ready') return projection('ready', '浏览器已连接', '当前工作台正在浏览器中使用。', false, true)
  if (status === 'reclaiming') return projection('reclaiming', '正在收回', '正在等待浏览器保存并交还工作台。', true, true)
  if (status === 'reclaimed') return projection('reclaimed', '已收回', '工作台控制权已交还给 DSH 客户端。', false, false)
  if (status === 'closed') return projection('closed', '浏览器已关闭', '浏览器页面关闭后，工作台已恢复到 DSH 客户端。', false, false)
  if (status === 'expired') return projection('expired', '连接已过期', '浏览器连接已过期，可从 DSH 客户端重新打开。', false, false)
  if (status === 'failed') {
    const recoverable = request?.code === 'browser-view-heartbeat-timeout'
      || request?.code === 'browser-view-reclaim-timeout'
    return recoverable
      ? projection('failed', '连接中断', '浏览器暂时失去连接，可从 DSH 收回控制权。', false, true)
      : projection('failed', '接管失败', '浏览器未能接管工作台，可继续在 DSH 客户端使用。', false, false)
  }
  if (status === 'redeemed') return projection('initializing', '正在载入', '浏览器正在连接 DSH 并恢复工作台。', true, false)
  if (status === 'requested' || status === 'prepared') return projection('opening', '正在打开', '正在打开浏览器并初始化工作台。', true, false)
  if (status === 'preparing') return projection('preparing', '正在准备', '正在保存当前布局并准备浏览器连接。', true, false)
  if (localPhase === 'reclaiming') return projection('reclaiming', '正在收回', '正在等待浏览器保存并交还工作台。', true, true)
  if (localPhase === 'preparing') return projection('preparing', '正在准备', '正在保存当前布局并准备浏览器连接。', true, false)
  if (localPhase === 'opening') return projection('opening', '正在打开', '正在打开浏览器并初始化工作台。', true, false)
  return projection('idle', '未接管', '当前工作台由 DSH 客户端控制。', false, false)
}
