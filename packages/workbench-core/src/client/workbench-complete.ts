import { WORKBENCH_COMPLETE_ROUTE, WORKBENCH_COMPLETE_UPLOAD_ROUTE, WORKBENCH_COMPLETE_CHUNK_BYTES, type CompletePackageUpload, type CompletePackagePreflight } from '../workbench-complete-contract.ts'
import { workbenchFetch } from './workbench-access.ts'

export function createWorkbenchCompleteClient(fetcher: typeof fetch = workbenchFetch) {
  const request = async <T = unknown>(input: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
      const response = await fetcher(WORKBENCH_COMPLETE_ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), ...(signal ? { signal } : {}) })
      const result = await response.json() as { value?: T; error?: string }
      if (!response.ok || result.value === undefined) throw new Error(result.error ?? '完整工作台包服务不可用。')
      return result.value
  }
  return {
    request,
    /** Blob slices keep request memory bounded and work without duplex streaming support. */
    async upload(file: File, input: { workbenchId: string; requestId: string }, onProgress?: (upload: CompletePackageUpload) => void, signal?: AbortSignal) {
      let upload = await request<CompletePackageUpload>({ action: 'upload-begin', ...input, name: file.name, size: file.size }, signal)
      if (upload.state === 'cancelled') throw new Error('此上传已取消，请重新选择完整包。')
      onProgress?.(upload)
      while (upload.received < file.size) {
        signal?.throwIfAborted()
        const offset = upload.received, length = Math.min(WORKBENCH_COMPLETE_CHUNK_BYTES, file.size - offset)
        const response = await fetcher(WORKBENCH_COMPLETE_UPLOAD_ROUTE + '?id=' + encodeURIComponent(upload.id), {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-bay-upload-offset': String(offset), 'x-bay-upload-length': String(length), 'x-bay-request-id': 'chunk-' + offset },
          body: file.slice(offset, offset + length), ...(signal ? { signal } : {}),
        })
        const result = await response.json() as { value?: CompletePackageUpload; error?: string }
        if (!response.ok || !result.value) throw new Error(result.error ?? '上传中断，可重新选择同一文件继续。')
        upload = result.value
        onProgress?.(upload)
      }
      const preflight = await request<CompletePackagePreflight>({ action: 'upload-finish', id: upload.id }, signal)
      return { upload: { ...upload, state: 'ready' as const }, preflight }
    },
    async download(id: string) {
      const result = await request<{ url: string }>({ action: 'download-ticket', id })
      const anchor = document.createElement('a')
      anchor.href = result.url; anchor.rel = 'noreferrer'; anchor.download = ''
      document.body.append(anchor); anchor.click(); anchor.remove()
    },
  }
}
