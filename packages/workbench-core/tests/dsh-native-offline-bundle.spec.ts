import { describe, expect, it, vi } from 'vitest'
import {
  createWorkbenchDshNativeOfflineBundleAdapterV1,
  createWorkbenchDshNativeOfflineBundleBridgeV1,
  MAX_NATIVE_OFFLINE_BUNDLE_BYTES,
} from '../src/dsh-native-offline-bundle.ts'

const uuid = '11111111-1111-4111-8111-111111111111'
const preview = {
  schemaVersion: 1 as const,
  bundleId: uuid,
  name: 'Workbench Demo',
  version: '0.1.6-alpha.2',
  archiveSha256: 'a'.repeat(64),
  archiveSize: 4,
}

describe('DSH native Portable Bundle bridge', () => {
  it('fails closed when the Manager service is absent or incomplete', () => {
    expect(createWorkbenchDshNativeOfflineBundleAdapterV1(undefined)).toEqual({ status: 'unsupported', reason: 'manager-bridge-unavailable' })
    expect(createWorkbenchDshNativeOfflineBundleAdapterV1({ exportPortableBundle: vi.fn() })).toEqual({ status: 'unsupported', reason: 'manager-bridge-unavailable' })
  })

  it('only advertises the browser bridge when the Manager capability marker is present', () => {
    const previous = globalThis.document
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => null } })
    try { expect(createWorkbenchDshNativeOfflineBundleBridgeV1(vi.fn() as typeof fetch)).toBeUndefined() }
    finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }) }
  })

  it('validates operation and preview responses before exposing them to the client', async () => {
    const previous = globalThis.document
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { querySelector: () => ({ getAttribute: () => 'v1' }) } })
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/inspect')) return new Response(JSON.stringify(preview), { status: 200 })
      if (url.endsWith('/status?operationId=' + uuid)) return new Response(JSON.stringify({ schemaVersion: 1, operationId: uuid, phase: 'ready' }), { status: 200 })
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })
    })
    try {
      const bridge = createWorkbenchDshNativeOfflineBundleBridgeV1(fetcher as typeof fetch)
      expect(bridge).toBeDefined()
      await expect(bridge!.inspectPortableBundle(new Uint8Array([1]))).resolves.toMatchObject({ bundleId: uuid })
      await expect(bridge!.getPortableBundleStatus(uuid)).resolves.toMatchObject({ phase: 'ready' })
      await expect(bridge!.getPortableBundleStatus('invalid')).rejects.toThrow('操作标识无效')
      expect(MAX_NATIVE_OFFLINE_BUNDLE_BYTES).toBeGreaterThan(64 * 1024 * 1024)
    } finally { Object.defineProperty(globalThis, 'document', { configurable: true, value: previous }) }
  })
})
