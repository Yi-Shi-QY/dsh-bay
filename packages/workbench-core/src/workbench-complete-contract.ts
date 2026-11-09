export const WORKBENCH_COMPLETE_ROUTE = '/api/workbench/complete/v5'
export const WORKBENCH_COMPLETE_UPLOAD_ROUTE = WORKBENCH_COMPLETE_ROUTE + '/upload'
export const WORKBENCH_COMPLETE_DOWNLOAD_ROUTE = WORKBENCH_COMPLETE_ROUTE + '/download'
export const WORKBENCH_COMPLETE_CHUNK_BYTES = 8 * 1024 * 1024
export interface CompletePackageReport {
  data: 'pending' | 'complete' | 'blocked'
  environment: 'unchecked' | 'needs-setup' | 'ready'
  tasks: 'waiting-for-user' | 'unchanged'
  blockers: string[]
  exclusions: string[]
  environmentSteps: string[]
}
export interface CompletePackageJob {
  version: 5
  id: string
  kind: 'export' | 'import'
  requestId: string
  /** Access is checked against the source workbench even when importing a new identity. */
  accessWorkbenchId?: string
  ownerAccessId?: string
  inputDigest?: string
  uploadId?: string
  workbenchId: string
  path: string
  parentPath?: string
  folderName?: string
  /** Durable import staging directory. Kept until the job reaches complete. */
  stageDir?: string
  /** Durable destination path. The path is stable while native cwd values are rebuilt. */
  targetPath?: string
  /** Persisted source-to-local native Session identity map. */
  sessionMap?: Readonly<Record<string, string>>
  /** Digest of the archive and extracted manifest used to resume safely. */
  archiveSha256?: string
  manifestSha256?: string
  sourceRoot?: string
  stage: 'queued' | 'preflight' | 'snapshot' | 'files' | 'sessions' | 'relations' | 'publish' | 'complete' | 'cancelled' | 'failed'
  files: number
  bytes: number
  updatedAt: number
  error?: string
  report: CompletePackageReport
}

/** Public job projection: never exposes Host paths, tokens or native Session maps. */
export type CompletePackageJobView = Pick<CompletePackageJob, 'version' | 'id' | 'kind' | 'requestId' | 'workbenchId' | 'stage' | 'files' | 'bytes' | 'updatedAt' | 'error' | 'report'> & {
  running: boolean
  recoverable: boolean
}

export interface CompletePackageUpload {
  id: string
  requestId: string
  workbenchId: string
  name: string
  size: number
  received: number
  state: 'uploading' | 'ready' | 'cancelled'
  updatedAt: number
}

export interface CompletePackageDirectoryRequest {
  id: string
  uploadId: string
  workbenchId: string
  state: 'pending' | 'selected' | 'cancelled' | 'consumed'
  updatedAt: number
}

export interface CompletePackagePreflight {
  valid: true
  workbenchId: string
  sessionCount: number
  manifestSha256: string
}
