/**
 * Generate an identifier for browser-local UI state and request correlation.
 *
 * `crypto.randomUUID()` is unavailable in some non-secure LAN HTTP contexts.
 * Prefer it when present, then use Web Crypto random bytes, and finally a
 * deliberately non-credential fallback so an old browser can still render
 * the workbench. Host-issued access tokens and other credentials continue to
 * use Node's cryptographic APIs and never call this helper.
 */
type BrowserCrypto = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>

export function browserSafeUuid(source: BrowserCrypto | undefined = typeof globalThis.crypto === 'object' ? globalThis.crypto : undefined): string {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  const format = (bytes: Uint8Array): string => {
    bytes[6] = (bytes[6]! & 0x0f) | 0x40
    bytes[8] = (bytes[8]! & 0x3f) | 0x80
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }
  if (typeof source?.getRandomValues === 'function') {
    return format(source.getRandomValues(new Uint8Array(16)))
  }
  // This branch is only for non-secret browser-local identities. It keeps the
  // UI usable in very old WebViews while making the weaker source explicit.
  return format(Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)))
}

export function browserSafeId(prefix: string): string {
  return `${prefix}-${browserSafeUuid()}`
}
