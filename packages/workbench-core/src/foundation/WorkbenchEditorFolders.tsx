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
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef(false)
  return { busy, error, run: async (command: EditorMenuCommand) => {
    if (pending.current) return false
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await directory?.updateEditorMenu?.(command)
      if (result?.status !== 'committed') throw new Error(result?.status === 'conflict' ? '分类已在其他窗口更新，请检查后重试。' : '保存失败，请检查连接后重试。')
      return true
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); return false }
    finally { pending.current = false; setBusy(false) }
  } }
}

export function WorkbenchEditorFolders({ preferences, directory, writable }: Props) {
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string }>()
  const action = useFolderAction(directory)
  const disabled = !writable || !directory?.updateEditorMenu || action.busy
  const folders = preferences?.folders ?? []
  const create = async () => {
    if (await action.run({ type: 'create', id: 'folder-' + browserSafeUuid(), name })) setName('')
  }
  return <details className={css.manager}>
    <summary><IconFolderCloseMedium size={17} /><strong>菜单分类文件夹</strong><span>{folders.length} 个自定义分类</span></summary>
    <div className={css.body}>
      <p>官方内页统一收在“官方内置”。在下方扩展卡片中选择分类，区域与浮动工作区的菜单同步生效。</p>
      <form className={css.create} onSubmit={event => { event.preventDefault(); if (!disabled && name.trim()) void create() }}>
        <input aria-label="新分类名称" placeholder="例如：开发工具、内容创作" maxLength={32} value={name} disabled={disabled} onChange={event => setName(event.target.value)} />
        <button type="submit" disabled={disabled || !name.trim()}><IconPlusOutlineMedium size={14} />新建分类</button>
      </form>
      {folders.length ? <div className={css.folders}>{folders.map(folder => <div className={css.folder} key={folder.id}>
        <IconFolderCloseMedium size={16} />
        {editing?.id === folder.id ? <><input aria-label={'分类名称：' + folder.name} value={editing.name} maxLength={32} disabled={disabled} onChange={event => setEditing({ id: folder.id, name: event.target.value })} />
          <button disabled={disabled || !editing.name.trim()} onClick={async () => { if (await action.run({ type: 'rename', ...editing })) setEditing(undefined) }}>保存名称</button>
          <button disabled={action.busy} onClick={() => setEditing(undefined)}>取消</button></>
          : <><span className={css.name} title={folder.name}>{folder.name}</span><small>{Object.values(preferences?.assignments ?? {}).filter(id => id === folder.id).length} 个内页</small>
            <button disabled={disabled} aria-label={'重命名分类 ' + folder.name} onClick={() => setEditing({ ...folder })}>重命名</button>
            <button disabled={disabled} aria-label={'删除分类 ' + folder.name} onClick={() => void action.run({ type: 'remove', id: folder.id })}>删除</button></>}
      </div>)}</div> : null}
      <p>分类设置适用于本机所有工作台。删除分类会让内页回到默认分类，不卸载扩展。</p>
      {action.error ? <p className={css.error} role="alert">{action.error}</p> : null}
    </div>
  </details>
}

export function WorkbenchEditorFolderSelect({ editorId, label, preferences, directory, writable }: Props & { editorId: string; label: string }) {
  const action = useFolderAction(directory)
  return <div className={css.assignment}>
    <label><span>菜单分类</span><select aria-label={label + ' 的菜单分类'} value={preferences?.assignments[editorId] ?? ''}
      disabled={!writable || !directory?.updateEditorMenu || action.busy}
      onChange={event => void action.run({ type: 'assign', editorId, folderId: event.target.value || undefined })}>
      <option value="">默认分类</option>{preferences?.folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
    </select></label>
    {action.error ? <p className={css.error} role="alert">{action.error}</p> : null}
  </div>
}
