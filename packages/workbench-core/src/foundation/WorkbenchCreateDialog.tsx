import { useState } from 'react'
import { Button, Input, Modal, IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectoryCreateResult } from './frame-settings-adapter.ts'
import { WORKBENCH_LAYOUT_PRESETS, type WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchPresetIcon } from './WorkbenchPresetIcon.tsx'
import css from './WorkbenchHome.module.css'

function errorMessage(result: WorkbenchDirectoryCreateResult): string {
  if (result.status === 'rejected') {
    if (result.reason === 'duplicate-name') return '已经有同名工作台，请换一个名称。'
    if (result.reason === 'invalid-name') return '请输入工作台名称。'
    if (result.reason === 'invalid-preset') return '区域划分已失效，请重新选择。'
  }
  if (result.status === 'conflict') return '设置刚刚发生了变化，请重试。'
  return '暂时无法创建工作台，请恢复连接或处理未保存的布局后重试。'
}

/** Creation only names an empty geometry; each Area owns its existing editor picker. */
export function WorkbenchCreateDialog({ directory, presetId, onClose, onCreated }: {
  directory: WorkbenchDirectory; presetId: WorkbenchLayoutPresetId; onClose(): void; onCreated(workbenchId: string): void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === presetId)!
  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true); setError(undefined)
    try {
      const result = await directory.create({ name, description, layoutPresetId: presetId })
      if (result.status !== 'committed') { setError(errorMessage(result)); return }
      const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
      if (id) onCreated(id)
      onClose()
    } catch { setError('暂时无法创建工作台，请恢复连接后重试。') } finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title="创建工作台" headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void create() }}>
      <header className={css.wizardHeader}><h2>创建工作台</h2><Button type="button" aria-label="关闭创建窗口" disabled={busy} onClick={onClose}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <div className={css.selectedPreset}><WorkbenchPresetIcon node={preset.root} /><span>{preset.name}<small>{preset.areas} 个区域</small></span></div>
        <label>名称<Input data-modal-autofocus maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：项目开发" /></label>
        <label>简介（可选）<textarea rows={2} maxLength={4000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="写下这个工作台的用途" /></label>
        {error ? <p className={css.error} role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建并打开'}</Button></footer>
    </form>
  </Modal>
}
