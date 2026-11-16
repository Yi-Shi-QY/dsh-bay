import { editorPresentationFor, resolveWorkbenchEditorPresentation, type WorkbenchEditorCatalogRow } from './catalog.ts'

/** Profile-wide menu organization. Folder identities survive renaming and plugin updates. */
export interface EditorMenuPreferences {
  folders: { id: string; name: string }[]
  assignments: Record<string, string>
}
export type EditorMenuCommand =
  | { type: 'create'; id: string; name: string }
  | { type: 'rename'; id: string; name: string }
  | { type: 'remove'; id: string }
  | { type: 'assign'; editorId: string; folderId: string | undefined }

export const isBuiltinEditor = (id: string) => editorPresentationFor(id, 'root').category === '官方内置'
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id)
const validName = (name: unknown): name is string => typeof name === 'string' && !!name.trim() && name.trim().length <= 32 && !['官方内置', '扩展'].includes(name.trim()) && !/[\u0000-\u001f]/u.test(name)

export function decodeEditorMenuPreferences(value: unknown): EditorMenuPreferences | undefined {
  if (value === undefined) return { folders: [], assignments: {} }
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<EditorMenuPreferences>
  if (!Array.isArray(raw.folders) || raw.folders.length > 100 || !raw.assignments || typeof raw.assignments !== 'object' || Array.isArray(raw.assignments)) return undefined
  const folders: EditorMenuPreferences['folders'] = [], ids = new Set<string>(), names = new Set<string>()
  for (const folder of raw.folders) {
    if (!folder || !validId(folder.id) || !validName(folder.name) || ids.has(folder.id) || names.has(folder.name.trim().toLocaleLowerCase())) return undefined
    folders.push({ id: folder.id, name: folder.name.trim() }); ids.add(folder.id); names.add(folder.name.trim().toLocaleLowerCase())
  }
  const entries = Object.entries(raw.assignments)
  if (entries.length > 4096 || entries.some(([id, folderId]) => !validId(id) || isBuiltinEditor(id) || !ids.has(folderId))) return undefined
  return { folders, assignments: Object.fromEntries(entries) }
}

export function changeEditorMenuPreferences(value: EditorMenuPreferences | undefined, command: EditorMenuCommand): EditorMenuPreferences {
  const current = decodeEditorMenuPreferences(value)
  if (!current) throw new Error('内页分类设置无效，请重新读取设置。')
  if (command.type === 'assign') {
    if (!validId(command.editorId) || isBuiltinEditor(command.editorId)) throw new Error('只能为扩展内页设置分类。')
    if (command.folderId !== undefined && !current.folders.some(folder => folder.id === command.folderId)) throw new Error('分类已不存在，请重新选择。')
    if (command.folderId === undefined) delete current.assignments[command.editorId]
    else current.assignments[command.editorId] = command.folderId
    if (Object.keys(current.assignments).length > 4096) throw new Error('内页分类数量已达上限。')
    return current
  }
  const existing = current.folders.find(folder => folder.id === command.id)
  if (command.type === 'remove') {
    if (!existing) return current
    return { folders: current.folders.filter(folder => folder.id !== command.id), assignments: Object.fromEntries(Object.entries(current.assignments).filter(([, id]) => id !== command.id)) }
  }
  if (!validName(command.name)) throw new Error('请输入 1–32 个字符的分类名称，不能使用“官方内置”或“扩展”。')
  const name = command.name.trim()
  if (current.folders.some(folder => folder.id !== command.id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('已有同名分类，请换一个名称。')
  if (command.type === 'rename') {
    if (!existing) throw new Error('分类已不存在，请重新读取。')
    existing.name = name
  } else {
    if (!validId(command.id) || existing || current.folders.length >= 100) throw new Error('无法创建分类，请重新读取设置后重试。')
    current.folders.push({ id: command.id, name })
  }
  return current
}

export function editorMenuFolder(editor: WorkbenchEditorCatalogRow, preferences?: EditorMenuPreferences): { id: string; name: string; order: number } {
  if (isBuiltinEditor(editor.id)) return { id: 'builtin', name: '官方内置', order: 0 }
  const index = preferences?.folders.findIndex(folder => folder.id === preferences.assignments[editor.id]) ?? -1
  const folder = preferences?.folders[index]
  if (folder) return { id: 'custom:' + folder.id, name: folder.name, order: 10 + index }
  const declared = resolveWorkbenchEditorPresentation(editor)
  const name = declared.category === '官方内置' ? '扩展' : declared.category
  return { id: 'default:' + name, name, order: 1000 }
}
