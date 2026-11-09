import { browserSafeUuid } from '../browser-safe-id.ts'
import { useState } from 'react'
import { Button, Input, Modal, IconCloseOutlineMedium, IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectoryCreateResult } from './frame-settings-adapter.ts'
import { WORKBENCH_LAYOUT_PRESETS, type WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchPresetIcon } from './WorkbenchPresetIcon.tsx'
import type { WorkbenchCreationDraftInputV1 } from './workbench-ai.ts'
import css from './WorkbenchHome.module.css'
import folders from './WorkbenchFolders.module.css'

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
  generateDraft?: (input: WorkbenchCreationDraftInputV1) => Promise<string>
}) {
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [requestId] = useState(() => browserSafeUuid())
  const [description, setDescription] = useState('')
  const [background, setBackground] = useState('')
  const [backgroundNotice, setBackgroundNotice] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const needsLocation = directory.pickParentDirectory !== undefined
  const canCreate = !!name.trim() && (!needsLocation || !!parentPath.trim())
  const separator = parentPath.includes('\\') ? '\\' : '/'
  const targetPath = parentPath ? `${parentPath.replace(/[\\/]$/u, '')}${separator}${folderName.trim() || name.trim()}` : ''
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === presetId)!
  const assist = async () => {
    if (busy) return
    if (generateDraft === undefined) { setError('当前环境未连接 DSH 原生 AI 服务。'); return }
    if (!name.trim()) { setError('请先输入工作台名称。'); return }
    setBusy(true); setError(undefined); setBackgroundNotice('正在根据当前名称和简介生成背景草稿…')
    try {
      const draft = await generateDraft({ scope: 'create', name, description, currentValue: background })
      if (draft.trim() === '') throw new Error('AI 返回了空的背景草稿。')
      setBackground(draft)
      setBackgroundNotice('已根据名称和简介生成草稿，请编辑确认后创建。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBackgroundNotice(undefined) }
    finally { setBusy(false) }
  }
  const create = async () => {
    if (busy || !canCreate) return
    setBusy(true); setError(undefined)
    try {
      const result = await directory.create({ name, description, parentPath, folderName: folderName.trim() || name.trim(), requestId, layoutPresetId: presetId, ...(background.trim() === '' ? {} : { background }) })
      if (result.status !== 'committed') { setError(errorMessage(result)); return }
      const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
      if (id) onCreated(id)
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法创建工作台，请恢复连接后重试。') } finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Modal open onClose={close} title="创建工作台" headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void create() }}>
      <header className={css.wizardHeader}><div><h2>创建工作台</h2><p className={css.formHint}>为对话、项目文件和工作背景创建一个空间。</p></div><Button type="button" aria-label="关闭创建窗口" disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <div className={css.selectedPreset}><WorkbenchPresetIcon node={preset.root} /><span>{preset.name}<small>{preset.areas} 个区域</small></span></div>
        <label>名称<Input className={css.formInput ?? ''} data-modal-autofocus maxLength={160} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：项目开发" /></label>
        {directory.pickParentDirectory ? <>
          <div className={css.locationField}>
            <label>存放位置<Input className={css.formInput ?? ''} value={parentPath} disabled={busy} onChange={event => setParentPath(event.target.value)} placeholder="选择父文件夹" /></label>
            <Button variant="outline" type="button" disabled={busy} onClick={() => { void directory.pickParentDirectory!().then(selected => { if (selected) setParentPath(selected) }).catch(cause => setError(String(cause))) }}><IconFolderOpenOutlineMedium size={16} />选择文件夹</Button>
          </div>
          <label>文件夹名称<Input className={css.formInput ?? ''} maxLength={160} value={folderName} disabled={busy} onChange={event => setFolderName(event.target.value)} placeholder={name || '默认使用工作台名称'} /></label>
          {targetPath ? <div className={folders.preview}><span className={folders.caption}>创建位置</span><p className={folders.path}>{targetPath}</p></div> : null}
        </> : null}
        <label>简介（可选）<textarea rows={2} maxLength={4000} value={description} disabled={busy} onChange={event => setDescription(event.target.value)} placeholder="写下这个工作台的用途" /></label>
        <label>工作台背景（可选）<textarea rows={4} maxLength={20_000} value={background} disabled={busy} onChange={event => { setBackground(event.target.value); setBackgroundNotice(undefined) }} placeholder="目标、长期约束、偏好和成功标准" /></label>
        <div className={css.assistActions}><Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => { void assist() }}>AI 辅助生成背景草稿</Button><span className={css.formHint}>根据名称和简介生成，可继续编辑</span></div>
        {backgroundNotice ? <p className={css.formHint} role="status">{backgroundNotice}</p> : null}
        {error ? <p className={css.error} role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={close}>取消</Button><Button type="submit" variant="primary" disabled={busy || !canCreate}>{busy ? '正在创建…' : '创建并打开'}</Button></footer>
    </form>
  </Modal>
}
