import { useState } from 'react'
import { Button, Modal, IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectoryOperationResult } from './frame-settings-adapter.ts'
import type { WorkbenchAiDraftInputV1 } from './workbench-ai.ts'
import css from './WorkbenchHome.module.css'

function resultMessage(result: WorkbenchDirectoryOperationResult): string | undefined {
  if (result.status === 'committed') return undefined
  if (result.status === 'conflict') return '设置刚刚发生了变化，请刷新后重试。'
  if (result.status === 'rejected') return '当前工作台状态不允许保存这段背景。'
  return '背景暂时无法保存，请恢复连接后重试。'
}

/** Small shared editor for the human-owned background projection. */
export function WorkbenchContextDialog({
  directory, workbenchId, areaId, title, initialValue, onClose, onSaved, generateDraft,
}: {
  directory: WorkbenchDirectory
  workbenchId: string
  areaId?: string
  title: string
  initialValue: string
  onClose(): void
  onSaved?(): void
  generateDraft?: (input: Exclude<WorkbenchAiDraftInputV1, { scope: 'create' }>) => Promise<string>
}) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const save = async () => {
    if (busy) return
    setBusy(true); setError(undefined)
    const result = areaId === undefined
      ? await directory.updateWorkbenchBackground?.(workbenchId, value) ?? { status: 'unavailable' as const }
      : await directory.updateAreaBackground?.(workbenchId, areaId, value) ?? { status: 'unavailable' as const }
    const message = resultMessage(result)
    if (message !== undefined) setError(message)
    else { onSaved?.(); onClose() }
    setBusy(false)
  }
  const assist = async () => {
    if (generateDraft === undefined) { setError('当前环境未连接 DSH 原生 AI 服务。'); return }
    setBusy(true); setError(undefined); setNotice(areaId === undefined ? '正在根据工作台简介、项目、区域和内页生成背景草稿…' : '正在根据此项目各区域的内页生成背景草稿…')
    try {
      const draft = await generateDraft(areaId === undefined
        ? { workbenchId, scope: 'workbench', currentValue: value }
        : { workbenchId, scope: 'area', areaId, currentValue: value })
      if (draft.trim() === '') throw new Error('AI 返回了空的背景草稿。')
      setValue(draft); setNotice('已生成基于当前范围事实的背景草稿，请确认后保存。')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setNotice(undefined) }
    finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title={title} headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void save() }}>
      <header className={css.wizardHeader}><h2>{title}</h2><Button type="button" aria-label="关闭" disabled={busy} onClick={onClose}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <label>背景说明<textarea rows={9} maxLength={20_000} value={value} disabled={busy} onChange={event => { setValue(event.target.value); setNotice(undefined) }} placeholder="可选。填写目标、约束、偏好和成功标准。" /></label>
        <Button type="button" disabled={busy} onClick={() => { void assist() }}>AI 辅助生成草稿</Button>
        {notice ? <p role="status">{notice}</p> : null}
        {error ? <p className={css.error} role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存背景'}</Button></footer>
    </form>
  </Modal>
}
