import { normalizeWorkbenchEditorSvgIcon } from '../foundation/workbench-editor-icons.ts'
import type { WorkbenchEditorDeclarationV1 } from '../module-contract.ts'
import type { WorkbenchExtensionDeclarationV1 } from '../workbench-extension-access.ts'
import { normalizeWorkbenchEditorIconName, type WorkbenchEditorCatalogRow } from '../foundation/catalog.ts'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'

/** Metadata carried through the inject face, which DSH SlotCore preserves verbatim. */
export interface WorkbenchEditorRegistrationMetadataV1 {
  readonly schemaVersion: 1
  readonly declaration?: WorkbenchEditorDeclarationV1
  readonly extension?: WorkbenchExtensionDeclarationV1
  readonly portability?: WorkbenchEditorCatalogRow['portability']
  readonly distribution?: WorkbenchEditorCatalogRow['distribution']
  readonly resourceOnly?: boolean
  readonly presentation?: { readonly icon?: unknown; readonly iconSvg?: unknown }
}

interface DshSlotEntryLike {
  readonly options: {
    readonly id?: string
    readonly label?: unknown
    readonly order?: number
    readonly resourceOnly?: boolean
    /** Legacy fields are intentionally read only as a compatibility fallback. */
    readonly declaration?: WorkbenchEditorDeclarationV1
    readonly extension?: WorkbenchExtensionDeclarationV1
    readonly presentation?: { readonly icon?: unknown; readonly iconSvg?: unknown }
  }
  readonly registrant?: string | undefined
  readonly inject?: ((...args: never[]) => Record<string, unknown>) | undefined
}

function registrationMetadata(entry: DshSlotEntryLike): WorkbenchEditorRegistrationMetadataV1 | undefined {
  try {
    const injected = entry.inject?.()
    const metadata = injected?.workbenchEditor
    if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
      && (metadata as { schemaVersion?: unknown }).schemaVersion === 1) {
      return metadata as WorkbenchEditorRegistrationMetadataV1
    }
  } catch {
    // A broken extension declaration must not prevent Core from listing other
    // editors. The access resolver will report this editor as unverified.
  }
  if (entry.options.declaration !== undefined || entry.options.extension !== undefined) {
    return {
      schemaVersion: 1,
      ...(entry.options.declaration === undefined ? {} : { declaration: entry.options.declaration }),
      ...(entry.options.extension === undefined ? {} : { extension: entry.options.extension }),
      ...(entry.options.presentation === undefined ? {} : { presentation: entry.options.presentation }),
    }
  }
  return undefined
}

/**
 * Project one DSH Slot record into Workbench's catalog. DSH intentionally
 * stores a fixed set of option fields, so extension contracts travel in the
 * Slot's preserved inject face rather than arbitrary registration options.
 */
export function workbenchEditorCatalogRowFromSlotEntry(
  entry: DshSlotEntryLike,
  scope: 'root' | 'session',
): WorkbenchEditorCatalogRow & { order: number } {
  const metadata = registrationMetadata(entry)
  const label = resolveSlotLabel(entry.options.label as string | (() => string) | undefined) ?? entry.options.id ?? ''
  const icon = normalizeWorkbenchEditorIconName(metadata?.presentation?.icon)
  const iconSvg = normalizeWorkbenchEditorSvgIcon(metadata?.presentation?.iconSvg)
  return {
    id: entry.options.id ?? '',
    label,
    scope,
    ...(entry.options.resourceOnly === true ? { resourceOnly: true } : {}),
    ...(metadata?.resourceOnly === true ? { resourceOnly: true } : {}),
    ...(entry.registrant === undefined ? {} : { pluginId: entry.registrant }),
    ...(metadata?.declaration === undefined ? {} : { declaration: metadata.declaration }),
    ...(metadata?.extension === undefined ? {} : { extension: metadata.extension }),
    ...(metadata?.portability?.version !== 1 ? {} : { portability: metadata.portability }),
    ...(metadata?.distribution?.version !== 1 ? {} : { distribution: metadata.distribution }),
    ...(icon === undefined ? {} : { icon }),
    ...(iconSvg === undefined ? {} : { iconSvg }),
    order: entry.options.order ?? 0,
  }
}
