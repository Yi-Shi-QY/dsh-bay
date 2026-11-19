import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, WorkbenchMessageError, type WorkbenchNotice } from './workbench-locale.ts'
import { useRef, useState } from 'react'
import { IconFolderCloseMedium, IconPlusOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { browserSafeUuid } from '../browser-safe-id.ts'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { EditorMenuCommand, EditorMenuPreferences } from './editor-menu-preferences.ts'
import css from './WorkbenchEditorFolders.module.css'

interface Props {
  preferences?: EditorMenuPreferences | undefined
  directory?: WorkbenchDirectory | undefined
  writable: boolean
}

function useFolderAction(directory: Props['directory']) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<WorkbenchNotice>()
  const pending = useRef(false)
  return { busy, error, run: async (command: EditorMenuCommand) => {
    if (pending.current) return false
    pending.current = true; setBusy(true); setError(undefined)
    try {
      const result = await directory?.updateEditorMenu?.(command)
      if (result?.status !== 'committed') throw new WorkbenchMessageError(result?.status === 'conflict' ? 'folders.conflict' : 'folders.saveDisconnected')
      return true
    } catch (error) { setError(workbenchErrorNotice(error, 'folders.saveFailed')); return false }
    finally { pending.current = false; setBusy(false) }
  } }
}

export function WorkbenchEditorFolders({ preferences, directory, writable }: Props) {
  const { t } = useWorkbenchLocale()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string }>()
  const action = useFolderAction(directory)
  const disabled = !writable || !directory?.updateEditorMenu || action.busy
  const folders = preferences?.folders ?? []
  const create = async () => {
    if (await action.run({ type: 'create', id: 'folder-' + browserSafeUuid(), name })) setName('')
  }
  return <details className={css.manager}>
    <summary><IconFolderCloseMedium size={17} /><strong>{t('editor.menuFolders')}</strong><span>{folders.length} {t('editor.customFolders')}</span></summary>
    <div className={css.body}>
      <p>{t('editor.nativePagesAreGroupedUnderBuiltIn')}</p>
      <form className={css.create} onSubmit={event => { event.preventDefault(); if (!disabled && name.trim()) void create() }}>
        <input aria-label={t('editor.newFolderName')} placeholder={t('editor.eGDeveloperToolsOrContentCreation')} maxLength={32} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        <button type="submit" disabled={disabled || !name.trim()}><IconPlusOutlineMedium size={14} />{t('editor.newFolder')}</button>
      </form>
      {folders.length ? <div className={css.folders}>{folders.map(folder => <div className={css.folder} key={folder.id}>
        <IconFolderCloseMedium size={16} />
        {editing?.id === folder.id ? <><input aria-label={t('folders.name', { name: folder.name })} value={editing.name} maxLength={32} disabled={disabled} onChange={event => setEditing({ id: folder.id, name: event.target.value })} />
          <button disabled={disabled || !editing.name.trim()} onClick={async () => { if (await action.run({ type: 'rename', ...editing })) setEditing(undefined) }}>{t('editor.saveName')}</button>
          <button disabled={action.busy} onClick={() => setEditing(undefined)}>{t('action.cancel')}</button></>
          : <><span className={css.name} title={folder.name}>{folder.name}</span><small>{Object.values(preferences?.assignments ?? {}).filter(id => id === folder.id).length} {t('transfer.pages')}</small>
            <button disabled={disabled} aria-label={t('folders.rename', { name: folder.name })} onClick={() => setEditing({ ...folder })}>{t('shell.rename')}</button>
            <button disabled={disabled} aria-label={t('folders.delete', { name: folder.name })} onClick={() => void action.run({ type: 'remove', id: folder.id })}>{t('editor.delete')}</button></>}
      </div>)}</div> : null}
      <p>{t('editor.foldersApplyToAllWorkbenchesOnThis')}</p>
      {action.error ? <p className={css.error} role="alert">{workbenchNoticeText(t, action.error)}</p> : null}
    </div>
  </details>
}

export function WorkbenchEditorFolderSelect({ editorId, label, preferences, directory, writable }: Props & { editorId: string; label: string }) {
  const { t } = useWorkbenchLocale()
  const action = useFolderAction(directory)
  return <div className={css.assignment}>
    <label><span>{t('editor.menuFolder')}</span><select aria-label={t('folders.forPage', { name: label })} value={preferences?.assignments[editorId] ?? ''}
      disabled={!writable || !directory?.updateEditorMenu || action.busy}
      onChange={event => void action.run({ type: 'assign', editorId, folderId: event.target.value || undefined })}>
      <option value="">{t('editor.defaultFolder')}</option>{preferences?.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select></label>
    {action.error ? <p className={css.error} role="alert">{workbenchNoticeText(t, action.error)}</p> : null}
  </div>
}
