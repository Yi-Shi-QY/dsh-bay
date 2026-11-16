/** Names created by Bay remain portable between supported desktop platforms. */
export function workbenchFolderNameError(name: string): string | undefined {
  if (!name.trim()) return '请输入文件夹名称。'
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/u.test(name)) return '文件夹名称不能包含路径或 <> : " / \\ | ? * 等字符。'
  if (/[. ]$/u.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) return '此文件夹名称不可用，请换一个名称。'
  return undefined
}

export function suggestedWorkbenchFolder(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/[. ]+$/u, '').trim()
  return cleaned && !workbenchFolderNameError(cleaned) ? cleaned : '导入的工作台'
}

export function workbenchTargetPath(parent: string, folder: string): string {
  return parent ? parent.replace(/[\\/]$/u, '') + (parent.includes('\\') ? '\\' : '/') + folder : ''
}
