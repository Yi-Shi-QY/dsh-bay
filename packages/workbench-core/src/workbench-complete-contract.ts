/** The transport URL remains stable so an existing V5 upload can resume. */
export const WORKBENCH_COMPLETE_ROUTE = '/api/workbench/complete/v5'
export const WORKBENCH_COMPLETE_FORMAT = 6
export type CompletePlatform = 'win32' | 'darwin' | 'linux'
export const COMPLETE_PLATFORMS: readonly CompletePlatform[] = ['win32', 'darwin', 'linux']
export interface CompleteMigrationDeclaration {
  events: { type: string; schemaVersion: number }[]
  workbenchData: { key: string; schemaVersion: number }[]
}
export interface CompleteExtensionLock {
  packageName: string
  moduleId: string
  version: string
  artifactSha256: string
  permissions: string[]
  editorIds: string[]
  exportPolicy: 'embed' | 'reference' | 'forbid'
  platforms: CompletePlatform[]
  migrations: CompleteMigrationDeclaration
  artifactPath?: string
  /** Existing DSH distribution identity, validated before native installation. */
  distribution?: import('./foundation/workbench-package-v4.ts').WorkbenchPackageDependencyV4
}
export interface CompleteExtensionCheck {
  extension: CompleteExtensionLock
  state: 'ready' | 'install' | 'restart' | 'conflict' | 'manual' | 'migration-missing'
  message?: string
}
export interface CompletePageState {
  moduleInstanceId: string
  editorId: string
  state: import('./foundation/model.ts').JsonValue
}
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
  version: 5 | 6
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
  name?: string
  replacementDirectoryId?: string
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
  targetPlatform?: CompletePlatform
  packageVersion?: 5 | 6
  extensions?: CompleteExtensionCheck[]
  extensionConsentDigest?: string
  extensionPlanDigest?: string
  restartRequiredFromBoot?: string
  restartTransactionId?: string
  /** Installer receipt is durable before any mutation; resumed by the same job. */
  extensionInstallStarted?: boolean
  workspaceMap?: Record<string, string>
  filesPrepared?: boolean
  exportPageStates?: CompletePageState[]
  exportDefinitionRevision?: number
  pageStatesRestored?: boolean
  /** All validation completed; publication may have committed before the last job write. */
  publicationReady?: boolean
  overview?: CompletePackagePreflight['overview']
  stage: 'queued' | 'preflight' | 'snapshot' | 'files' | 'awaiting-extensions' | 'installing-extensions' | 'awaiting-restart' | 'sessions' | 'extension-data' | 'awaiting-page-state' | 'relations' | 'verifying' | 'publish' | 'complete' | 'blocked' | 'cancelled' | 'failed'
  files: number
  bytes: number
  updatedAt: number
  error?: string
  report: CompletePackageReport
}

/** Public job projection: destination display only; no archive paths, tokens or native Session maps. */
export type CompletePackageJobView = Pick<CompletePackageJob, 'version' | 'id' | 'kind' | 'requestId' | 'workbenchId' | 'stage' | 'files' | 'bytes' | 'updatedAt' | 'error' | 'report'> & {
  running: boolean
  recoverable: boolean
  name?: string
  targetDisplayPath?: string
  canChangeDestination?: boolean
  targetPlatform?: CompletePlatform
  packageVersion?: 5 | 6
  extensions?: CompleteExtensionCheck[]
  extensionPlanDigest?: string
  restartTransactionId?: string
  overview?: CompletePackagePreflight['overview']
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
  /** Display only; operations use the Host-held directory permission. */
  displayPath?: string
  jobId?: string
}

export interface CompletePackagePreflight {
  valid: true
  workbenchId: string
  sessionCount: number
  manifestSha256: string
  packageVersion?: 5 | 6
  sourcePlatform?: CompletePlatform
  targetPlatform?: CompletePlatform
  recipientPlatform?: CompletePlatform
  warnings?: string[]
  extensions?: CompleteExtensionCheck[]
  overview?: {
    name: string
    description: string
    layout: import('./foundation/document-v3.ts').WorkbenchNodeV3
    projectCount: number
    areaCount: number
    pageCount: number
    fileCount: number
    bytes: number
    memoryCount: number
    taskCount: number
  }
}
