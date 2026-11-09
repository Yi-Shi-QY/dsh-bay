import { describe, expect, it } from 'vitest'
import { backgroundAiPreferencesForWorkbench, backgroundAiPreferencesOf, decodeBackgroundAiPreferences } from '../src/foundation/background-ai-preferences.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'
import { WorkbenchSettingsSchema } from '../src/host-layout-settings.ts'
import { settingsFixture } from './settings-fixtures.ts'

describe('background AI preferences persistence', () => {
  it('round trips customized prompts and selection through the Host schema and V4 decoder', () => {
    const backgroundAi = { ...backgroundAiPreferencesOf(), selection: { provider: 'custom', model: 'fast', reasoningEffort: 'low' }, systemPrompt: 'Custom system', prompts: { create: 'Create only', workbench: 'Workbench only', area: 'Area only' } }
    const decoded = decodeWorkbenchSettingsV4(WorkbenchSettingsSchema({ ...settingsFixture(), backgroundAi }))!
    expect(decoded.backgroundAi).toEqual(backgroundAi)
    expect(decoded.workbenches.a?.document.root.kind).toBe('area')
  })

  it('keeps old profiles and malformed AI preferences from losing their Workbenches', () => {
    for (const backgroundAi of [undefined, {}, { version: 99 }, { ...backgroundAiPreferencesOf(), systemPrompt: '' }]) {
      const decoded = decodeWorkbenchSettingsV4({ ...settingsFixture(), backgroundAi })!
      expect(decoded.workbenches.a?.name).toBe('A')
      expect(decoded.backgroundAi).toBeUndefined()
      expect(backgroundAiPreferencesOf(decoded.backgroundAi)).toEqual(backgroundAiPreferencesOf())
    }
  })

  it('preserves workbench-specific preferences independently of Host defaults', () => {
    const settings = settingsFixture()
    settings.backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Host default' }
    settings.workbenches.a!.backgroundAi = { ...backgroundAiPreferencesOf(), systemPrompt: 'Portable workbench', selection: { provider: 'portable', model: 'small' } }
    const decoded = decodeWorkbenchSettingsV4(WorkbenchSettingsSchema(settings))!
    expect(decoded.workbenches.a?.backgroundAi).toEqual(settings.workbenches.a!.backgroundAi)
    expect(backgroundAiPreferencesForWorkbench(decoded, 'a').systemPrompt).toBe('Portable workbench')
    expect(backgroundAiPreferencesForWorkbench(decoded, 'b').systemPrompt).toBe('Host default')
    expect(backgroundAiPreferencesForWorkbench(decoded).systemPrompt).toBe('Host default')
  })

  it('rejects incomplete model selections and blank or oversized prompts', () => {
    const base = backgroundAiPreferencesOf()
    for (const bad of [
      { ...base, selection: { provider: 'p', model: '' } },
      { ...base, selection: { provider: 'p', model: 'm', reasoningEffort: 5 } },
      { ...base, prompts: { ...base.prompts, area: ' ' } },
      { ...base, systemPrompt: 'x'.repeat(20001) },
    ]) expect(decodeBackgroundAiPreferences(bad)).toBeUndefined()
    const independent = backgroundAiPreferencesOf(); independent.prompts.area = 'edited'
    expect(backgroundAiPreferencesOf().prompts.area).toBe(base.prompts.area)
  })
})
