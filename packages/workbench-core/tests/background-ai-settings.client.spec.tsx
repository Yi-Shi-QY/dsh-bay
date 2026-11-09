// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller'
import { WorkbenchCoreSettingsSection, type WorkbenchCoreSettingsSectionProps } from '../src/foundation/WorkbenchCoreSettingsSection.tsx'
import { backgroundAiPreferencesOf } from '../src/foundation/background-ai-preferences.ts'
import { settingsViewMemory, DESKTOP_SETTINGS_CONTEXT } from '../src/foundation/settings-context.ts'
import { mutableSettings, settingsFixture } from './settings-fixtures.ts'

const catalog: ModelCatalog = { default: { provider: 'p', model: 'fast', reasoningEffort: 'low' }, routableProviders: ['p'], failures: [], groups: [{ id: 'p', name: 'Provider', models: [{ id: 'fast', name: 'Fast', reasoning: { defaultEffort: 'low', efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }] } }, { id: 'plain', name: 'Plain' }] }] }
beforeEach(() => { settingsViewMemory(DESKTOP_SETTINGS_CONTEXT).section = 'interactions' })
afterEach(cleanup)
function setup(browser = false) {
  const settings = settingsFixture()
  if (browser) {
    settings.backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Host default instructions' }
    settings.workbenches.a!.backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Workbench instructions' }
  }
  const f = mutableSettings(settings)
  const save = vi.fn<NonNullable<WorkbenchCoreSettingsSectionProps['saveBackgroundAi']>>((value, expectedRevision) => f.source.patch({ operation: 'set', path: browser ? ['workbenches', 'a', 'backgroundAi'] : ['backgroundAi'], value, expectedRevision }))
  const close = vi.fn()
  let closeRequest = close as () => void
  const props = {
    editorCatalog: { getSnapshot: () => [], subscribe: () => () => {} },
    useWorkbenchSettings: (select: (value: unknown) => unknown) => select(useSyncExternalStore(f.source.subscribe, f.source.getSnapshot)),
    useSessions: (select: (value: unknown) => unknown) => select({ ids: [], byId: {} }),
    useWorkspaces: (select: (value: unknown) => unknown) => select({ items: [] }),
    openOptions: { section: 'interactions' }, loadModelCatalog: vi.fn(async () => catalog), saveBackgroundAi: save,
    ...(browser ? { settingsContext: { mode: 'browser-workbench', workbenchId: 'a' } } : {}),
    close, registerCloseRequest: (request: () => void) => { closeRequest = request; return () => {} },
  } as WorkbenchCoreSettingsSectionProps
  // Keep catalog snapshots referentially stable for useSyncExternalStore.
  const editors: never[] = []; props.editorCatalog.getSnapshot = () => editors
  const view = render(<WorkbenchCoreSettingsSection {...props} />)
  const prompt = (label = '区域背景提示词') => view.getByLabelText(label) as HTMLTextAreaElement
  return { ...f, view, save, props, close, prompt, requestClose: () => closeRequest() }
}

