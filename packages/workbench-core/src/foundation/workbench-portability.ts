import type {
  SlotPortableValue,
  SlotPortabilityContextV1,
} from './workbench-slot-contracts.ts'
import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { JsonValue, SessionBindingV1 } from './model.ts'
import { workbenchEditorStateFailureV1 } from '../workbench-editor-state.ts'

export type WorkbenchPortableStateStatus =
  | 'not-provided'
  | 'not-restored'
  | 'restored'
  | 'raw'
  | 'failed'

export interface WorkbenchPortableStateRestoreResult {
  state: JsonValue
  status: WorkbenchPortableStateStatus
  warning?: string
}

/**
 * Rehydrate one descriptor-declared share projection into local module state.
 * The caller owns Session creation; this function only transforms JSON and
 * never mutates Settings, the Slot registry, or the target binding.
 */
export function restoreWorkbenchPortableState(
  editor: WorkbenchEditorCatalogRow | undefined,
  input: JsonValue | null | undefined,
  context: {
    editorId: string
    editorScope: 'root' | 'session'
    moduleInstanceId: string
    title: string
    target?: SessionBindingV1
  },
): WorkbenchPortableStateRestoreResult {
  if (input === null || input === undefined) return { state: {}, status: 'not-provided' }
  const declaration = editor?.declaration
  if (editor?.extension !== undefined && declaration !== undefined) {
    if (declaration.state.restore === 'never'
      || declaration.state.share === 'forbidden'
      || declaration.state.share === 'reference-only') {
      return { state: {}, status: 'not-restored' }
    }
    const inputFailure = workbenchEditorStateFailureV1(input, declaration)
    if (inputFailure !== undefined) {
      return { state: {}, status: 'failed', warning: `${context.editorId}: 分享状态不符合内页限制，已忽略。` }
    }
    if (declaration.state.restore === 'if-valid'
      && (input === null || typeof input !== 'object' || Array.isArray(input)
        || !('schemaVersion' in input) || input.schemaVersion !== declaration.state.schemaVersion)) {
      return { state: {}, status: 'failed', warning: `${context.editorId}: 分享状态版本不匹配，已忽略。` }
    }
  }
  const descriptor = editor?.portability
  if (descriptor === undefined || descriptor.version !== 1 || descriptor.importState === undefined) {
    return { state: structuredClone(input), status: 'raw' }
  }
  const descriptorContext: SlotPortabilityContextV1 = {
    version: 1,
    editor: {
      id: context.editorId,
      scope: context.editorScope,
      moduleInstanceId: context.moduleInstanceId,
      title: context.title,
    },
    ...(context.target === undefined ? {} : {
      target: {
        ...(context.target.workspaceId === undefined ? {} : { workspaceId: context.target.workspaceId }),
        sessionId: context.target.sessionId,
      },
    }),
  }
  try {
    const restored = descriptor.importState(input as SlotPortableValue, descriptorContext)
    if (restored === undefined) throw new Error('descriptor returned no JSON state')
    const outputFailure = workbenchEditorStateFailureV1(restored, declaration)
    if (outputFailure !== undefined) throw new Error(outputFailure)
    return { state: structuredClone(restored) as JsonValue, status: 'restored' }
  } catch (error) {
    return {
      state: {},
      status: 'failed',
      warning: `${context.editorId}: 分享状态恢复失败（${error instanceof Error ? error.message : String(error)}）`,
    }
  }
}
