import { describe, expect, it } from 'vitest'
import { buildWorkbenchTabInformation, type WorkbenchTabInformationFacts } from '../src/foundation/tab-information.ts'
import type { TabDocument } from '../src/foundation/model.ts'

const facts: WorkbenchTabInformationFacts = {
  sessions: {
    parent: { title: '登录页交互优化', displayTitle: '旧的回退名称', cwd: 'C:/project/app', projectionValues: { agentPreset: 'ptc' } },
    child: { displayTitle: '检查表单验证', projectionValues: { agentPreset: 'minimal' } },
  },
  workspaces: [{ workspaceId: 'project', title: 'Bay 项目', path: 'C:/project', sessionIds: ['parent', 'child'] }],
  markersByWorkspace: { project: { parent: { label: 'A' }, child: { label: 'B' } } },
  location: '区域 02',
}
function info(overrides: Partial<TabDocument> = {}, currentFacts = facts) {
  const tab: TabDocument = { id: 'tab', editorId: 'workbench.conversation', editorScope: 'session', binding: { sessionId: 'parent', workspaceId: 'project' }, state: {}, lastKnownTitle: '对话', ...overrides }
  return buildWorkbenchTabInformation({ tab, editor: { id: tab.editorId, scope: tab.editorScope, label: '内页类型' },
    areaBinding: { workspaceId: 'project', sessionId: 'parent' }, statusLabel: '进行中', ordinal: 3, facts: currentFacts })
}

describe('tab identifying information', () => {
  it('uses the actual title and mode with a project, marker and position, and searches raw preset IDs', () => {
    const result = info()
    expect(result.tooltip).toContain('对话：A · 登录页交互优化\nAgent 模式：PTC 模式\n项目：Bay 项目')
    expect(result.tooltip).toContain('位置：区域 02 · 第 3 个内页')
    expect(result.searchText).toContain('ptc')
    expect(result.tooltip).not.toContain('旧的回退名称')
    expect(info({}, { ...facts, sessions: { parent: { title: '新的对话名称', projectionValues: { agentPreset: 'custom-reviewer' } } } }).tooltip)
      .toContain('新的对话名称\nAgent 模式：custom-reviewer')
  })

  it('distinguishes missing mode metadata from a deployment with no preset', () => {
    expect(info({}, { ...facts, sessions: { parent: { displayTitle: '模式未加载' } } }).tooltip).toContain('Agent 模式：暂未同步')
    expect(info({}, { ...facts, sessions: { parent: { projectionValues: { agentPreset: null } } } }).tooltip).toContain('Agent 模式：未配置模式')
    expect(info({}, { ...facts, sessions: {} }).tooltip).toContain('对话信息暂不可用')
  })

  it('does not inherit conversation metadata into independent or pending tabs', () => {
    expect(info({ editorScope: 'root', binding: undefined }).tooltip).not.toContain('登录页交互优化')
    const pending = info({ pendingBinding: 'new', sessionId: 'parent', state: { resourceAddress: 'dsh-resource://file/session/parent/secret.ts' } })
    expect(pending.tooltip).toContain('对话：待绑定')
    expect(pending.tooltip).not.toMatch(/登录页交互优化|PTC|secret/)
    expect(info({ editorScope: 'root', binding: { sessionId: 'parent' } }).tooltip).toContain('登录页交互优化')
  })

  it('identifies a child resource using its own conversation, mode and marker', () => {
    const result = info({ editorId: 'workbench.subagent-chat', state: { resourceAddress: 'dsh-resource://subagentchat/session/child?parent=parent&mode=continuable' } })
    expect(result.tooltip).toContain('对话：B · 检查表单验证\nAgent 模式：极简模式')
    expect(result.tooltip).not.toMatch(/登录页交互优化|PTC/)
    const missing = info({ editorId: 'workbench.subagent-chat', state: { resourceAddress: 'dsh-resource://subagentchat/session/missing?parent=parent' } })
    expect(missing.tooltip).toContain('对话信息暂不可用')
    expect(missing.tooltip).not.toMatch(/登录页交互优化|PTC/)
  })

  it('decodes file paths and reads only allowlisted resource information', () => {
    const result = info({ editorId: 'workbench.document-preview', state: { resourceAddress: 'dsh-resource://file/session/parent/src%2F%E8%A1%A8%E5%8D%95.tsx', token: 'PRIVATE', nativeParams: { text: 'PRIVATE' } } })
    expect(result.tooltip).toContain('文件：src/表单.tsx')
    expect(result.searchText).toContain('src/表单.tsx')
    expect(result.tooltip).not.toContain('PRIVATE')
    expect(() => info({ state: { resourceAddress: 'dsh-resource://file/session/%invalid/%bad' } })).not.toThrow()
  })

  it('shows recorded browser navigation without presenting the initial resource as a live URL', () => {
    const tab = { editorId: 'workbench.browser', state: { history: ['https://example.com/old', 'https://user:secret@example.com/new'], index: 1, unknown: true,
      resourceAddress: `dsh-resource://browser/session/parent/${encodeURIComponent('https://example.com/initial')}` } }
    const result = info(tab)
    expect(result.tooltip).toContain('上次已知地址：https://example.com/new')
    expect(result.tooltip).not.toMatch(/secret|initial|old/)
    expect(info({ ...tab, state: { resourceAddress: tab.state.resourceAddress } }).tooltip).toContain('已打开地址：https://example.com/initial')
    expect(info({ editorId: 'workbench.browser', state: { url: 'javascript:alert(1)' } }).tooltip).not.toContain('javascript')
  })

  it('shows workspace and terminal context and a plan title without exposing plan content', () => {
    expect(info({ editorId: 'workbench.workspace-files' }).tooltip).toContain('目录：C:/project/app')
    expect(info({ editorId: 'workbench.terminal' }).tooltip).toContain('对话目录：C:/project/app')
    const result = info({ editorId: 'workbench.plan', state: { nativeParams: { planReview: { title: '表单优化计划', markdown: 'PRIVATE' } } } })
    expect(result.tooltip).toContain('计划：表单优化计划')
    expect(result.tooltip).not.toContain('PRIVATE')
  })
})
