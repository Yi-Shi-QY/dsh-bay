import { IconArchiveOutlineMedium, IconCheckCircleOutlineMedium, IconWarningOutlineMedium, IconRefreshOutlineMedium, IconFolderOpenOutlineMedium, IconDownloadOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompletePackageJobView } from '../workbench-complete-contract.ts'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'

export const completeJobLabels: Record<CompletePackageJobView['stage'], string> = { queued: '等待处理', preflight: '检查内容', snapshot: '准备恢复内容', files: '恢复项目文件', sessions: '恢复对话与附件', relations: '恢复任务与关联', publish: '登记工作台', complete: '已完成', cancelled: '已取消', failed: '需要处理' }

export function WorkbenchCompleteJob({ job, busy, disabled, showReport, onOpen, onResume, onCancel, onCorrectLocation, onDownload }: {
  job: CompletePackageJobView; busy: boolean; disabled: boolean; showReport?: boolean
  onOpen?: ((id: string) => void) | undefined
  onResume(job: CompletePackageJobView): void
  onCancel(job: CompletePackageJobView): void
  onCorrectLocation(job: CompletePackageJobView): void
  onDownload?: ((job: CompletePackageJobView) => void) | undefined
}) {
  const report = job.report
  const reportBody = report ? <div className={sharing.report}>
    <dl><div><dt>数据恢复</dt><dd>{report.data === 'complete' ? '已恢复' : report.data === 'blocked' ? '需要处理' : '处理中'}</dd></div><div><dt>运行环境</dt><dd>{report.environment === 'ready' ? '已就绪' : report.environment === 'needs-setup' ? '需要配置' : '待检查'}</dd></div><div><dt>任务状态</dt><dd>{report.tasks === 'waiting-for-user' ? '等待你继续' : '保持原状态'}</dd></div></dl>
    {report.blockers.length ? <div><strong>需要处理</strong><ul>{report.blockers.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {report.exclusions.length ? <div><strong>未包含的内容</strong><ul>{report.exclusions.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
    {report.environmentSteps.length ? <div><strong>运行前准备</strong><ul>{report.environmentSteps.map((text, i) => <li key={i}>{text}</li>)}</ul></div> : null}
  </div> : null
  return <article className={sharing.jobDetail} data-stage={job.stage}>
    <div className={sharing.job}>
      <span className={sharing.jobIcon}>{job.stage === 'complete' ? <IconCheckCircleOutlineMedium size={20} /> : job.stage === 'failed' ? <IconWarningOutlineMedium size={20} /> : <IconArchiveOutlineMedium size={20} />}</span>
      <div className={sharing.jobCopy}><strong>{job.name || (job.kind === 'import' ? '导入工作台' : '导出工作台')} · {job.kind === 'export' && job.stage === 'snapshot' ? '生成快照' : completeJobLabels[job.stage]}</strong><div className={sharing.jobMeta}><span>{job.files} 个条目 · {(job.bytes / 1024 / 1024).toFixed(1)} MB</span>{job.updatedAt ? <time dateTime={new Date(job.updatedAt).toISOString()}>{new Date(job.updatedAt).toLocaleString()}</time> : null}</div>
        {job.targetDisplayPath ? <small>{job.targetDisplayPath}</small> : null}
        {job.running ? <progress className={sharing.progress} aria-label={completeJobLabels[job.stage]} /> : null}
        {job.error ? <p role="alert">{job.error}</p> : null}
      </div>
    </div>
    <div className={sharing.jobActions}>
      {job.kind === 'import' && job.stage === 'complete' && onOpen ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onOpen(job.workbenchId)}><IconFolderOpenOutlineMedium size={16} />打开工作台</button> : null}
      {job.kind === 'export' && job.stage === 'complete' && onDownload ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onDownload(job)}><IconDownloadOutlineMedium size={16} />下载完整包</button> : null}
      {job.running ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onCancel(job)}>取消作业</button> : null}
      {job.canChangeDestination ? <button className={css.primaryButton} type="button" disabled={busy || disabled} onClick={() => onCorrectLocation(job)}><IconFolderOpenOutlineMedium size={16} />修改导入位置</button> : job.recoverable ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onResume(job)}><IconRefreshOutlineMedium size={16} />继续作业</button> : null}
    </div>
    {reportBody ? showReport ? reportBody : <details className={sharing.reportDetails}><summary>查看恢复报告</summary>{reportBody}</details> : null}
  </article>
}
