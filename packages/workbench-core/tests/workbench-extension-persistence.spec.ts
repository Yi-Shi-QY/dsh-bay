import { describe, expect, it } from 'vitest'
import { decodeWorkbenchExtensionConsents } from '../src/foundation/persistence.ts'

const consent = {
  packageName: '@example/pet', moduleId: 'example.pet', apiVersion: 1,
  contractFingerprint: '0123456789abcdef0123456789abcdef', allowedAt: 10,
}

describe('Workbench extension consent persistence', () => {
  it('upgrades older consent rows without editor IDs or an allowed flag', () => {
    expect(decodeWorkbenchExtensionConsents({ '@example/pet::example.pet': consent }))
      .toEqual({ '@example/pet::example.pet': { ...consent, editorIds: [], allowed: true } })
  })

  it('preserves revoked status and validates the new allowed flag', () => {
    expect(decodeWorkbenchExtensionConsents({ '@example/pet::example.pet': {
      ...consent, editorIds: ['example.pet.page'], allowed: false,
    } })?.['@example/pet::example.pet']).toMatchObject({ editorIds: ['example.pet.page'], allowed: false })
    expect(decodeWorkbenchExtensionConsents({ '@example/pet::example.pet': {
      ...consent, editorIds: ['example.pet.page'], allowed: 'false',
    } })).toBeUndefined()
  })
})
