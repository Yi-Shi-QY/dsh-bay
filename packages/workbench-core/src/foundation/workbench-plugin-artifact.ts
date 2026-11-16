import type { WorkbenchEditorCatalogRow } from './catalog.ts'
import type { WorkbenchPackageFileV1, WorkbenchPackagePluginV1 } from './workbench-sharing.ts'

export interface WorkbenchPluginArtifactValidationIssueV1 {
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface WorkbenchPluginArtifactValidationResultV1 {
  valid: boolean
  issues: readonly WorkbenchPluginArtifactValidationIssueV1[]
}

export interface WorkbenchPluginArtifactRegistrationV1 {
  packageId: string
  version: string
  editorIds: readonly string[]
  entries: readonly WorkbenchEditorCatalogRow[]
  sourcePolicy: WorkbenchPackagePluginV1['sourcePolicy']
}

export interface WorkbenchPluginArtifactInstallerV1 {
  stage(plugin: WorkbenchPackagePluginV1, files: readonly WorkbenchPackageFileV1[]): Promise<void>
  register(plugin: WorkbenchPackagePluginV1, files: readonly WorkbenchPackageFileV1[]): Promise<WorkbenchPluginArtifactRegistrationV1>
  rollback(plugin: WorkbenchPackagePluginV1): Promise<void>
}

function safePluginId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._/-]{0,199}$/iu.test(value)
}

/** Validate a compiled client artifact without loading or evaluating it. */
export function validateWorkbenchPluginArtifact(
  plugin: WorkbenchPackagePluginV1,
  files: readonly WorkbenchPackageFileV1[],
): WorkbenchPluginArtifactValidationResultV1 {
  const issues: WorkbenchPluginArtifactValidationIssueV1[] = []
  if (!safePluginId(plugin.packageId)) issues.push({ severity: 'error', code: 'plugin-id-invalid', message: '插件 packageId 无效。' })
  if (plugin.editorIds.length === 0) issues.push({ severity: 'error', code: 'editor-ids-empty', message: '插件必须声明至少一个 editorId。' })
  if (new Set(plugin.editorIds).size !== plugin.editorIds.length) issues.push({ severity: 'error', code: 'editor-ids-duplicate', message: '插件 editorId 重复。' })
  if (plugin.scopes.length === 0) issues.push({ severity: 'error', code: 'scopes-empty', message: '插件必须声明 root 或 session scope。' })
  if (plugin.manifestPath.endsWith('/') || !files.some(file => file.path === plugin.manifestPath)) issues.push({ severity: 'error', code: 'manifest-missing', message: '插件 manifest 文件缺失。' })
  if (plugin.clientEntry !== undefined && !files.some(file => file.path === plugin.clientEntry)) issues.push({ severity: 'error', code: 'client-entry-missing', message: '插件 client bundle 缺失。' })
  if (plugin.hostEntry !== undefined && !files.some(file => file.path === plugin.hostEntry)) issues.push({ severity: 'error', code: 'host-entry-missing', message: '插件 Host bundle 缺失。' })
  if (plugin.sourcePolicy === 'binary-only' && plugin.clientEntry === undefined && plugin.hostEntry === undefined) issues.push({ severity: 'error', code: 'binary-entry-missing', message: 'binary-only 插件必须提供 client 或 Host entry。' })
  if (plugin.sourcePolicy === 'remote' && plugin.permissions.every(permission => permission !== 'network')) issues.push({ severity: 'warning', code: 'remote-without-network', message: '远程插件未声明 network 权限。' })
  return { valid: issues.every(issue => issue.severity !== 'error'), issues }
}

/**
 * Install a plugin through an explicit stage/register/rollback seam. The
 * default caller can require user permission before invoking this helper; this
 * function never evaluates client.js itself.
 */
export async function installWorkbenchPluginArtifact(
  plugin: WorkbenchPackagePluginV1,
  files: readonly WorkbenchPackageFileV1[],
  installer: WorkbenchPluginArtifactInstallerV1,
): Promise<WorkbenchPluginArtifactRegistrationV1> {
  const validation = validateWorkbenchPluginArtifact(plugin, files)
  if (!validation.valid) throw new Error(`invalid plugin artifact: ${validation.issues.map(issue => issue.code).join(', ')}`)
  await installer.stage(plugin, files)
  try {
    return await installer.register(plugin, files)
  } catch (error) {
    await installer.rollback(plugin).catch(() => undefined)
    throw error
  }
}
