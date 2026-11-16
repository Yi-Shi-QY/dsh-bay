import { describe, expect, it } from 'vitest'
import {
  conversationResourceActionFor,
  migrateWorkbenchInteractionPolicy,
  DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY,
  normalizeWorkbenchConversationInteractionPolicy,
} from '../src/workbench-interaction-policy.ts'
import { decodeWorkbenchSettingsV4 } from '../src/foundation/persistence.ts'

describe('Workbench Conversation interaction policy', () => {
  it('keeps native resource defaults compatible with the existing Area route', () => {
    expect(conversationResourceActionFor('file', undefined)).toEqual({ handled: true, options: { floating: true } })
    expect(conversationResourceActionFor('changes-review', DEFAULT_WORKBENCH_CONVERSATION_INTERACTION_POLICY)).toEqual({ handled: true, options: { floating: true } })
  })

  it('turns user placement choices into explicit native-tab actions', () => {
    const policy = normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: {
        file: { enabled: true, placement: 'new-tab' },
        plan: { enabled: true, placement: 'replace-current' },
      },
    })
    expect(conversationResourceActionFor('file', policy)).toEqual({ handled: true, options: { revealIfOpened: false } })
    expect(conversationResourceActionFor('plan', policy)).toEqual({ handled: true, options: { replaceTab: true } })
  })

  it('blocks disabled resources while allowing an explicit official-sidebar fallback', () => {
    expect(conversationResourceActionFor('file', normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: false, placement: 'activate-or-add' } },
    }))).toEqual({ handled: true, options: { ignoreResource: true } })
    expect(conversationResourceActionFor('file', normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { file: { enabled: true, placement: 'official-sidebar' } },
    }))).toEqual({ handled: true, options: { floating: true } })
  })

  it('includes browser links in the same configurable resource policy', () => {
    expect(conversationResourceActionFor('browser', undefined)).toEqual({ handled: true, options: { floating: true } })
    expect(conversationResourceActionFor('browser', normalizeWorkbenchConversationInteractionPolicy({
      conversationResources: { browser: { enabled: false, placement: 'disabled' } },
    }))).toEqual({ handled: true, options: { ignoreResource: true } })
  })

  it('applies unknown-resource handling to unconfigured resource types', () => {
    expect(conversationResourceActionFor('future-resource', normalizeWorkbenchConversationInteractionPolicy({
      unknownResource: 'module-default',
    }))).toEqual({ handled: true })
    expect(conversationResourceActionFor('future-resource', normalizeWorkbenchConversationInteractionPolicy({
      unknownResource: 'official-sidebar',
    }))).toEqual({ handled: true, options: { floating: true } })
    expect(conversationResourceActionFor('future-resource', normalizeWorkbenchConversationInteractionPolicy({
      unknownResource: 'disabled',
    }))).toEqual({ handled: true, options: { ignoreResource: true } })
  })

  it('does not trust malformed settings and limits extension keys', () => {
    const policy = normalizeWorkbenchConversationInteractionPolicy({
      unknownResource: 'invalid',
      conversationResources: {
        file: { enabled: true, placement: 'new-tab' },
        'bad key': { enabled: true, placement: 'new-tab' },
        broken: { enabled: 'yes', placement: 'new-tab' },
      },
    })
    expect(policy.unknownResource).toBe('module-default')
    expect(policy.conversationResources.file).toEqual({ enabled: true, placement: 'new-tab' })
    expect(policy.conversationResources['bad key']).toBeUndefined()
    expect(policy.conversationResources.broken).toBeUndefined()
  })

  it('defaults marker frames on and preserves the minimal presentation choice', () => {
    expect(normalizeWorkbenchConversationInteractionPolicy(undefined).showSessionAccentFrames).toBe(true)
    expect(normalizeWorkbenchConversationInteractionPolicy({ showSessionAccentFrames: false }).showSessionAccentFrames).toBe(false)
    expect(normalizeWorkbenchConversationInteractionPolicy({ showSessionAccentFrames: 'off' }).showSessionAccentFrames).toBe(true)
  })

  it('normalizes tab label size and close-button preferences', () => {
    expect(normalizeWorkbenchConversationInteractionPolicy(undefined).tabFontSize).toBe('standard')
    expect(normalizeWorkbenchConversationInteractionPolicy(undefined).showTabCloseButtons).toBe(true)
    expect(normalizeWorkbenchConversationInteractionPolicy({ tabFontSize: 'larger', showTabCloseButtons: false })).toMatchObject({
      tabFontSize: 'larger', showTabCloseButtons: false,
    })
    expect(normalizeWorkbenchConversationInteractionPolicy({ tabFontSize: 'huge', showTabCloseButtons: 'off' })).toMatchObject({
      tabFontSize: 'standard', showTabCloseButtons: true,
    })
  })

  it('adds defaults while decoding a pre-policy V4 profile', () => {
    const decoded = decodeWorkbenchSettingsV4({
      version: 4,
      activeWorkbenchId: 'main',
      openWorkbenchIds: ['main'],
      workbenches: {
        main: {
          workbenchId: 'main', name: 'Main', description: '', createdAt: 0, updatedAt: 0,
          document: { version: 3, root: { kind: 'area', areaId: 'group-main', moduleHistory: [] }, activeAreaId: 'group-main' },
        },
      },
      layoutTemplates: {}, invalidWorkbenches: {}, sessionMarkers: {},
    })
    expect(decoded?.interactionPolicy?.conversationResources.file).toEqual({ enabled: true, placement: 'floating' })
  })
})

it('migrates enabled extension preferences once and preserves disabled choices', () => {
  const first = migrateWorkbenchInteractionPolicy({ conversationResources: { file: { enabled: false, placement: 'disabled' }, custom: { enabled: true, placement: 'new-tab' } } })
  expect(first.conversationResources.file?.enabled).toBe(false)
  expect(first.conversationResources.custom?.placement).toBe('floating')
  const edited = { ...first, conversationResources: { ...first.conversationResources, custom: { enabled: true, placement: 'new-tab' as const } } }
  expect(migrateWorkbenchInteractionPolicy(edited)).toEqual(edited)
})
