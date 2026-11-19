import { useWorkbenchLocale } from './workbench-locale.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { BACKGROUND_AI_SCOPES, DEFAULT_BACKGROUND_AI_PREFERENCES, backgroundAiPreferencesOf, decodeBackgroundAiPreferences, type BackgroundAiPreferencesV1, type BackgroundAiScope } from './background-ai-preferences.ts'
import css from './WorkbenchSettings.module.css'

export function WorkbenchBackgroundAiSettings(props: Pick<SettingsPageProps, 'value' | 'settingsWritable' | 'settingsRevision' | 'saveBackgroundAi' | 'loadModelCatalog' | 'onDirty' | 'settingsContext'>) {
  const { t } = useWorkbenchLocale()
  const browser = props.settingsContext?.mode === 'browser-workbench'
  const scopes = browser ? BACKGROUND_AI_SCOPES.filter(scope => scope !== 'create') : BACKGROUND_AI_SCOPES
  const saved = backgroundAiPreferencesOf(props.value?.backgroundAi)
  const savedKey = JSON.stringify(saved)
  const [form, setForm] = useState(() => ({ value: saved, base: savedKey, revision: props.settingsRevision, dirty: false }))
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false)
  const [catalog, setCatalog] = useState<ModelCatalog>(), [catalogError, setCatalogError] = useState(''), [reload, setReload] = useState(0)
  const pending = useRef(false)
  const { value } = form
  const writable = props.settingsWritable !== false && !!props.saveBackgroundAi
  useEffect(() => {
    setForm(current => {
      if (current.base === savedKey) return current.revision === props.settingsRevision ? current : { ...current, revision: props.settingsRevision }
      return current.dirty ? current : { value: JSON.parse(savedKey), base: savedKey, revision: props.settingsRevision, dirty: false }
    })
  }, [savedKey, props.settingsRevision, form.dirty])
  useEffect(() => {
    let current = true
    setCatalogError('')
    if (!props.loadModelCatalog) { setCatalogError(t('settings.thisHostCannotLoadTheModelList')); return }
    void props.loadModelCatalog().then(result => { if (current) setCatalog(result) }).catch(cause => { if (current) setCatalogError(String(cause)) })
    return () => { current = false }
  }, [props.loadModelCatalog, reload])
  const edit = (next: BackgroundAiPreferencesV1) => {
    setForm(current => ({ ...current, value: next, dirty: JSON.stringify(next) !== current.base }))
    setMessage('')
  }
  const discard = useCallback(() => { setForm({ value: JSON.parse(savedKey), base: savedKey, revision: props.settingsRevision, dirty: false }); setMessage('') }, [savedKey, props.settingsRevision])
  const save = async () => {
    if (pending.current || !writable || !props.saveBackgroundAi) return false
    if (!decodeBackgroundAiPreferences(value)) { setMessage(t('settings.completeTheModelSettingsAndPromptsEach')); setError(true); return false }
    pending.current = true; setBusy(true); setMessage(t('project.saving')); setError(false)
    try {
      const result = await props.saveBackgroundAi(value, form.revision)
      if (result === false || typeof result === 'object' && result.status !== 'committed') throw new Error(typeof result === 'object' && result.status === 'conflict' ? t('settings.anotherOperationUpdatedTheseSettingsDiscardYour') : t('settings.couldNotSaveSettingsTryAgain'))
      setForm(current => ({ ...current, base: JSON.stringify(value), value, dirty: false }))
      setMessage(t('settings.savedAppliesToTheNextDraft')); return true
    } catch (cause) { setError(true); setMessage(cause instanceof Error ? cause.message : String(cause)); return false }
    finally { pending.current = false; setBusy(false) }
  }
  const saveRef = useRef(save); saveRef.current = save
  const discardRef = useRef(discard); discardRef.current = discard
  useEffect(() => { props.onDirty(form.dirty ? { save: () => saveRef.current(), discard: () => discardRef.current() } : undefined); return () => props.onDirty(undefined) }, [form.dirty, props.onDirty])
  const provider = catalog?.groups.find(group => group.id === value.selection?.provider)
  const model = provider?.models.find(row => row.id === value.selection?.model)
  const effective = value.selection ?? catalog?.default
  const effectiveProvider = catalog?.groups.find(group => group.id === effective?.provider)
  const effectiveModel = effectiveProvider?.models.find(row => row.id === effective?.model)
  const effort = effective?.reasoningEffort ?? effectiveModel?.reasoning?.defaultEffort
  const restorePrompt = (scope: BackgroundAiScope) => edit({ ...value, prompts: { ...value.prompts, [scope]: DEFAULT_BACKGROUND_AI_PREFERENCES.prompts[scope] } })
  return <section className={css.backgroundAi} aria-label={t('settings.aiAssistedContextDrafting')}>
    <div className={css.sectionHeader}><div><h4>{t('settings.aiAssistedContextDrafting')}</h4><p>{browser ? t('settings.theseSettingsTravelWithTheFullWorkbench') : t('settings.hostDefaultsApplyToNewWorkbenchesAnd')}{t('settings.generatesDraftsSeparatelyFromTheMainBay')}</p></div></div>
    <fieldset disabled={!writable || busy}>
      <div className={css.backgroundAiModels}>
        <label>{t('settings.modelProvider')}<select aria-label={t('settings.contextDraftingProvider')} value={value.selection?.provider ?? ''} onChange={event => {
          const group = catalog?.groups.find(row => row.id === event.target.value), nextModel = group?.models[0]
          const { selection: _previous, ...rest } = value
          edit(group && nextModel ? { ...rest, selection: { provider: group.id, model: nextModel.id } } : rest)
        }}><option value="">{t('settings.useDshDefault')}</option>{value.selection && !provider ? <option value={value.selection.provider}>{value.selection.provider}{t('settings.unavailable')}</option> : null}{catalog?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>{t('settings.model')}<select aria-label={t('settings.contextDraftingModel')} value={value.selection?.model ?? ''} disabled={!value.selection} onChange={event => { if (value.selection) edit({ ...value, selection: { provider: value.selection.provider, model: event.target.value } }) }}><option value="" disabled>{t('settings.useDefaultModel')}</option>{value.selection && !model ? <option value={value.selection.model}>{value.selection.model}{t('settings.unavailable')}</option> : null}{provider?.models.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>{t('settings.reasoningEffort')}<select aria-label={t('settings.contextDraftingReasoningEffort')} value={value.selection?.reasoningEffort ?? ''} disabled={!value.selection || !model?.reasoning} onChange={event => {
          if (!value.selection) return
          edit({ ...value, selection: { provider: value.selection.provider, model: value.selection.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) } })
        }}><option value="">{t('settings.modelDefault')}</option>{value.selection?.reasoningEffort && !model?.reasoning?.efforts.some(row => row.id === value.selection?.reasoningEffort) ? <option value={value.selection.reasoningEffort}>{value.selection.reasoningEffort}{t('settings.unavailable')}</option> : null}{model?.reasoning?.efforts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      </div>
      <p className={css.cardHint}>{t('settings.current2')}{form.dirty ? t('settings.unsaved') : t('settings.active')}{t('settings.model2')}{effective ? `${effectiveProvider?.name ?? effective.provider} / ${effectiveModel?.name ?? effective.model}${effort ? ` · ${effectiveModel?.reasoning?.efforts.find(row => row.id === effort)?.name ?? effort}` : ''}` : catalogError ? t('settings.couldNotLoadTheDshDefaultModel') : t('settings.loading')}</p>
      {catalogError || catalog?.failures.length ? <p role="alert">{catalogError || t('settings.someProvidersCouldNotBeLoadedValue1', { value1: catalog?.failures.map(row => `${row.name}: ${row.message}`).join('; ') ?? '' })}<button type="button" onClick={() => setReload(count => count + 1)}>{t('settings.refreshModelList')}</button></p> : null}
      <p className={css.cardHint}>{t('settings.theFullRequestCombinesSharedInstructionsThe')}</p>
      <details className={css.backgroundAiPrompt}><summary>{t('settings.sharedInstructions')}</summary><label>{t('settings.sharedSystemPrompt')}<textarea aria-label={t('settings.sharedSystemPrompt')} rows={6} maxLength={20000} value={value.systemPrompt} onChange={event => edit({ ...value, systemPrompt: event.target.value })} /></label><button type="button" className={css.secondaryButton} onClick={() => edit({ ...value, systemPrompt: DEFAULT_BACKGROUND_AI_PREFERENCES.systemPrompt })}>{t('settings.resetSharedInstructions')}</button></details>
      {scopes.map(scope => <details key={scope} className={css.backgroundAiPrompt}><summary>{t(`settings.background.${scope}`)}{t('settings.prompt')}</summary><p>{t(`settings.background.${scope}.source`)}</p><label>{t(`settings.background.${scope}`)}{t('settings.prompt')}<textarea aria-label={t('settings.value1Prompt', { value1: t(`settings.background.${scope}`) })} rows={6} maxLength={20000} value={value.prompts[scope]} onChange={event => edit({ ...value, prompts: { ...value.prompts, [scope]: event.target.value } })} /></label><button type="button" className={css.secondaryButton} onClick={() => restorePrompt(scope)}>{t('settings.reset')}{t(`settings.background.${scope}`)}{t('settings.defaultPrompt')}</button></details>)}
      <div className={css.noticeActions}><button type="button" className={css.primaryButton} disabled={!form.dirty} onClick={() => void save()}>{t('settings.saveContextAiSettings')}</button><button type="button" className={css.secondaryButton} disabled={!form.dirty} onClick={discard}>{t('settings.discardChanges2')}</button><button type="button" className={css.secondaryButton} onClick={() => edit(backgroundAiPreferencesOf())}>{t('settings.resetContextAiDefaults')}</button></div>
    </fieldset>
    {form.dirty && form.base !== savedKey ? <p role="alert">{t('settings.anotherWindowUpdatedTheseSettingsYourDraft')}</p> : null}
    {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
  </section>
}
