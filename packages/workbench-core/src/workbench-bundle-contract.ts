import type { WorkbenchBundleKind, WorkbenchBundleManifestV1 } from './workbench-bundle.ts'

export const WORKBENCH_BUNDLE_ROUTE = '/api/workbench/bundle/v1'
export const WORKBENCH_BUNDLE_MAX_BYTES = 512 * 1024 * 1024

export interface WorkbenchBundleInspectionV1 {
  valid: true
  manifest: WorkbenchBundleManifestV1
  filename: string
  fileCount: number
  bytes: number
  projectFileCount: number
  externalDependencyCount: number
}

export interface WorkbenchBundleImportResultV1 {
  status: 'committed'
  workbenchId: string
  name: string
  kind: WorkbenchBundleKind
  snapshotId: string
  switched: false
}
