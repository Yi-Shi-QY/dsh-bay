import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { WorkbenchCollaborationClientV1 } from '../client/workbench-collaboration-client.ts'
import type { SharedCanvasViewportV1 } from '../workbench-collaboration-contract.ts'

export interface SharedCanvasFitV1 {
  /** Logical canvas size every participant renders. */
  readonly width: number
  readonly height: number
  /** Factor between the logical canvas and this device. */
  readonly scale: number
  /** Blank margin that centres a canvas smaller than the page. */
  readonly offsetX: number
  readonly offsetY: number
  /** True when the scaled canvas is larger than the page and must scroll. */
  readonly scroll: boolean
}

/**
 * Fit the shared logical canvas into the space this device has.
 *
 * - `contain` shows the whole canvas and leaves blank margins.
 * - `cover` fills the page and scrolls the part that does not fit.
 * - `fixed` keeps the logical pixels and scrolls.
 *
 * Returns undefined when either size is unusable, and when the page already
 * has the logical size, so the caller renders the canvas untouched.
 */
export function fitSharedCanvas(viewport: SharedCanvasViewportV1 | undefined, available: { readonly width: number; readonly height: number }): SharedCanvasFitV1 | undefined {
  if (viewport === undefined) return undefined
  const { width, height } = viewport
  if (!(width > 0) || !(height > 0) || !(available.width > 0) || !(available.height > 0)) return undefined
  if (Math.abs(width - available.width) < 1 && Math.abs(height - available.height) < 1) return undefined
  const ratioX = available.width / width
  const ratioY = available.height / height
  const scale = viewport.scaleMode === 'fixed' ? 1 : viewport.scaleMode === 'cover' ? Math.max(ratioX, ratioY) : Math.min(ratioX, ratioY)
  const scaledWidth = width * scale
  const scaledHeight = height * scale
  return {
    width, height, scale,
    offsetX: Math.max(0, (available.width - scaledWidth) / 2),
    offsetY: Math.max(0, (available.height - scaledHeight) / 2),
    scroll: scaledWidth > available.width + 0.5 || scaledHeight > available.height + 0.5,
  }
}

const FILL: CSSProperties = { position: 'absolute', inset: 0 }

/**
 * Renders its children on the shared logical canvas.
 *
 * The element structure is the same whether or not a fit applies, so the
 * Workbench below it is never remounted when the viewport arrives or changes.
 */
export function WorkbenchSharedCanvasViewport({ client, enabled, children }: {
  readonly client?: WorkbenchCollaborationClientV1 | undefined
  readonly enabled: boolean
  readonly children: ReactNode
}): ReactNode {
  const outer = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState({ width: 0, height: 0 })
  const viewport = useSyncExternalStore(
    listener => client?.subscribe(() => { listener() }) ?? (() => {}),
    () => client?.getSnapshot()?.sharedCanvas.viewport,
    () => client?.getSnapshot()?.sharedCanvas.viewport,
  )
  useEffect(() => {
    const element = outer.current
    if (!enabled || element === null) return
    const measure = () => {
      const width = element.clientWidth, height = element.clientHeight
      setAvailable(current => current.width === width && current.height === height ? current : { width, height })
    }
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [enabled])
  const fit = enabled ? fitSharedCanvas(viewport, available) : undefined
  const inner: CSSProperties = fit === undefined ? FILL : {
    position: 'absolute', left: fit.offsetX, top: fit.offsetY, width: fit.width, height: fit.height,
    transform: `scale(${fit.scale})`, transformOrigin: '0 0',
  }
  return <div
    ref={outer}
    data-workbench-shared-canvas={fit === undefined ? 'native' : 'scaled'}
    data-workbench-shared-canvas-scale={fit?.scale}
    style={{ ...FILL, overflow: fit?.scroll === true ? 'auto' : 'hidden' }}
  >
    <div data-workbench-shared-canvas-surface style={inner}>{children}</div>
  </div>
}

/** Text for the collaboration connection state, or undefined when connected. */
export function collaborationStatusLabel(state: ReturnType<WorkbenchCollaborationClientV1['getState']> | undefined): string | undefined {
  if (state === 'recovering') return '正在恢复与 Host 的连接，工作台暂时只读'
  if (state === 'connecting') return '正在连接协作会话…'
  if (state === 'closed') return '协作已结束，此页面不再同步'
  return undefined
}
