import { IconFolderOpenOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { useWorkbenchLocale } from './workbench-locale.ts'
import css from './WorkbenchFolders.module.css'

/** A compact project source control, independent of the active conversation. */
export function AreaProjectButton({ relativePath, onClick }: { relativePath: string | undefined; onClick(): void }) {
  const { t } = useWorkbenchLocale()
  const folderLabel = relativePath ? t('project.folder', { path: relativePath }) : undefined
  return <button type="button" className={css.trigger} data-area-project-trigger data-unbound={!relativePath} aria-haspopup="dialog"
    aria-label={folderLabel ?? t('project.setFolder')}
    title={folderLabel ?? t('project.setAreaFolder')} onClick={onClick}>
    <IconFolderOpenOutlineMedium size={14} /><span>{relativePath?.split('/').at(-1) || t('project.setFolder')}</span>
  </button>
}
