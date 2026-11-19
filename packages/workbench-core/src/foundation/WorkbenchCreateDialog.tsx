import { useWorkbenchLocale, workbenchErrorNotice, workbenchNoticeText, WorkbenchMessageError, type WorkbenchNotice } from './workbench-locale.ts'
import type { WorkbenchMessageKey } from './workbench-messages.ts'
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

function errorMessage(result: WorkbenchDirectoryCreateResult): WorkbenchMessageKey {
  if (result.status === 'rejected') {
    if (result.reason === 'duplicate-name') return 'home.createError.duplicate'
    if (result.reason === 'invalid-name') return 'home.createError.invalidName'
    if (result.reason === 'invalid-preset') return 'home.createError.invalidLayout'
  }
  if (result.status === 'conflict') return 'home.createError.conflict'
  return 'home.createError.unavailable'
}

/** Creation names a layout and lets the user review an optional AI draft before saving it. */
export function WorkbenchCreateDialog({ directory, presetId, onClose, onCreated, generateDraft }: {
  directory: WorkbenchDirectory; presetId: WorkbenchLayoutPresetId; onClose(): void; onCreated(workbenchId: string): void | Promise<void>
  generateDraft?: (input: WorkbenchCreationDraftInputV1) => Promise<string>
}) {
  const { t } = useWorkbenchLocale()
  const [name, setName] = useState('')
  const [parentPath, setParentPath] = useState('')
  const [folderName, setFolderName] = useState('')
  const [requestId] = useState(() => browserSafeUuid())
  const [layout, setLayout] = useState(presetId)
  const [description, setDescription] = useState('')
  const [background, setBackground] = useState('')
  const [backgroundNotice, setBackgroundNotice] = useState<WorkbenchMessageKey>()
  const [phase, setPhase] = useState<'idle' | 'draft' | 'picking' | 'checking' | 'creating' | 'opening'>('idle')
  const [submitted, setSubmitted] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<WorkbenchNotice>()
  const [errorKey, setErrorKey] = useState<WorkbenchMessageKey>()
  const visibleError = errorKey ? t(errorKey) : workbenchNoticeText(t, error)
  const busy = phase !== 'idle'
  const locked = busy || submitted
  const needsLocation = directory.pickParentDirectory !== undefined
  const folderError = workbenchFolderNameError(folderName || name.trim(), t)
  const canCreate = !!name.trim() && (!needsLocation || !!parentPath.trim() && !folderError)
  const targetPath = workbenchTargetPath(parentPath, folderName || name.trim())
  const preset = WORKBENCH_LAYOUT_PRESETS.find(row => row.id === layout)!
  const assist = async () => {
    if (pending.current || submitted) return
    if (generateDraft === undefined) { setErrorKey('home.theDshAiServiceIsNotConnected'); return }
    if (!name.trim()) { setErrorKey('home.enterAWorkbenchNameFirst'); return }
    pending.current = true; setPhase('draft'); setError(undefined); setErrorKey(undefined); setBackgroundNotice('home.draftingContextFromTheWorkbenchNameAnd')
    try {
      const draft = await generateDraft({ scope: 'create', name, description, currentValue: background })
      if (draft.trim() === '') throw new WorkbenchMessageError('home.aiReturnedAnEmptyContextDraft')
      setBackground(draft)
      setBackgroundNotice('home.reviewAndEditTheDraftBeforeCreating')
    } catch (cause) { setError(workbenchErrorNotice(cause, 'settings.saveFailed')); setBackgroundNotice(undefined) }
    finally { pending.current = false; setPhase('idle') }
  }
  const create = async () => {
    if (pending.current || !canCreate) return
    pending.current = true; setPhase(submitted ? 'creating' : 'checking'); setError(undefined); setErrorKey(undefined)
    try {
      if (!submitted && directory.checkCreateLocation) await directory.checkCreateLocation(parentPath, folderName || name.trim())
      setSubmitted(true); setPhase('creating')
      const result = await directory.create({ name, description, parentPath, folderName: folderName || name.trim(), requestId, layoutPresetId: layout, ...(background.trim() === '' ? {} : { background }) })
      if (result.status !== 'committed') { setSubmitted(false); setErrorKey(errorMessage(result)); return }
      const id = 'workbenchId' in result ? result.workbenchId : directory.getSnapshot().activeWorkbenchId
      if (id) { setPhase('opening'); await onCreated(id) }
      onClose()
    } catch (cause) { setError(workbenchErrorNotice(cause, 'home.couldNotCreateTheWorkbenchReconnectAnd')) } finally { pending.current = false; setPhase('idle') }
  }
  const close = () => { if (!busy) onClose() }
  const pickLocation = async () => {
    if (pending.current || submitted || !directory.pickParentDirectory) return
    pending.current = true; setPhase('picking'); setError(undefined); setErrorKey(undefined)
    try { const selected = await directory.pickParentDirectory(); if (selected) setParentPath(selected) }
    catch (cause) { setError(workbenchErrorNotice(cause, 'settings.saveFailed')) }
    finally { pending.current = false; setPhase('idle') }
  }
  return <Modal open onClose={close} title={t('home.createWorkbench')} headless className={`${css.wizardModal} ${design.modal}`}>
    <form className={css.wizard} onSubmit={event => { event.preventDefault(); void create() }}>
      <header className={css.wizardHeader}><span className={design.headerIcon}><IconPlusOutlineMedium size={22} /></span><div className={design.heading}><h2>{t('home.createWorkbench')}</h2><p className={css.formHint}>{t('home.createAPlaceForYourProjectsConversations')}</p></div><Button type="button" aria-label={t('home.closeTheCreationDialog')} disabled={busy} onClick={close}><IconCloseOutlineMedium size={18} /></Button></header>
      <div className={css.wizardBody}>
        <label>{t('home.name')}<Input className={css.formInput ?? ''} data-modal-autofocus maxLength={160} value={name} disabled={locked} onChange={event => setName(event.target.value)} placeholder={t('home.eGProductDevelopmentOrStudyNotes')} /></label>
        {directory.pickParentDirectory ? <>
          <div className={css.locationField}>
            <label>{t('home.location')}<Input className={css.formInput ?? ''} value={parentPath} disabled={locked} onChange={event => setParentPath(event.target.value)} placeholder={t('home.chooseParentFolder')} /></label>
            <Button variant="outline" type="button" disabled={locked} onClick={() => { void pickLocation() }}><IconFolderOpenOutlineMedium size={16} />{t('home.chooseFolder')}</Button>
          </div>
          <details className={design.folderDetails}><summary>{t('home.customizeFolderName')}</summary><label>{t('project.folderName')}<Input className={css.formInput ?? ''} maxLength={160} value={folderName} disabled={locked} onChange={event => setFolderName(event.target.value)} placeholder={name || t('home.defaultsToTheWorkbenchName')} /></label></details>
          {targetPath ? <div className={`${folders.preview} ${design.path}`}><IconFolderOpenOutlineMedium size={18} /><div><span className={folders.caption}>{t('home.willBeCreatedHere')}</span><p className={folders.path}>{targetPath}</p></div></div> : null}
          {(folderName || name) && folderError ? <p className={css.error} role="alert">{folderError}</p> : null}
        </> : null}
        <details className={design.section}><summary><IconPanelLeftOutlineMedium size={18} /><span>{t('home.areaLayout2')}<small>{t(`layout.preset.${preset.id}`)} · {t('layout.areaCount', { count: preset.areas })}</small></span></summary><div className={design.presets} role="group" aria-label={t('home.chooseAreaLayout')}>{WORKBENCH_LAYOUT_PRESETS.map(row => <button key={row.id} type="button" aria-pressed={layout === row.id} disabled={locked} onClick={() => setLayout(row.id)}><WorkbenchPresetIcon node={row.root} /><span>{t(`layout.preset.${row.id}`)}</span></button>)}</div><p className={css.formHint}>{t('home.youCanChangeTheLayoutAndAssign')}</p></details>
        <details className={design.section}><summary><IconDatabaseOutlineMedium size={18} /><span>{t('home.workContext')}<small>{t('home.optionalYouCanAddItLater')}</small></span></summary><div className={design.background}>
          <label>{t('home.descriptionOptional')}<textarea rows={2} maxLength={4000} value={description} disabled={locked} onChange={event => setDescription(event.target.value)} placeholder={t('home.describeWhatThisWorkbenchIsFor')} /></label>
          <label>{t('home.workbenchContextOptional')}<textarea rows={4} maxLength={20_000} value={background} disabled={locked} onChange={event => { setBackground(event.target.value); setBackgroundNotice(undefined) }} placeholder={t('home.goalsLongTermConstraintsPreferencesAndSuccess')} /></label>
          <div className={css.assistActions}><Button variant="outline" size="sm" type="button" disabled={locked || !generateDraft || !name.trim()} onClick={() => { void assist() }}>{t('home.draftContextWithAi')}</Button><span className={css.formHint}>{generateDraft ? t('home.reviewTheDraftBeforeItIsSaved') : t('home.theDshAiServiceIsDisconnectedEnter')}</span></div>
          {backgroundNotice ? <p className={css.formHint} role="status">{t(backgroundNotice)}</p> : null}
        </div></details>
        {visibleError ? <p className={css.error} role="alert">{visibleError}</p> : null}
        {error && submitted ? <p className={css.formHint}>{t('home.continuingResumesTheSameOperationWithoutCreating')}</p> : null}
        {['checking', 'creating', 'opening'].includes(phase) ? <div className={design.progress} role="status"><progress aria-label={t('home.workbenchCreationProgress')} /><span>{phase === 'checking' ? t('home.checkingTheDestinationFolder') : phase === 'creating' ? t('home.creatingTheWorkbenchAndPreparingItsMain') : t('home.openingWorkbench')}</span></div> : null}
      </div>
      <footer className={css.wizardActions}><Button type="button" disabled={busy} onClick={close}>{t('action.cancel')}</Button><Button type="submit" variant="primary" disabled={busy || !canCreate}>{phase === 'draft' ? t('home.generatingDraft') : phase === 'checking' ? t('home.checking') : phase === 'picking' ? t('home.choosingLocation') : phase === 'creating' ? t('project.creating') : phase === 'opening' ? t('home.opening') : submitted ? t('home.resumeCreation') : t('home.createAndOpen')}</Button></footer>
    </form>
  </Modal>
}
