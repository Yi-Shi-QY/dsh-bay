import type { WorkbenchBundleKind, WorkbenchBundleManifestV1 } from './workbench-bundle.ts'

export const WORKBENCH_BUNDLE_ROUTE = '/api/workbench/bundle/v1'
export const WORKBENCH_BUNDLE_MAX_BYTES = 512 * 1024 * 1024
/** ZIP stores entry counts in 16 bits, so this is the format's own ceiling. */
export const WORKBENCH_BUNDLE_MAX_ENTRIES = 65_535
export const WORKBENCH_BUNDLE_MAX_FILE_BYTES = 256 * 1024 * 1024

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

export interface WorkbenchBundleNoticeV1 { sessionKey: string; reason: string }

/** An inner-page extension that cannot travel in a package until it is repaired. */
export interface WorkbenchBundleExtensionProblemV1 {
  packageName?: string
  moduleId: string
  version?: string
  editorIds: readonly string[]
  reason: string
}

export interface WorkbenchBundleExportCheckV1 { problems: readonly WorkbenchBundleExtensionProblemV1[] }

/** Ordered Host stages of a bundle job. `total` is 0 while a stage's size is unknown. */
export type WorkbenchBundleExportStage = 'collect' | 'extensions' | 'sessions' | 'files' | 'pack' | 'write'
export type WorkbenchBundleImportStage = 'verify' | 'files' | 'sessions' | 'register' | 'extensions'

export interface WorkbenchBundleProgressV1<Stage extends string = string> {
  stage: Stage
  done: number
  total: number
}

export interface WorkbenchBundleExportedV1 {
  /** Absolute path of the written package on the Host. */
  path: string
  filename: string
  bytes: number
  notices: readonly WorkbenchBundleNoticeV1[]
}

export type WorkbenchBundleJobV1 =
  | { jobId: string; operation: 'export'; state: 'running'; progress: WorkbenchBundleProgressV1<WorkbenchBundleExportStage> }
  | { jobId: string; operation: 'export'; state: 'done'; progress: WorkbenchBundleProgressV1<WorkbenchBundleExportStage>; result: WorkbenchBundleExportedV1 }
  | { jobId: string; operation: 'import'; state: 'running'; progress: WorkbenchBundleProgressV1<WorkbenchBundleImportStage> }
  | { jobId: string; operation: 'import'; state: 'done'; progress: WorkbenchBundleProgressV1<WorkbenchBundleImportStage>; result: WorkbenchBundleImportResultV1 }
  | { jobId: string; operation: 'export' | 'import'; state: 'failed'; progress: WorkbenchBundleProgressV1; error: string }
