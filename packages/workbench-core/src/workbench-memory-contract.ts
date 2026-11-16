export type MemoryVerification = 'candidate' | 'verified' | 'needs-revalidation'
export interface MemorySource {
  kind: 'user' | 'task' | 'session' | 'file'
  reference: string
  description: string
}
export interface WorkbenchMemoryEntry {
  id: string
  revision: number
  title: string
  summary: string
  areaId?: string
  projectId?: string
  verification: MemoryVerification
  environmentDependent: boolean
  source: MemorySource
  updatedAt: number
  author: 'human' | 'bay-agent' | 'worker'
  removed: boolean
  sha256: string
}
export interface WorkbenchMemoryIndex {
  version: 1
  revision: number
  entries: Record<string, WorkbenchMemoryEntry>
  requests: Record<string, { fingerprint: string; id: string; revision: number }>
}
export interface WorkbenchMemoryWrite {
  projectId?: string
  requestId: string
  id: string
  expectedRevision: number
  title: string
  summary: string
  body: string
  source: MemorySource
  verification: MemoryVerification
  environmentDependent: boolean
  areaId?: string
  removed?: boolean
}
