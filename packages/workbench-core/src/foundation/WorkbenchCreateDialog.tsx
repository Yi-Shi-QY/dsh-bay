import { browserSafeUuid } from '../browser-safe-id.ts'
import { useRef, useState } from 'react'
import { Button, Input, Modal, IconCloseOutlineMedium, IconFolderOpenOutlineMedium, IconPlusOutlineMedium, IconPanelLeftOutlineMedium, IconDatabaseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectoryCreateResult } from './frame-settings-adapter.ts'
import { WORKBENCH_LAYOUT_PRESETS, type WorkbenchLayoutPresetId } from './workbench-layout-presets.ts'
import { WorkbenchPresetIcon } from './WorkbenchPresetIcon.tsx'
import type { WorkbenchCreationDraftInputV1 } from './workbench-ai.ts'
import css from './WorkbenchHome.module.css'
import folders from './WorkbenchFolders.module.css'
import design from './WorkbenchCreateDialog.module.css'
import { workbenchFolderNameError, workbenchTargetPath } from '../workbench-folder-name.ts'

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
  directory: WorkbenchDirectory; presetId: WorkbenchLayoutPresetId; onClose(): void; onCreated(workbenchId: string): void | Promise<void>
  generateDraft?: (input: WorkbenchCreationDraftInputV1) => Promise<string>
}) {
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [requestId] = useState(() => browserSafeUuid())
  const [layout, setLayout] = useState(presetId)
  const [description, setDescription] = useState('')
  const [background, setBackground] = useState('')
  const [backgroundNotice, setBackgroundNotice] = useState<string>()
  const [phase, setPhase] = useState<'idle' | 'draft' | 'picking' | 'checking' | 'creating' | 'opening'>('idle')
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string>()
  const busy = phase !== 'idle'
  const locked = busy || submitted
  const needsLocation = directory.pickParentDirectory !== undefined
  const folderError = workbenchFolderNameError(folderName || name.trim())
  const canCreate = !!name.trim() && (!needsLocation || !!parentPath.trim() && !folderError)
  const targetPath = workbenchTargetPath(parentPath, folderName || name.trim())
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === layout)!
  const assist = async () => {
    if (pending.current || submitted) return
    if (generateDraft === undefined) { setError('当前环境未连接 DSH 原生 AI 服务。'); return }
    if (!name.trim()) { setError('请先输入工作台名称。'); return }
    pending.current = true; setPhase('draft'); setError(undefined); setBackgroundNotice('正在根据当前名称和简介生成背景草稿…')
    try {
      const draft = await generateDraft({ scope: 'create', name, description, currentValue: background })
      if (draft.trim() === '') throw new Error('AI 返回了空的背景草稿。')
      setBackground(draft)
      setBackgroundNotice('已根据名称和简介生成草稿，请编辑确认后创建。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBackgroundNotice(undefined) }
    finally { pending.current = false; setPhase('idle') }
  }
  const create = async () => {
    if (pending.current || !canCreate) return
    pending.current = true; setPhase(submitted ? 'creating' : 'checking'); setError(undefined)
    try {
      if (!submitted && directory.checkCreateLocation) await directory.checkCreateLocation(parentPath, folderName || name.trim())
      setSubmitted(true); setPhase('creating')
      const result = await directory.create({ name, description, parentPath, folderName: folderName || name.trim(), requestId, layoutPresetId: layout, ...(background.trim() === '' ? {} : { background }) })
      if (result.status !== 'committed') { setSubmitted(false); setError(errorMessage(result)); return }
      const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
      if (id) { setPhase('opening'); await onCreated(id) }
      onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '暂时无法创建工作台，请恢复连接后重试。') } finally { pending.current = false; setPhase('idle') }
  }
  const close = () => { if (!busy) onClose() }
  const pickLocation = async () => {
    if (pending.current || submitted || !directory.pickParentDirectory) return
    pending.current = true; setPhase('picking'); setError(undefined)
    try { const selected = await directory.pickParentDirectory(); if (selected) setParentPath(selected) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { pending.current = false; setPhase('idle') }
  }
  return <Modal open onClose={close} title="创建工作台" headless className={`${css.wizardModal} ${design.modal}`}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void create() }}>
      <header className={css.wizardHeader}><span className={design.headerIcon}><IconPlusOutlineMedium size={22} /></span><div className={design.heading}><h2>创建工作台</h2><p className={css.formHint}>为项目、对话和工作进展安放一个空间。</p></div><Button type="button" aria-label="关闭创建窗口" disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <label>名称<Input className={css.formInput ?? ''} data-modal-autofocus maxLength={160} value={name} disabled={locked} onChange={event => setName(event.target.value)} placeholder="例如：产品研发、学习笔记" /></label>
        {directory.pickParentDirectory ? <>
          <div className={css.locationField}>
            <label>存放位置<Input className={css.formInput ?? ''} value={parentPath} disabled={locked} onChange={event => setParentPath(event.target.value)} placeholder="选择父文件夹" /></label>
            <Button variant="outline" type="button" disabled={locked} onClick={() => { void pickLocation() }}><IconFolderOpenOutlineMedium size={16} />选择文件夹</Button>
          </div>
          <details className={design.folderDetails}><summary>自定义文件夹名称</summary><label>文件夹名称<Input className={css.formInput ?? ''} maxLength={160} value={folderName} disabled={locked} onChange={event => setFolderName(event.target.value)} placeholder={name || '默认使用工作台名称'} /></label></details>
          {targetPath ? <div className={`${folders.preview} ${design.path}`}><IconFolderOpenOutlineMedium size={18} /><div><span className={folders.caption}>将在这里创建</span><p className={folders.path}>{targetPath}</p></div></div> : null}
          {(folderName || name) && folderError ? <p className={css.error} role="alert">{folderError}</p> : null}
        </> : null}
        <details className={design.section}><summary><IconPanelLeftOutlineMedium size={18} /><span>区域布局<small>{preset.name} · {preset.areas} 个区域</small></span></summary><div className={design.presets} role="group" aria-label="选择区域布局">{WORKBENCH_LAYOUT_PRESETS.map(row => <button key={row.id} type="button" aria-pressed={layout === row.id} disabled={locked} onClick={() => setLayout(row.id)}><WorkbenchPresetIcon node={row.root} /><span>{row.name}</span></button>)}</div><p className={css.formHint}>创建后可以调整布局，并为各区域关联项目文件夹。</p></details>
        <details className={design.section}><summary><IconDatabaseOutlineMedium size={18} /><span>工作背景<small>可选，之后也可以补充</small></span></summary><div className={design.background}>
          <label>简介（可选）<textarea rows={2} maxLength={4000} value={description} disabled={locked} onChange={event => setDescription(event.target.value)} placeholder="写下这个工作台的用途" /></label>
          <label>工作台背景（可选）<textarea rows={4} maxLength={20_000} value={background} disabled={locked} onChange={event => { setBackground(event.target.value); setBackgroundNotice(undefined) }} placeholder="目标、长期约束、偏好和成功标准" /></label>
          <div className={css.assistActions}><Button variant="outline" size="sm" type="button" disabled={locked || !generateDraft || !name.trim()} onClick={() => { void assist() }}>AI 辅助生成背景草稿</Button><span className={css.formHint}>{generateDraft ? '草稿由你确认后保存' : '当前环境未连接 DSH 原生 AI 服务，可直接手动填写'}</span></div>
          {backgroundNotice ? <p className={css.formHint} role="status">{backgroundNotice}</p> : null}
        </div></details>
        {error ? <p className={css.error} role="alert">{error}</p> : null}
        {error && submitted ? <p className={css.formHint}>继续创建会恢复同一次操作，不会重复建立工作台。</p> : null}
        {['checking', 'creating', 'opening'].includes(phase) ? <div className={design.progress} role="status"><progress aria-label="创建工作台进度" /><span>{phase === 'checking' ? '正在检查目标目录…' : phase === 'creating' ? '正在创建工作台并准备主会话…' : '正在打开工作台…'}</span></div> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={close}>取消</Button><Button type="submit" variant="primary" disabled={busy || !canCreate}>{phase === 'draft' ? '正在生成草稿…' : phase === 'checking' ? '正在检查…' : phase === 'picking' ? '正在选择位置…' : phase === 'creating' ? '正在创建…' : phase === 'opening' ? '正在打开…' : submitted ? '继续创建' : '创建并打开'}</Button></footer>
    </form>
  </Modal>
}
