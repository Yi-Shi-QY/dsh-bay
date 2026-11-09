import { describe, expect, it } from 'vitest'
import { browserSafeId, browserSafeUuid } from '../src/browser-safe-id.ts'

describe('browser-safe identifiers', () => {
  it('prefers the browser UUID implementation when available', () => {
    expect(browserSafeUuid({ randomUUID: () => 'native-id', getRandomValues: value => value } as never)).toBe('native-id')
  })

  it('uses Web Crypto bytes when randomUUID is unavailable', () => {
    const id = browserSafeUuid({ getRandomValues: (value: Uint8Array) => { value.fill(0); return value } } as never)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u)
  })

  it('keeps old HTTP WebViews usable with a local fallback', () => {
    expect(browserSafeId('request')).toMatch(/^request-/u)
    expect(browserSafeUuid(undefined)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
  })
})
