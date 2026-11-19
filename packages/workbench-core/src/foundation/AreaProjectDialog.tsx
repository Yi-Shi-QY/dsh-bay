import { useEffect, useId, useRef, useState } from 'react'
import { Button, Input, Modal, IconCloseOutlineMedium, IconFolderOpenOutlineMedium, IconChevronRightOutlineMedium, IconChevronLeftOutlineMedium, IconCheckOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import { useWorkbenchLocale } from './workbench-locale.ts'
import css from './WorkbenchHome.module.css'
import folders from './WorkbenchFolders.module.css'

/** Keep the UI name-only; the Host still validates real paths and directory ownership. */
function folderNameError(name: string) {
  if (!name) return undefined
  if (name.toLowerCase() === '.dshbay') return 'project.nameReserved'
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/u.test(name) || /[.]$/u.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) return 'project.nameInvalid'
  return undefined
}

export function AreaProjectDialog({ directory, workbenchId, areaId, onClose }: { directory: WorkbenchDirectory; workbenchId: string; areaId: string; onClose(): void }) {
  const { t, language } = useWorkbenchLocale()
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
        if (!directory.listProjectDirectories) {
          if (live) setLoadError('')
          return
        }
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
  const showDetails = language === undefined || language === 'zh'
  return <Modal open onClose={close} title={t('project.dialogTitle')} headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void save() }}>
      <header className={css.wizardHeader}>
        <div><h2>{t('project.dialogTitle')}</h2><p className={css.formHint}>{t('project.dialogHint')}</p></div>
        <Button type="button" aria-label={t('action.close')} disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button>
      </header>
      <div className={css.wizardBody}>
        <div className={folders.location}>
          <IconFolderOpenOutlineMedium size={18} />
          <div><span className={folders.caption}>{t('project.root')}</span><p className={folders.path} title={rootPath}>{rootPath || t('project.rootUnavailable')}</p></div>
        </div>
        <div className={folders.modeSwitch} role="group" aria-label={t('project.folderMode')}>
          <button type="button" aria-pressed={mode === 'create'} disabled={busy} onClick={() => { setMode('create'); setError(undefined) }}>{t('project.createFolder')}</button>
          <button type="button" aria-pressed={mode === 'existing'} disabled={busy} onClick={() => { setMode('existing'); setError(undefined) }}>{t('project.chooseExisting')}</button>
        </div>
        {mode === 'create' ? <div className={folders.fields}>
          <label htmlFor={fieldId}>{t('project.folderName')}</label>
          <Input id={fieldId} className={css.formInput ?? ''} data-modal-autofocus maxLength={160} value={name} disabled={busy} placeholder={t('project.folderExample')} aria-invalid={!!invalidName} aria-describedby={`${fieldId}-hint`}
            onChange={event => { setName(event.target.value); setError(undefined) }} />
          <p id={`${fieldId}-hint`} className={invalidName ? css.error : css.formHint}>{t(invalidName ?? 'project.nameHint')}</p>
        </div> : <div className={folders.browser} aria-label={t('project.browse')} aria-busy={loading}>
          <div className={folders.browserToolbar}>
            <Button type="button" size="sm" aria-label={t('project.parent')} disabled={busy || !browsePath} onClick={() => setBrowsePath(browsePath.split('/').slice(0, -1).join('/'))}><IconChevronLeftOutlineMedium size={16} /></Button>
            <span title={browsePath || t('project.rootDirectory')}>{browsePath || t('project.rootDirectory')}</span>
          </div>
          <div className={folders.folderList}>
            {loading ? <p className={folders.empty} role="status">{t('project.readingFolders')}</p> : loadError !== undefined ? <div className={folders.empty}><p role="alert" className={css.error} title={loadError || undefined}>{showDetails && loadError ? loadError : t('project.readFoldersFailed')}</p><Button type="button" variant="outline" disabled={busy} onClick={() => setReload(value => value + 1)}>{t('action.retry')}</Button></div>
              : rows.length === 0 ? <p className={folders.empty}>{t('project.noSubfolders')}</p>
                : rows.map(row => <div className={folders.folderRow} data-selected={relativePath === row.relativePath} key={row.relativePath}>
                  <button type="button" className={folders.folderSelect} disabled={busy} aria-label={t('project.selectFolder', { name: row.name })} aria-pressed={relativePath === row.relativePath} onClick={() => { setRelativePath(row.relativePath); setError(undefined) }}>
                    <IconFolderOpenOutlineMedium size={17} /><span title={row.name}>{row.name}</span>{relativePath === row.relativePath ? <IconCheckOutlineMedium size={16} /> : null}
                  </button>
                  <Button type="button" size="sm" disabled={busy} aria-label={t('project.openFolder', { name: row.name })} title={t('project.browseSubfolders')} onClick={() => setBrowsePath(row.relativePath)}><IconChevronRightOutlineMedium size={16} /></Button>
                </div>)}
          </div>
        </div>}
        <div className={folders.preview} aria-live="polite">
          <span className={folders.caption}>{t(mode === 'create' ? 'project.createLocation' : 'project.selectedFolder')}</span>
          <p className={folders.path}>{previewPath || t(mode === 'create' ? 'project.enterName' : 'project.chooseSubfolder')}</p>
        </div>
        <p className={css.formHint}>{t('project.sharingHint')}</p>
        {error ? <p className={css.error} role="alert" title={error}>{showDetails ? error : t('project.saveFailed')}</p> : null}
      </div>
      <footer className={css.wizardActions}>
        <Button type="button" disabled={busy} onClick={close}>{t('action.cancel')}</Button>
        <Button type="submit" disabled={busy || !canSave} variant="primary">{t(busy ? (mode === 'create' ? 'project.creating' : 'project.saving') : mode === 'create' ? 'project.createAndUse' : 'project.useFolder')}</Button>
      </footer>
    </form>
  </Modal>
}
