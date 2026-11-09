import { expect, it, vi } from 'vitest'
import { createWorkbenchCompleteClient } from '../src/client/workbench-complete.ts'
import { WORKBENCH_COMPLETE_ROUTE, WORKBENCH_COMPLETE_CHUNK_BYTES, type CompletePackageUpload } from '../src/workbench-complete-contract.ts'

it('uploads only bounded File slices, starting at the Host-confirmed offset', async () => {
  const size = WORKBENCH_COMPLETE_CHUNK_BYTES * 2 + 17
  const file = new File([new Uint8Array(size)], 'complete.tar.gz')
  const wholeFileRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('The whole file must not be buffered'))
  const upload: CompletePackageUpload = { id: 'upload-id', requestId: 'upload-request', workbenchId: 'wb', name: file.name, size, received: WORKBENCH_COMPLETE_CHUNK_BYTES, state: 'uploading', updatedAt: 1 }
  const chunks: { offset: number; bytes: number }[] = []
  const fetcher: typeof fetch = async (url, options) => {
    if (url === WORKBENCH_COMPLETE_ROUTE) {
      const body = JSON.parse(options?.body as string)
      return Response.json({ value: body.action === 'upload-begin' ? upload : { valid: true, workbenchId: 'source', sessionCount: 3, manifestSha256: 'digest' } })
    }
    const headers = new Headers(options?.headers), body = options?.body as Blob
    chunks.push({ offset: Number(headers.get('x-bay-upload-offset')), bytes: body.size })
    upload.received += body.size
    return Response.json({ value: upload })
  }
  const result = await createWorkbenchCompleteClient(fetcher).upload(file, { workbenchId: 'wb', requestId: 'upload-request' })
  expect(chunks).toEqual([{ offset: WORKBENCH_COMPLETE_CHUNK_BYTES, bytes: WORKBENCH_COMPLETE_CHUNK_BYTES }, { offset: WORKBENCH_COMPLETE_CHUNK_BYTES * 2, bytes: 17 }])
  expect(wholeFileRead).not.toHaveBeenCalled()
  expect(result.upload.state).toBe('ready')
  expect(result.preflight.sessionCount).toBe(3)
})