describe('background AI preferences in interaction settings', () => {
  it('shows and edits only current-workbench prompts in browser settings', async () => {
    const f = setup(true)
    expect(f.view.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['当前工作台', '使用中的内页', '背景 AI', '导入与分享'])
    expect(f.prompt('共用系统提示词').value).toBe('Workbench instructions')
    expect(f.view.queryByLabelText('新建工作台提示词')).toBeNull()
    expect(f.view.getByLabelText('工作台背景提示词')).toBeTruthy()
    expect(f.view.getByText(/保存为当前工作台的专属配置/)).toBeTruthy()
    fireEvent.change(f.prompt(), { target: { value: 'Portable area instructions' } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.workbenches.a?.backgroundAi?.prompts.area).toBe('Portable area instructions'))
    expect(f.source.getSnapshot().value?.backgroundAi?.systemPrompt).toBe('Host default instructions')
    fireEvent.click(f.view.getByRole('tab', { name: '使用中的内页' }))
    fireEvent.click(f.view.getByRole('tab', { name: '背景 AI' }))
    expect(f.prompt().value).toBe('Portable area instructions')
  })
  it('shows the actual DSH default, saves all four prompts and model selection, and reloads them on navigation', async () => {
    const f = setup()
    await waitFor(() => expect(f.view.getByText('当前生效模型：Provider / Fast · 低')).toBeTruthy())
    expect(f.writes).toEqual([])
    fireEvent.change(f.view.getByLabelText('背景生成模型供应商'), { target: { value: 'p' } })
    fireEvent.change(f.view.getByLabelText('背景生成思考强度'), { target: { value: 'high' } })
    for (const [label, text] of [['共用系统提示词', 'Shared'], ['新建工作台提示词', 'Create'], ['工作台背景提示词', 'Workbench'], ['区域背景提示词', 'Area']]) fireEvent.change(f.prompt(label), { target: { value: text } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.view.getByText('已保存，下次生成生效。')).toBeTruthy())
    expect(f.source.getSnapshot().value?.backgroundAi).toMatchObject({ selection: { provider: 'p', model: 'fast', reasoningEffort: 'high' }, systemPrompt: 'Shared', prompts: { create: 'Create', workbench: 'Workbench', area: 'Area' } })
    fireEvent.click(f.view.getByRole('tab', { name: '内页与扩展' }))
    fireEvent.click(f.view.getByRole('tab', { name: '交互偏好' }))
    expect(f.prompt().value).toBe('Area')
    expect((f.view.getByLabelText('背景生成思考强度') as HTMLSelectElement).value).toBe('high')
  })

  it('keeps unsaved prompts on close and saves them when the user chooses save and leave', async () => {
    const f = setup()
    fireEvent.change(f.prompt(), { target: { value: 'Unsaved area' } })
    act(() => f.requestClose())
    expect(f.view.getByRole('alertdialog', { name: '资料尚未保存' })).toBeTruthy()
    expect(f.close).not.toHaveBeenCalled()
    fireEvent.click(f.view.getByRole('button', { name: '继续编辑' }))
    expect(f.prompt().value).toBe('Unsaved area')
    act(() => f.requestClose())
    fireEvent.click(f.view.getByRole('button', { name: '保存并离开' }))
    await waitFor(() => expect(f.close).toHaveBeenCalledOnce())
    expect(f.source.getSnapshot().value?.backgroundAi?.prompts.area).toBe('Unsaved area')
  })

  it('cancels edits and previews restoration before saving defaults', async () => {
    const f = setup()
    fireEvent.change(f.prompt(), { target: { value: 'Keep area' } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.view.getByText('已保存，下次生成生效。')).toBeTruthy())
    fireEvent.click(f.view.getByRole('button', { name: '恢复背景 AI 默认' }))
    expect(f.prompt().value).toBe(backgroundAiPreferencesOf().prompts.area)
    expect(f.source.getSnapshot().value?.backgroundAi?.prompts.area).toBe('Keep area')
    fireEvent.click(f.view.getByRole('button', { name: '取消修改' }))
    expect(f.prompt().value).toBe('Keep area')
    fireEvent.click(f.view.getByRole('button', { name: '恢复背景 AI 默认' }))
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.backgroundAi).toEqual(backgroundAiPreferencesOf()))
  })

  it('clears model-specific effort on a model change and supports returning to DSH defaults', async () => {
    const f = setup()
    await waitFor(() => expect(f.view.getByText('当前生效模型：Provider / Fast · 低')).toBeTruthy())
    fireEvent.change(f.view.getByLabelText('背景生成模型供应商'), { target: { value: 'p' } })
    fireEvent.change(f.view.getByLabelText('背景生成思考强度'), { target: { value: 'high' } })
    fireEvent.change(f.view.getByLabelText('背景生成模型'), { target: { value: 'plain' } })
    expect((f.view.getByLabelText('背景生成思考强度') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.backgroundAi?.selection).toEqual({ provider: 'p', model: 'plain' }))
    fireEvent.change(f.view.getByLabelText('背景生成模型供应商'), { target: { value: '' } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.backgroundAi?.selection).toBeUndefined())
  })

  it('preserves failed input for retry and rejects blank instructions without a write', async () => {
    const f = setup()
    fireEvent.change(f.prompt(), { target: { value: '' } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    expect(f.save).not.toHaveBeenCalled()
    f.save.mockRejectedValueOnce(new Error('Connection interrupted'))
    fireEvent.change(f.prompt(), { target: { value: 'Retry me' } })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.view.getByText('Connection interrupted')).toBeTruthy())
    expect(f.prompt().value).toBe('Retry me')
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.backgroundAi?.prompts.area).toBe('Retry me'))
  })

  it('allows unrelated settings updates but prevents overwriting background edits from another window', async () => {
    const f = setup()
    fireEvent.change(f.prompt(), { target: { value: 'My area' } })
    await act(async () => { await f.source.patch({ operation: 'set', path: ['globalHiddenEditorIds'], value: ['notes'] }) })
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.source.getSnapshot().value?.backgroundAi?.prompts.area).toBe('My area'))
    fireEvent.change(f.prompt(), { target: { value: 'Unsaved local' } })
    const foreign = { ...backgroundAiPreferencesOf(), systemPrompt: 'Other window' }
    await act(async () => { await f.source.patch({ operation: 'set', path: ['backgroundAi'], value: foreign }) })
    expect(f.prompt().value).toBe('Unsaved local')
    fireEvent.click(f.view.getByRole('button', { name: '保存背景 AI 设置' }))
    await waitFor(() => expect(f.view.getByText(/设置已被其他操作更新/)).toBeTruthy())
    expect(f.source.getSnapshot().value?.backgroundAi).toEqual(foreign)
    fireEvent.click(f.view.getByRole('button', { name: '取消修改' }))
    expect(f.prompt('共用系统提示词').value).toBe('Other window')
  })
})
