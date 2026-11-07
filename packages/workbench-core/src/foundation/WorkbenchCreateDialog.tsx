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

/** Creation names a layout and lets the user review an optional AI draft before saving it. */
export function WorkbenchCreateDialog({ directory, presetId, onClose, onCreated, generateDraft }: {
  directory: WorkbenchDirectory; presetId: WorkbenchLayoutPresetId; onClose(): void; onCreated(workbenchId: string): void
  generateDraft?: (input: { workbenchId: string; scope: 'workbench'; currentValue: string }) => Promise<string>
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [background, setBackground] = useState('')
  const [backgroundNotice, setBackgroundNotice] = useState<string>()
  const [createdId, setCreatedId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === presetId)!
  const createRecord = async () => {
    const result = await directory.create({ name, description, layoutPresetId: presetId })
    if (result.status !== 'committed') { setError(errorMessage(result)); return undefined }
    const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
    if (id === undefined) { setError('工作台已创建，但无法获取工作台地址。'); return undefined }
    setCreatedId(id)
    return id
  }
  const assist = async () => {
    if (busy) return
    if (generateDraft === undefined) { setError('当前环境未连接 DSH 原生 AI 服务。'); return }
    if (!name.trim()) { setError('请先输入工作台名称。'); return }
    setBusy(true); setError(undefined); setBackgroundNotice('正在读取工作台结构并请求一次性 AI 生成草稿…')
    try {
      const id = createdId ?? await createRecord()
      if (id === undefined) return
      const draft = await generateDraft({ workbenchId: id, scope: 'workbench', currentValue: background })
      if (draft.trim() === '') throw new Error('AI 返回了空的背景草稿。')
      setBackground(draft)
      setBackgroundNotice('已生成基于当前区域、内页和扩展信息的背景草稿，请确认后创建。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBackgroundNotice(undefined) }
    finally { setBusy(false) }
  }
  const discardTemporaryWorkbench = async () => {
    if (createdId === undefined) return
    // A host may require an open Workbench to be unloaded before it can be
    // deleted. Try the direct path first because the project-neutral adapter
    // can remove the active temporary record atomically; fall back to the
    // lifecycle-safe sequence for host implementations that protect open
    // records.
    const removed = await directory.remove(createdId).catch(() => undefined)
    if (removed?.status === 'rejected' && removed.reason === 'still-open') {
      await directory.unload(createdId).catch(() => undefined)
      await directory.remove(createdId).catch(() => undefined)
    }
  }
  const create = async () => {
    if (busy || !name.trim()) return
    setBusy(true); setError(undefined)
    try {
      if (createdId !== undefined) {
        const metadata = await directory.updateMetadata(createdId, { name, description })
        if (metadata.status !== 'committed') { setError(errorMessage(metadata)); return }
        const result = await directory.updateWorkbenchBackground?.(createdId, background) ?? { status: 'unavailable' as const }
        if (result.status !== 'committed') { setError(errorMessage(result)); return }
        onCreated(createdId); onClose(); return
      }
      const result = await directory.create({ name, description, layoutPresetId: presetId, ...(background.trim() === '' ? {} : { background }) })
      if (result.status !== 'committed') { setError(errorMessage(result)); return }
      const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
      if (id) onCreated(id)
      onClose()
    } catch { setError('暂时无法创建工作台，请恢复连接后重试。') } finally { setBusy(false) }
  }
  const close = () => { if (!busy) { void discardTemporaryWorkbench(); onClose() } }
  return <Modal open onClose={close} title="创建工作台" headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void create() }}>
      <header className={css.wizardHeader}><h2>创建工作台</h2><Button type="button" aria-label="关闭创建窗口" disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <div className={css.selectedPreset}><WorkbenchPresetIcon node={preset.root} /><span>{preset.name}<small>{preset.areas} 个区域</small></span></div>
        <label>名称<Input data-modal-autofocus maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：项目开发" /></label>
        <label>简介（可选）<textarea rows={2} maxLength={4000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="写下这个工作台的用途" /></label>
        <label>工作台背景（可选）<textarea rows={4} maxLength={20_000} value={background} disabled={busy} onChange={event => { setBackground(event.target.value); setBackgroundNotice(undefined) }} placeholder="目标、长期约束、偏好和成功标准" /></label>
        <Button type="button" disabled={busy} onClick={() => { void assist() }}>AI 辅助生成背景草稿</Button>
        {backgroundNotice ? <p role="status">{backgroundNotice}</p> : null}
        {error ? <p className={css.error} role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={close}>取消</Button><Button type="submit" variant="primary" disabled={busy || !name.trim()}>{busy ? '正在创建…' : '创建并打开'}</Button></footer>
    </form>
  </Modal>
}
