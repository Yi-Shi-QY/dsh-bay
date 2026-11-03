import { useEffect, useState, type ReactNode } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WorkbenchWindowRoot.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'workbench.window.surface': { kind: 'list'; scope: 'root' }
  }
}

/** Dedicated composition, selected only inside a companion-owned document. */
export function WorkbenchWindowRoot(props: PropsRenderSlots<'workbench.window.surface'>): ReactNode {
  const [reclaimState, setReclaimState] = useState<'requested' | 'reclaimed'>()
  useEffect(() => {
    const receive = (event: Event) => {
      const state = (event as CustomEvent<{ state?: unknown }>).detail?.state
      if (state === 'requested' || state === 'reclaimed') setReclaimState(state)
    }
    window.addEventListener('workbench-browser-reclaim', receive)
    return () => window.removeEventListener('workbench-browser-reclaim', receive)
  }, [])
  return <div className={css.root}>
    {props.renderSlot('workbench.window.surface', {})}
    {reclaimState === undefined ? null : <div className={css.lock} role="alertdialog" aria-modal="true" aria-live="polite" aria-busy={reclaimState === 'requested'}>
      <section className={css.message} data-reclaim-state={reclaimState}>
      {reclaimState === 'requested' ? <span className={css.spinner} aria-hidden="true" /> : null}
      <h1>{reclaimState === 'reclaimed' ? '工作台已收回到 DSH 客户端' : '正在收回工作台'}</h1>
      <p>{reclaimState === 'reclaimed'
        ? '此浏览器页面已锁定，工作台现在由 DSH 客户端控制。你可以关闭此页面。'
        : '此页面已停止操作，正在等待 DSH 客户端确认。'}</p>
      {reclaimState === 'reclaimed' ? <button type="button" onClick={() => window.close()}>关闭此页面</button> : null}
      </section>
    </div>}
  </div>
}
