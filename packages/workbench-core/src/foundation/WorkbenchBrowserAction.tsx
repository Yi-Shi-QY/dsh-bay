import { useState } from 'react'
import { IconBrowseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchWindowSnapshotV1 } from '../client/workbench-window-controller.ts'
import { isElectronCarrier } from '../client/browser-window-controller.ts'
import { projectWorkbenchBrowserLifecycleV1 } from '../client/workbench-browser-lifecycle.ts'

/** A per-workbench tab action for opening or reclaiming its browser view. */
export function WorkbenchBrowserAction({
  workbenchId, workbenchName, windowSnapshot, onPrepareOpen, onOpenWindow, onReclaim, onTransition,
  className, showLabel = false,
}: {
  workbenchId: string
  workbenchName: string
  windowSnapshot: WorkbenchWindowSnapshotV1
  onPrepareOpen: (workbenchId: string) => Promise<boolean>
  onOpenWindow: (workbenchId: string, popup?: Window | null) => Promise<void>
  onReclaim?: ((workbenchId: string) => Promise<void>) | undefined
  onTransition?: ((workbenchId: string, phase: 'preparing' | 'opening' | 'reclaiming' | 'idle') => void) | undefined
  className?: string | undefined
  showLabel?: boolean
}) {
  const [preparing, setPreparing] = useState(false)
  const [prepareFailed, setPrepareFailed] = useState(false)
  const [opening, setOpening] = useState(false)
  const [reclaiming, setReclaiming] = useState(false)
  const request = windowSnapshot.requests?.find(row => row.workbenchId === workbenchId)
    ?? (windowSnapshot.request?.workbenchId === workbenchId ? windowSnapshot.request : undefined)
  const handoffStatus = request?.status
  const localPhase = preparing ? 'preparing' : opening ? 'opening' : reclaiming ? 'reclaiming' : 'idle'
  const lifecycle = projectWorkbenchBrowserLifecycleV1(request, localPhase)
  const browserViewReady = lifecycle.phase === 'ready' || lifecycle.phase === 'failed' && lifecycle.canReclaim
  const isBusy = lifecycle.busy
  const label = browserViewReady
    ? `收回“${workbenchName}”到 DSH 客户端`
    : lifecycle.phase === 'reclaiming' ? `正在收回“${workbenchName}”…`
      : lifecycle.phase === 'opening' || lifecycle.phase === 'initializing' ? `正在浏览器中打开“${workbenchName}”…`
        : lifecycle.phase === 'preparing' ? `正在准备“${workbenchName}”…`
          : !windowSnapshot.supported ? `DSH 浏览器窗口服务不可用：${workbenchName}`
            : prepareFailed ? `重试在浏览器打开“${workbenchName}”`
              : `在浏览器打开工作台“${workbenchName}”`
  const state = browserViewReady ? 'ready'
    : lifecycle.phase === 'reclaiming' ? 'reclaiming'
      : lifecycle.phase === 'initializing' ? 'initializing'
        : lifecycle.phase === 'opening' ? 'requested'
          : lifecycle.phase === 'preparing' ? 'preparing'
            : lifecycle.phase === 'failed' || prepareFailed ? 'failed'
              : lifecycle.phase === 'expired' ? 'expired'
                : windowSnapshot.supported ? 'idle' : 'unsupported'

  const handleClick = () => {
    if (isBusy) return
    if (lifecycle.canReclaim) {
      if (onReclaim === undefined) return
      onTransition?.(workbenchId, 'reclaiming')
      setReclaiming(true)
      void onReclaim(workbenchId).catch(() => {}).finally(() => { setReclaiming(false); onTransition?.(workbenchId, 'idle') })
      return
    }
    const popup = typeof window !== 'undefined' && !isElectronCarrier()
      ? window.open('about:blank', '_blank')
      : undefined
    if (popup !== undefined && popup !== null) {
      try { popup.opener = null } catch { /* opener can be read-only */ }
    }
    setPreparing(true)
    setPrepareFailed(false)
    onTransition?.(workbenchId, 'preparing')
    void onPrepareOpen(workbenchId).then(value => {
      if (!value) throw new Error('browser-link-prepare-failed')
      setOpening(true)
      onTransition?.(workbenchId, 'opening')
      const opening = popup === undefined
        ? onOpenWindow(workbenchId)
        : onOpenWindow(workbenchId, popup)
      return opening.finally(() => { setOpening(false) })
    }).catch(() => {
      popup?.close()
      setPrepareFailed(true)
    }).finally(() => { setPreparing(false); onTransition?.(workbenchId, 'idle') })
  }

  return <button
    type="button"
    className={className}
    role={showLabel ? 'menuitem' : undefined}
    data-action="browser"
    data-state={state}
    aria-label={label}
    title={label}
    disabled={isBusy || (lifecycle.canReclaim && onReclaim === undefined)}
    onClick={handleClick}
  ><IconBrowseOutlineMedium size={16} />{showLabel ? <span>{browserViewReady ? '收回到 DSH 客户端' : lifecycle.phase === 'reclaiming' ? '正在收回' : '在浏览器打开'}</span> : null}</button>
}
