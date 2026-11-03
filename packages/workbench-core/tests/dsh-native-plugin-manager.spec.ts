import { describe, expect, it, vi } from 'vitest'
import { createWorkbenchDshNativePluginManagerAdapterV1, type DshNativePluginManagerV1 } from '../src/dsh-native-plugin-manager.ts'

const identity = { moduleId: 'workbench.conversation-suite', version: '0.2.0-rc.1', artifactDigest: 'a'.repeat(64) } as const

function manager() {
  const calls: string[] = []
  let installed = false
  const native: DshNativePluginManagerV1 = {
    listPlugins: vi.fn(async () => []),
    listBundles: vi.fn(async () => installed ? [{ name: '@dsh-workbench/conversation-suite', version: identity.version, installed: true, enabled: true }] : []),
    inspect: vi.fn(async () => ({ status: 'accepted' as const, kind: 'tarball', bundle: true as const, name: '@dsh-workbench/conversation-suite', version: identity.version })),
    installBundle: vi.fn(async () => { calls.push('installBundle'); installed = true; return { changed: true, application: 'restart-required' as const } }),
    cancelInstall: vi.fn(async () => ({ status: 'not-running' as const })),
    setPluginEnabled: vi.fn(async () => ({ changed: true, application: 'applied' as const })),
    setBundleEnabled: vi.fn(async (_name, enabled) => { calls.push(`setBundleEnabled:${String(enabled)}`); return { changed: true, application: 'restart-required' as const } }),
    removeBundle: vi.fn(async () => { calls.push('removeBundle'); installed = false; return { changed: true, application: 'restart-required' as const } }),
  }
  return { native, calls, setInstalled(value: boolean) { installed = value } }
}

function adapter(native: DshNativePluginManagerV1, ownership = new Set<string>()) {
  return createWorkbenchDshNativePluginManagerAdapterV1({
    profile: 'C:\\profiles\\native', packageName: '@dsh-workbench/conversation-suite', moduleId: identity.moduleId,
    native, capabilities: () => [], artifactPath: item => `C:\\profiles\\native\\.dsh-workbench\\${item.artifactDigest}.tgz`,
    isArtifactAvailable: () => true, inspectArtifact: vi.fn(async () => undefined), verify: vi.fn(async () => undefined),
    ownedIdentity: moduleId => ownership.has(moduleId) ? identity : undefined,
    ownership: { has: moduleId => ownership.has(moduleId), add: moduleId => { ownership.add(moduleId) }, remove: moduleId => { ownership.delete(moduleId) } },
  })
}

describe('DSH native PluginManager adapter', () => {
  it('does not activate a disabled native bundle even with a matching ownership receipt', async () => {
    const fixture = manager(), value = adapter(fixture.native, new Set([identity.moduleId]))
    fixture.native.listBundles = vi.fn(async () => [{ name: '@dsh-workbench/conversation-suite', version: identity.version, installed: true, enabled: false }])
    await expect(value.activate(identity.moduleId)).rejects.toThrow('owned-module-not-verified')
    expect(fixture.native.setBundleEnabled).not.toHaveBeenCalled()
    expect(fixture.native.installBundle).not.toHaveBeenCalled()
  })
  it('accepts alpha2 tarball inspection with deferred bundle metadata', async () => {
    const fixture = manager()
    fixture.native.inspect = vi.fn(async () => ({ status: 'accepted', kind: 'tarball', bundle: null }))
    await adapter(fixture.native).install(identity)
    expect(fixture.native.installBundle).toHaveBeenCalledOnce()
  })

  it.each(['failed', 'cancelled', 'overridden'])('does not acquire ownership on %s', async application => {
    const fixture = manager(), owned = new Set<string>()
    fixture.native.installBundle = vi.fn(async () => ({ changed: false, application }))
    await expect(adapter(fixture.native, owned).install(identity)).rejects.toThrow('dsh-native-install-')
    expect(owned.size).toBe(0)
  })

  it('rechecks external collisions before mutating the native Profile', async () => {
    const fixture = manager(), value = adapter(fixture.native)
    await value.refresh()
    fixture.setInstalled(true)
    await expect(value.install(identity)).rejects.toThrow('profile-unowned-module')
    expect(fixture.native.installBundle).not.toHaveBeenCalled()
    expect(fixture.native.removeBundle).not.toHaveBeenCalled()
  })

  it('post-restart activation is read-only and exact repair rejects another digest', async () => {
    const fixture = manager(), owned = new Set([identity.moduleId]), value = adapter(fixture.native, owned)
    fixture.setInstalled(true)
    await value.activate(identity.moduleId)
    expect(fixture.native.setBundleEnabled).not.toHaveBeenCalled()
    await expect(value.repair!({ ...identity, artifactDigest: 'b'.repeat(64) })).rejects.toThrow('profile-identity-conflict')
    expect(fixture.native.installBundle).not.toHaveBeenCalled()
  })

  it('installs and removes through the native manager without a subprocess seam', async () => {
    const fixture = manager(), owned = new Set<string>(), value = adapter(fixture.native, owned)
    await value.refresh()
    expect(value.installed(identity.moduleId)).toBeUndefined()
    await value.install(identity)
    expect(fixture.native.inspect).toHaveBeenCalledWith(expect.stringContaining('.dsh-workbench'))
    expect(fixture.native.installBundle).toHaveBeenCalledWith(expect.stringContaining('.dsh-workbench'), { enabled: true })
    expect(owned.has(identity.moduleId)).toBe(true)
    await value.rollback(identity.moduleId)
    expect(fixture.calls).toEqual(['installBundle', 'removeBundle'])
    expect(owned.has(identity.moduleId)).toBe(false)
  })

  it('claims an exact native package without reinstalling it', async () => {
    const fixture = manager(), owned = new Set<string>(), value = adapter(fixture.native, owned)
    fixture.setInstalled(true)
    await value.refresh()
    await value.claim(identity)
    expect(fixture.native.installBundle).not.toHaveBeenCalled()
    expect(owned.has(identity.moduleId)).toBe(true)
  })

  it('refuses a non-bundle tarball before Profile mutation', async () => {
    const fixture = manager()
    fixture.native.inspect = vi.fn(async () => ({ status: 'accepted' as const, kind: 'tarball', bundle: false as const }))
    const value = adapter(fixture.native)
    await expect(value.install(identity)).rejects.toThrow('dsh-native-spec-not-bundle')
    expect(fixture.native.installBundle).not.toHaveBeenCalled()
  })
})
