import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import type { SettingsPageProps } from './WorkbenchSettingsPages.tsx'
import { BACKGROUND_AI_SCOPES, DEFAULT_BACKGROUND_AI_PREFERENCES, backgroundAiPreferencesOf, decodeBackgroundAiPreferences, type BackgroundAiPreferencesV1, type BackgroundAiScope } from './background-ai-preferences.ts'
import css from './WorkbenchSettings.module.css'

const LABELS: Record<BackgroundAiScope, string> = { create: '新建工作台', workbench: '工作台背景', area: '区域背景' }
const SOURCES: Record<BackgroundAiScope, string> = {
  create: '自动附加当前填写的名称、简介和草稿。',
  workbench: '自动附加工作台名称、简介、全部区域及其内页清单和当前草稿。',
  area: '自动附加当前区域的全部内页清单和草稿。',
}

export function WorkbenchBackgroundAiSettings(props: Pick<SettingsPageProps, 'value' | 'settingsWritable' | 'settingsRevision' | 'saveBackgroundAi' | 'loadModelCatalog' | 'onDirty' | 'settingsContext'>) {
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
    if (!props.loadModelCatalog) { setCatalogError('当前环境无法读取模型列表。'); return }
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
    if (!decodeBackgroundAiPreferences(value)) { setMessage('请填写完整的模型配置和提示词，每段提示词最多 20,000 字。'); setError(true); return false }
    pending.current = true; setBusy(true); setMessage('正在保存…'); setError(false)
    try {
      const result = await props.saveBackgroundAi(value, form.revision)
      if (result === false || typeof result === 'object' && result.status !== 'committed') throw new Error(typeof result === 'object' && result.status === 'conflict' ? '设置已被其他操作更新，本次未覆盖。请取消修改后重新编辑。' : '设置未能保存，请重试。')
      setForm(current => ({ ...current, base: JSON.stringify(value), value, dirty: false }))
      setMessage('已保存，下次生成生效。'); return true
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
  return <section className={css.backgroundAi} aria-label="背景 AI 辅助填写">
    <div className={css.sectionHeader}><div><h4>背景 AI 辅助填写</h4><p>{browser ? '保存为当前工作台的专属配置，随完整工作台包迁移。用于工作台与区域背景生成；新建工作台仍使用主机默认配置。' : '主机默认配置用于新建工作台，以及未设置专属配置的工作台和区域。三个入口分别使用各自的提示词。'}独立生成草稿，不进入 Bay Agent 主会话。</p></div></div>
    <fieldset disabled={!writable || busy}>
      <div className={css.backgroundAiModels}>
        <label>模型供应商<select aria-label="背景生成模型供应商" value={value.selection?.provider ?? ''} onChange={event => {
          const group = catalog?.groups.find(row => row.id === event.target.value), nextModel = group?.models[0]
          const { selection: _previous, ...rest } = value
          edit(group && nextModel ? { ...rest, selection: { provider: group.id, model: nextModel.id } } : rest)
        }}><option value="">跟随 DSH 默认</option>{value.selection && !provider ? <option value={value.selection.provider}>{value.selection.provider}（当前不可用）</option> : null}{catalog?.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>模型<select aria-label="背景生成模型" value={value.selection?.model ?? ''} disabled={!value.selection} onChange={event => { if (value.selection) edit({ ...value, selection: { provider: value.selection.provider, model: event.target.value } }) }}><option value="" disabled>跟随默认模型</option>{value.selection && !model ? <option value={value.selection.model}>{value.selection.model}（当前不可用）</option> : null}{provider?.models.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>思考强度<select aria-label="背景生成思考强度" value={value.selection?.reasoningEffort ?? ''} disabled={!value.selection || !model?.reasoning} onChange={event => {
          if (!value.selection) return
          edit({ ...value, selection: { provider: value.selection.provider, model: value.selection.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) } })
        }}><option value="">模型默认</option>{value.selection?.reasoningEffort && !model?.reasoning?.efforts.some(row => row.id === value.selection?.reasoningEffort) ? <option value={value.selection.reasoningEffort}>{value.selection.reasoningEffort}（当前不可用）</option> : null}{model?.reasoning?.efforts.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      </div>
      <p className={css.cardHint}>当前{form.dirty ? '待保存' : '生效'}模型：{effective ? `${effectiveProvider?.name ?? effective.provider} / ${effectiveModel?.name ?? effective.model}${effort ? ` · ${effectiveModel?.reasoning?.efforts.find(row => row.id === effort)?.name ?? effort}` : ''}` : catalogError ? '无法读取 DSH 默认模型' : '正在读取…'}</p>
      {catalogError || catalog?.failures.length ? <p role="alert">{catalogError || `部分供应商无法读取：${catalog?.failures.map(row => `${row.name}：${row.message}`).join('；')}`}<button type="button" onClick={() => setReload(count => count + 1)}>刷新模型列表</button></p> : null}
      <p className={css.cardHint}>完整请求由共用说明、所选入口提示词和自动读取的资料组成。直接编辑提示词即可，无需填写变量。</p>
      <details className={css.backgroundAiPrompt}><summary>共用说明</summary><label>共用系统提示词<textarea aria-label="共用系统提示词" rows={6} maxLength={20000} value={value.systemPrompt} onChange={event => edit({ ...value, systemPrompt: event.target.value })} /></label><button type="button" className={css.secondaryButton} onClick={() => edit({ ...value, systemPrompt: DEFAULT_BACKGROUND_AI_PREFERENCES.systemPrompt })}>恢复共用说明默认</button></details>
      {scopes.map(scope => <details key={scope} className={css.backgroundAiPrompt}><summary>{LABELS[scope]}提示词</summary><p>{SOURCES[scope]}</p><label>{LABELS[scope]}提示词<textarea aria-label={`${LABELS[scope]}提示词`} rows={6} maxLength={20000} value={value.prompts[scope]} onChange={event => edit({ ...value, prompts: { ...value.prompts, [scope]: event.target.value } })} /></label><button type="button" className={css.secondaryButton} onClick={() => restorePrompt(scope)}>恢复{LABELS[scope]}提示词默认</button></details>)}
      <div className={css.noticeActions}><button type="button" className={css.primaryButton} disabled={!form.dirty} onClick={() => void save()}>保存背景 AI 设置</button><button type="button" className={css.secondaryButton} disabled={!form.dirty} onClick={discard}>取消修改</button><button type="button" className={css.secondaryButton} onClick={() => edit(backgroundAiPreferencesOf())}>恢复背景 AI 默认</button></div>
    </fieldset>
    {form.dirty && form.base !== savedKey ? <p role="alert">其他窗口已更新背景 AI 设置，当前草稿保留。请取消修改后读取最新设置。</p> : null}
    {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
  </section>
}
