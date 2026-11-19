import type { WorkbenchMessageKey } from './workbench-messages.ts'
import { useWorkbenchLocale } from './workbench-locale.ts'
import { useState } from 'react'
import { Button, Modal, IconCloseOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectoryOperationResult } from './frame-settings-adapter.ts'
import type { WorkbenchAiDraftInputV1 } from './workbench-ai.ts'
import css from './WorkbenchHome.module.css'

function resultMessage(result: WorkbenchDirectoryOperationResult): WorkbenchMessageKey | undefined {
  if (result.status === 'committed') return undefined
  if (result.status === 'conflict') return 'context.save.conflict'
  if (result.status === 'rejected') return 'context.save.rejected'
  return 'context.save.unavailable'
}

/** Small shared editor for the human-owned background projection. */
export function WorkbenchContextDialog({
  directory, workbenchId, areaId, title, initialValue, onClose, onSaved, generateDraft,
}: {
  directory: WorkbenchDirectory
  workbenchId: string
  areaId?: string
  title: string
  initialValue: string
  onClose(): void
  onSaved?(): void
  generateDraft?: (input: Exclude<WorkbenchAiDraftInputV1, { scope: 'create' }>) => Promise<string>
}) {
  const { t } = useWorkbenchLocale()
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saveError, setSaveError] = useState<WorkbenchMessageKey>()
  const [notice, setNotice] = useState<string>()
  const save = async () => {
    if (busy) return
    setBusy(true); setError(undefined); setSaveError(undefined)
    const result = areaId === undefined
      ? await directory.updateWorkbenchBackground?.(workbenchId, value) ?? { status: 'unavailable' as const }
      : await directory.updateAreaBackground?.(workbenchId, areaId, value) ?? { status: 'unavailable' as const }
    const message = resultMessage(result)
    if (message !== undefined) setSaveError(message)
    else { onSaved?.(); onClose() }
    setBusy(false)
  }
  const assist = async () => {
    if (generateDraft === undefined) { setError(t('context.aiUnavailable')); return }
    setBusy(true); setError(undefined); setSaveError(undefined); setNotice(areaId === undefined ? t('context.draftingWorkbench') : t('context.draftingProject'))
    try {
      const draft = await generateDraft(areaId === undefined
        ? { workbenchId, scope: 'workbench', currentValue: value }
        : { workbenchId, scope: 'area', areaId, currentValue: value })
      if (draft.trim() === '') throw new Error(t('context.emptyDraft'))
      setValue(draft); setNotice(t('context.reviewDraft'))
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setNotice(undefined) }
    finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title={title} headless className={css.wizardModal ?? ''}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void save() }}>
      <header className={css.wizardHeader}><h2>{title}</h2><Button type="button" aria-label={t('action.close')} disabled={busy} onClick={onClose}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <label>{t('editor.context')}<textarea rows={9} maxLength={20_000} value={value} disabled={busy} onChange={event => { setValue(event.target.value); setNotice(undefined) }} placeholder={t('editor.optionalAddGoalsConstraintsPreferencesAndSuccess')} /></label>
        <Button type="button" disabled={busy} onClick={() => { void assist() }}>{t('editor.draftWithAi')}</Button>
        {notice ? <p role="status">{notice}</p> : null}
        {(error || saveError) ? <p className={css.error} role="alert">{saveError ? t(saveError) : error}</p> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={onClose}>{t('action.cancel')}</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? t('project.saving') : t('context.save')}</Button></footer>
    </form>
  </Modal>
}
