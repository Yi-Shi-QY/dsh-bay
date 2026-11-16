import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal, IconCloseOutlineMedium, IconFolderOpenOutlineMedium, IconChevronRightOutlineMedium, IconChevronLeftOutlineMedium, IconCheckOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import css from './WorkbenchHome.module.css'
import folders from './WorkbenchFolders.module.css'

/** Keep the UI name-only; the Host still validates real paths and directory ownership. */
function folderNameError(name: string): string | undefined {
  if (!name) return undefined
  if (name.toLowerCase() === '.bay') return '此名称由工作台保留，请换一个名称。'
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[.]$/u.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) return '请输入有效的文件夹名称，不需要填写路径。'
  return undefined
}

export function AreaProjectDialog({ directory, workbenchId, areaId, onClose }: { directory: WorkbenchDirectory; workbenchId: string; areaId: string; onClose(): void }) {
  const project = directory.getAreaProjects?.(workbenchId)[areaId]
  const rootPath = directory.getRootPath?.(workbenchId) ?? ''
  const [mode, setMode] = useState<'create' | 'existing'>(project ? 'existing' : 'create')
  const [name, setName] = useState('')
  const [relativePath, setRelativePath] = useState(project?.relativePath ?? '')
  const [browsePath, setBrowsePath] = useState(project?.relativePath.split('/').slice(0, -1).join('/') ?? '')
  const [rows, setRows] = useState<{ name: string; relativePath: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submitting = useRef(false)
  const fieldId = useId()
  const trimmedName = name.trim()
  const invalidName = folderNameError(trimmedName)
  const target = mode === 'create' ? trimmedName : relativePath
  const canSave = !!target && (mode !== 'create' || !invalidName) && !!directory.bindAreaProject
  const separator = rootPath.includes('\\') ? '\\' : '/'
  const previewPath = target ? `${rootPath.replace(/[\\/]$/u, '')}${separator}${target.replaceAll('/', separator)}` : ''

  useEffect(() => {
    if (mode !== 'existing') return
    let live = true
    setLoading(true); setLoadError(undefined); setRows([])
    const read = async () => {
      try {
        if (!directory.listProjectDirectories) throw new Error('当前无法读取工作台文件夹。')
        const value = await directory.listProjectDirectories(workbenchId, browsePath)
        if (live) setRows(value)
      } catch (reason) { if (live) setLoadError(reason instanceof Error ? reason.message : String(reason)) }
      finally { if (live) setLoading(false) }
    }
    void read()
    return () => { live = false }
  }, [directory, workbenchId, browsePath, mode, reload])

  const save = async () => {
    if (submitting.current || !canSave || !directory.bindAreaProject) return
    submitting.current = true; setBusy(true); setError(undefined)
    try {
      await directory.bindAreaProject({ workbenchId, areaId, relativePath: target, createDirectory: mode === 'create' })
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { submitting.current = false; setBusy(false) }
  }
  const close = () => { if (!submitting.current) onClose() }
  return <Modal open onClose={close} title="区域项目文件夹" headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void save() }}>
      <header className={css.wizardHeader}>
        <div><h2>区域项目文件夹</h2><p className={css.formHint}>新会话将在此文件夹中工作；已有会话仍保留创建时的项目文件夹。</p></div>
        <Button type="button" aria-label="关闭" disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <div className={folders.location}>
          <IconFolderOpenOutlineMedium size={18} />
          <div><span className={folders.caption}>工作台目录</span><p className={folders.path} title={rootPath}>{rootPath || '工作台目录暂不可用'}</p></div>
        </div>
        <div className={folders.modeSwitch} role="group" aria-label="项目文件夹设置方式">
          <button type="button" aria-pressed={mode === 'create'} disabled={busy} onClick={() => { setMode('create'); setError(undefined) }}>新建文件夹</button>
          <button type="button" aria-pressed={mode === 'existing'} disabled={busy} onClick={() => { setMode('existing'); setError(undefined) }}>选择已有文件夹</button>
        </div>
        {mode === 'create' ? <div className={folders.fields}>
          <label htmlFor={fieldId}>文件夹名称</label>
          <Input id={fieldId} className={css.formInput ?? ''} data-modal-autofocus maxLength={160} value={name} disabled={busy} placeholder="例如：社媒运营" aria-invalid={!!invalidName} aria-describedby={`${fieldId}-hint`}
            onChange={event => { setName(event.target.value); setError(undefined) }} />
          <p id={`${fieldId}-hint`} className={invalidName ? css.error : css.formHint}>{invalidName ?? '将在工作台目录下新建，无需填写完整路径。'}</p>
        </div> : <div className={folders.browser} aria-label="工作台内文件夹" aria-busy={loading}>
          <div className={folders.browserToolbar}>
            <Button type="button" size="sm" aria-label="上一级文件夹" disabled={busy || !browsePath} onClick={() => setBrowsePath(browsePath.split('/').slice(0, -1).join('/'))}><IconChevronLeftOutlineMedium size={16} /></Button>
            <span title={browsePath || '工作台根目录'}>{browsePath || '工作台根目录'}</span>
          </div>
          <div className={folders.folderList}>
            {loading ? <p className={folders.empty} role="status">正在读取文件夹…</p> : loadError ? <div className={folders.empty}><p role="alert" className={css.error}>{loadError}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>重试</Button></div>
              : rows.length === 0 ? <p className={folders.empty}>这里还没有子文件夹，可切换到“新建文件夹”。</p>
                : rows.map(row => <div className={folders.folderRow} data-selected={relativePath === row.relativePath} key={row.relativePath}>
                  <button type="button" className={folders.folderSelect} disabled={busy} aria-label={`选择 ${row.name}`} aria-pressed={relativePath === row.relativePath} onClick={() => { setRelativePath(row.relativePath); setError(undefined) }}>
                    <IconFolderOpenOutlineMedium size={17} /><span title={row.name}>{row.name}</span>{relativePath === row.relativePath ? <IconCheckOutlineMedium size={16} /> : null}
                  </button>
                  <Button type="button" size="sm" disabled={busy} aria-label={`打开 ${row.name}`} title="浏览子文件夹" onClick={() => setBrowsePath(row.relativePath)}><IconChevronRightOutlineMedium size={16} /></Button>
                </div>)}
          </div>
        </div>}
        <div className={folders.preview} aria-live="polite">
          <span className={folders.caption}>{mode === 'create' ? '创建位置' : '已选文件夹'}</span>
          <p className={folders.path}>{previewPath || (mode === 'create' ? '输入名称后显示完整位置' : '请选择一个工作台内的子文件夹')}</p>
        </div>
        <p className={css.formHint}>多个区域可以共用同一文件夹，各自保留背景和会话。</p>
        {error ? <p className={css.error} role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}>
        <Button type="button" disabled={busy} onClick={close}>取消</Button>
        <Button type="submit" disabled={busy || !canSave} variant="primary">{busy ? (mode === 'create' ? '正在创建…' : '正在保存…') : mode === 'create' ? '创建并使用' : '使用此文件夹'}</Button>
      </footer>
    </form>
  </Modal>
}
