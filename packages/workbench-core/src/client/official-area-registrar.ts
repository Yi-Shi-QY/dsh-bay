import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { WORKBENCH_OFFICIAL_AREA_EDITOR_IDS, type WorkbenchOfficialAreaEditorSetV1 } from './official-area-editors.tsx'
import type { WorkbenchConversationResourceBindingV1, WorkbenchEditorDeclarationV1 } from '../module-contract.ts'

function disposerOf(value: unknown): () => void {
  return typeof value === 'function' ? value as () => void : () => {}
}

/** Register the DSH-owned capabilities as Core-provided official editors. */
export function registerWorkbenchOfficialAreaEditors(
  ctx: ClientContext,
  editors: WorkbenchOfficialAreaEditorSetV1,
): () => void {
  const declaration = (
    editorId: string,
    scope: WorkbenchEditorDeclarationV1['scope'],
    label: string,
    requiredBinding: WorkbenchEditorDeclarationV1['requiredBinding'],
    collapsed: WorkbenchEditorDeclarationV1['runtime']['collapsed'],
    background: WorkbenchEditorDeclarationV1['runtime']['background'],
    conversationResources?: readonly WorkbenchConversationResourceBindingV1[],
  ): WorkbenchEditorDeclarationV1 => ({
    editorId, scope, label,
    state: { schemaVersion: 1, maxBytes: 256 * 1024, restore: 'if-valid', share: 'portable' },
    requiredBinding,
    binding: {
      requirement: requiredBinding,
      unbound: requiredBinding === 'none' ? 'available' : 'pending',
      sharing: requiredBinding === 'session' ? 'independent' : 'none',
    },
    ...(conversationResources === undefined ? {} : { conversationResources }),
    runtime: { background, collapsed, reacquire: 'on-visible' },
  })
  const declarations = {
    start: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.start, 'root', '新建对话', 'none', 'dispose', 'keep'),
    conversation: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.conversation, 'session', '对话', 'session', 'keep', 'keep'),
    trajectory: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.trajectory, 'session', 'Agent 轨迹', 'session', 'pause', 'pause'),
    files: { ...declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.files, 'root', '项目文件', 'none', 'pause', 'pause'), presentation: { floating: false } },
    terminal: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.terminal, 'session', '终端', 'session', 'pause', 'keep'),
    browser: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.browser, 'session', '浏览器', 'session', 'pause', 'keep'),
    documentPreview: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.documentPreview, 'session', '文件预览', 'session', 'pause', 'pause'),
    changesReview: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.changesReview, 'session', '变更审查', 'session', 'pause', 'pause'),
    plan: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.plan, 'session', '计划', 'session', 'pause', 'pause'),
    scheduleTask: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.scheduleTask, 'session', '计划任务', 'session', 'pause', 'pause'),
    guide: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.guide, 'session', '功能指南', 'session', 'pause', 'pause'),
    subagentChat: declaration(WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.subagentChat, 'session', '子 Agent 对话', 'session', 'pause', 'pause'),
  } as const
  const registrations: Array<() => void> = [
    disposerOf(ctx.slots.inject('workbench.editor.root', () => ctx.slots.register({
      name: 'workbench.editor.root', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.start,
      label: '新建对话', order: 20,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.start } }),
    } as never, editors.start as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
      name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.conversation,
      children: { 'workbench.conversation.native-scope': { kind: 'list', scope: 'session' } },
      label: '对话', order: 20,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.conversation } }),
    } as never, editors.conversation as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
      name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.trajectory,
      children: { 'workbench.trajectory.native-scope': { kind: 'list', scope: 'session' } },
      label: 'Agent 轨迹', order: 30,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.trajectory } }),
    } as never, editors.trajectory as never))),
    disposerOf(ctx.slots.inject('workbench.editor.root', () => ctx.slots.register({
      name: 'workbench.editor.root', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.files,
      label: '项目文件', order: 40,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.files } }),
    } as never, editors.files as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
      name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.terminal,
      label: '终端', order: 50,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.terminal } }),
    } as never, editors.terminal as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
      name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.browser,
      label: '浏览器', order: 60,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.browser } }),
    } as never, editors.browser as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({
      name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.documentPreview,
      label: '文件预览', order: 70,
      inject: () => ({ workbenchEditor: { schemaVersion: 1, resourceOnly: true, declaration: declarations.documentPreview } }),
    } as never, editors.documentPreview as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({ name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.changesReview, label: '变更审查', order: 80, inject: () => ({ workbenchEditor: { schemaVersion: 1, resourceOnly: true, declaration: declarations.changesReview } }) } as never, editors.changesReview as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({ name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.plan, label: '计划', order: 90, inject: () => ({ workbenchEditor: { schemaVersion: 1, resourceOnly: true, declaration: declarations.plan } }) } as never, editors.plan as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({ name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.scheduleTask, label: '计划任务', order: 100, inject: () => ({ workbenchEditor: { schemaVersion: 1, resourceOnly: true, declaration: declarations.scheduleTask } }) } as never, editors.scheduleTask as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({ name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.guide, label: '功能指南', order: 110, inject: () => ({ workbenchEditor: { schemaVersion: 1, declaration: declarations.guide } }) } as never, editors.guide as never))),
    disposerOf(ctx.slots.inject('workbench.editor.session', () => ctx.slots.register({ name: 'workbench.editor.session', id: WORKBENCH_OFFICIAL_AREA_EDITOR_IDS.subagentChat, label: '子 Agent 对话', order: 120, inject: () => ({ workbenchEditor: { schemaVersion: 1, resourceOnly: true, declaration: declarations.subagentChat } }) } as never, editors.subagentChat as never))),
  ]
  return () => {
    for (const dispose of registrations.reverse()) dispose()
  }
}
