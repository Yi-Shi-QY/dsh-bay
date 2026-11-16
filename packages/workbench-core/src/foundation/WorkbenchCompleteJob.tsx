import { IconArchiveOutlineMedium, IconCheckCircleOutlineMedium, IconWarningOutlineMedium, IconRefreshOutlineMedium, IconFolderOpenOutlineMedium, IconDownloadOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CompletePackageJobView } from '../workbench-complete-contract.ts'
import css from './WorkbenchSettings.module.css'
import sharing from './WorkbenchSharing.module.css'
import { useState } from 'react'

export const completeJobLabels: Record<CompletePackageJobView['stage'], string> = { queued: '等待处理', preflight: '检查内容', snapshot: '准备恢复内容', files: '准备项目文件与布局', 'awaiting-extensions': '确认扩展与权限', 'installing-extensions': '安装扩展', 'awaiting-restart': '等待重启 DSH', sessions: '恢复对话与附件', 'extension-data': '恢复扩展数据', 'awaiting-page-state': '恢复内页配置', relations: '恢复任务与关联', verifying: '校验完整性', publish: '登记工作台', complete: '已完成', blocked: '等待处理阻断项', cancelled: '已取消', failed: '需要处理' }

export function WorkbenchCompleteJob({ job, busy, disabled, showReport, onOpen, onResume, onCancel, onCorrectLocation, onDownload, onConfirmExtensions, onMapExtensions, onRestart, browser }: {
  job: CompletePackageJobView; busy: boolean; disabled: boolean; showReport?: boolean
  onOpen?: ((id: string) => void) | undefined
  onResume(job: CompletePackageJobView): void
  onCancel(job: CompletePackageJobView): void
  onCorrectLocation(job: CompletePackageJobView): void
  onDownload?: ((job: CompletePackageJobView) => void) | undefined
  onConfirmExtensions?: ((job: CompletePackageJobView) => void) | undefined
  onMapExtensions?: ((job: CompletePackageJobView) => void) | undefined
  onRestart?: ((job: CompletePackageJobView) => void) | undefined
  browser?: boolean | undefined
}) {
  const [approvedDigest, setApprovedDigest] = useState<string>()
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
    {job.kind === 'import' && job.stage !== 'complete' && job.extensions?.length ? <section className={sharing.report} aria-label="所需扩展与权限">
      <strong>所需扩展</strong>
      {job.extensions.map(({ extension, state, message }) => <div key={extension.packageName}>
        <strong>{extension.packageName} · {extension.version}</strong>
        <p>{message ?? (state === 'ready' ? '精确版本已激活，迁移能力就绪' : '等待检查')} · {extension.artifactPath ? '包内离线制品' : '接收方安装'}</p>
        <p>权限：{extension.permissions.join('、') || '无额外权限'}</p>
        <details><summary>制品与迁移声明</summary><code>{extension.artifactSha256}</code><p>{extension.migrations.events.length} 类会话事件 · {extension.migrations.workbenchData.length} 项工作台数据</p></details>
      </div>)}
      {job.stage === 'awaiting-extensions' && !browser ? <label><input type="checkbox" checked={!!job.extensionPlanDigest && approvedDigest === job.extensionPlanDigest} onChange={event => setApprovedDigest(event.target.checked ? job.extensionPlanDigest : undefined)} />我已核对扩展版本、来源和权限，允许安装以上扩展</label> : null}
    </section> : null}
    {job.stage === 'awaiting-restart' ? <p className={sharing.hint} role="status">文件与布局已准备，尚未发布工作台。{browser ? '请返回 DSH 客户端确认重启。' : '请保存其他工作后重启 DSH，再从导入记录继续此作业。'}原作业 ID 和会话映射会保留。</p> : null}
    {browser && job.stage === 'awaiting-extensions' ? <p className={sharing.hint}>请在 DSH 客户端的导入记录确认扩展和权限。</p> : null}
    <div className={sharing.jobActions}>
      {!browser && job.packageVersion === 5 && job.stage === 'awaiting-extensions' && !job.extensions && onMapExtensions ? <button className={css.primaryButton} disabled={busy || disabled} onClick={() => onMapExtensions(job)}>检查并映射本机扩展</button> : null}
      {!browser && job.stage === 'awaiting-extensions' && job.extensions?.length && onConfirmExtensions ? <button className={css.primaryButton} disabled={busy || disabled || approvedDigest !== job.extensionPlanDigest} onClick={() => onConfirmExtensions(job)}>确认扩展并继续</button> : null}
      {!browser && job.stage === 'awaiting-restart' && onRestart && job.restartTransactionId ? <button className={css.primaryButton} disabled={busy || disabled} onClick={() => onRestart(job)}>重启并继续导入</button> : null}
      {job.kind === 'import' && job.stage === 'complete' && onOpen ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onOpen(job.workbenchId)}><IconFolderOpenOutlineMedium size={16} />打开工作台</button> : null}
      {job.kind === 'export' && job.stage === 'complete' && onDownload ? <button className={css.primaryButton} type="button" disabled={busy} onClick={() => onDownload(job)}><IconDownloadOutlineMedium size={16} />下载完整包</button> : null}
      {job.running || ['awaiting-extensions', 'awaiting-restart', 'blocked'].includes(job.stage) ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onCancel(job)}>取消作业</button> : null}
      {job.canChangeDestination ? <button className={css.primaryButton} type="button" disabled={busy || disabled} onClick={() => onCorrectLocation(job)}><IconFolderOpenOutlineMedium size={16} />修改导入位置</button> : job.recoverable ? <button className={css.secondaryButton} type="button" disabled={busy || disabled} onClick={() => onResume(job)}><IconRefreshOutlineMedium size={16} />{job.stage === 'awaiting-page-state' ? '恢复内页配置并继续' : job.stage === 'awaiting-restart' ? '检查重启并继续' : '继续作业'}</button> : null}
    </div>
    {reportBody ? showReport ? reportBody : <details className={sharing.reportDetails}><summary>查看恢复报告</summary>{reportBody}</details> : null}
  </article>
}
