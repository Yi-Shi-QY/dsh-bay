import { editorStateFailure } from './foundation/model.ts'
import type { WorkbenchEditorDeclarationV1 } from './module-contract.ts'

/** Enforce an editor's declared byte budget at every Core state boundary. */
export function workbenchEditorStateFailureV1(
  value: unknown,
  declaration?: Pick<WorkbenchEditorDeclarationV1, 'state'>,
): string | undefined {
  return editorStateFailure(value, declaration?.state.maxBytes)
}
