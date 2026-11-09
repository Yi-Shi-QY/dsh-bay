import { IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WorkbenchFolders.module.css'

/** A compact project source control, independent of the active conversation. */
export function AreaProjectButton({ relativePath, onClick }: { relativePath: string | undefined; onClick(): void }) {
  return <button type="button" className={css.trigger} data-area-project-trigger data-unbound={!relativePath} aria-haspopup="dialog"
    aria-label={relativePath ? `项目文件夹：${relativePath}` : '设置项目文件夹'}
    title={relativePath ? `项目文件夹：${relativePath}` : '为此区域设置项目文件夹'} onClick={onClick}>
    <IconFolderOpenOutlineMedium size={14} /><span>{relativePath?.split('/').at(-1) || '设置项目文件夹'}</span>
  </button>
}
