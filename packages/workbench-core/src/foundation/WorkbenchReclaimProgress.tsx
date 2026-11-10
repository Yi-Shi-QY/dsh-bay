import { reclaimLabels, reclaimPhases, type WorkbenchReclaimProgress as Progress } from '../workbench-reclaim.ts'
import css from './WorkbenchBrowserControlPage.module.css'

export function WorkbenchReclaimProgress({ value }: { value: Progress }) {
  const completed = reclaimPhases.indexOf(value.phase)
  return <section className={css.reclaimProgress} aria-live="polite" data-workbench-reclaim-progress>
    <div><strong>{value.error ? '收回需要处理' : value.phase === 'complete' ? '已回到 DSH 客户端' : '正在收回工作台'}</strong><span>{completed} / 5 步</span></div>
    <progress max={5} value={completed} aria-label="收回工作台进度" />
    <p>{value.error ?? reclaimLabels[value.phase]}</p>
    {value.forced ? <p className={css.forceWarning}>已使用最后保存的状态；浏览器尚未提交的最新修改未确认。</p> : null}
    {value.recovery === 'page-closed' ? <p>{value.phase === 'complete' ? '浏览器标签页已关闭，已恢复保存的状态。' : '浏览器标签页已关闭，正在按已保存状态恢复。'}关闭前未完成保存的修改无法确认。</p> : null}
  </section>
}
