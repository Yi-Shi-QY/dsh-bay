import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkbenchCoreProfileArtifactStager,
  installWorkbenchCoreProfileServices,
} from '../src/host-profile-services.ts'

const roots: string[] = []
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const integrity = (bytes: Uint8Array) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })

describe('Core Profile artifact stager', () => {
  it('keeps one immutable identity and rejects altered or conflicting artifacts', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'dsh-workbench-profile-'))
    roots.push(profile)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const stager = createWorkbenchCoreProfileArtifactStager(profile)
    const input = {
      moduleId: 'workbench.conversation-suite' as const,
      version: '0.1.5-alpha.2', artifactDigest: digest(bytes), packageName: '@dsh-workbench/conversation-suite' as const,
      integrity: integrity(bytes), tarball: bytes,
    }

    await stager.stage(input)
    await stager.stage(input)
    expect(stager.artifact(input)).toEqual(bytes)

    const references = JSON.parse(await readFile(join(profile, '.dsh-workbench', 'module-artifacts-v1', 'references.json'), 'utf8'))
    expect(references).toEqual([{
      moduleId: input.moduleId, packageName: input.packageName, version: input.version,
      artifactDigest: input.artifactDigest, integrity: input.integrity,
      size: bytes.byteLength, file: `${input.artifactDigest}.tgz`,
    }])

    const artifactFile = join(profile, '.dsh-workbench', 'module-artifacts-v1', 'blobs', `${input.artifactDigest}.tgz`)
    await writeFile(artifactFile, new Uint8Array([9, 9, 9, 9]))
    expect(stager.artifact(input)).toBeUndefined()

    const other = new Uint8Array([5, 6, 7, 8])
    await expect(stager.stage({ ...input, version: '0.1.1-rc.3', artifactDigest: digest(other), integrity: integrity(other), tarball: other })).rejects.toThrow('identity conflict')
    expect(new Uint8Array(await readFile(artifactFile))).toEqual(new Uint8Array([9, 9, 9, 9]))
    await stager.stage(input)
    expect(stager.artifact(input)).toEqual(bytes)
  })
})

describe('native Profile service wiring', () => {
  it('requires the native manager even when a legacy subprocess service exists', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'dsh-native-absent-')); roots.push(profile)
    await writeFile(join(profile, 'package.json'), '{"name":"profile"}')
    const spawn = vi.fn()
    const services = new Map<string, unknown>([['profileContext', { dir: profile }], ['subprocess', { spawn }]])
    const ctx = {
      get<T = unknown>(name: string): T | undefined { return services.get(name) as T | undefined },
      provide: vi.fn(),
    }
    expect(installWorkbenchCoreProfileServices(ctx)).toBe(false)
    expect(ctx.provide).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe('{"name":"profile"}')
  })

  it('reads native inventory without changing Profile files or claiming an external bundle', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'dsh-native-services-')); roots.push(profile)
    const original = '{"name":"profile","dependencies":{"external":"1.0.0"}}'
    await writeFile(join(profile, 'package.json'), original)
    const mutate = vi.fn()
    const native = {
      listPlugins: vi.fn(async () => []),
      listBundles: vi.fn(async () => [{ name: '@dsh-workbench/conversation-suite', version: '0.2.0-alpha.1', installed: true, enabled: true }]),
      inspect: mutate, installBundle: mutate, cancelInstall: mutate,
      setPluginEnabled: mutate, setBundleEnabled: mutate, removeBundle: mutate,
    }
    const services = new Map<string, unknown>([['profileContext', { dir: profile }], ['pluginManager', native]])
    const ctx = {
      get<T = unknown>(name: string): T | undefined { return services.get(name) as T | undefined },
      provide(name: string, value: unknown) { services.set(name, value); return value },
    }
    expect(installWorkbenchCoreProfileServices(ctx)).toBe(true)
    await services.get('workbenchModuleStartupReady')
    const center = services.get('workbenchHostModuleCenter') as { facts(): Promise<unknown> }
    expect(await center.facts()).toMatchObject({ inventory: [{ kind: 'official-builtin', nativeRuntime: 'enabled', profilePresence: 'present', ownership: 'unowned', activation: 'absent', allowedActions: ['open-details'] }] })
    expect(mutate).not.toHaveBeenCalled()
    expect(await readFile(join(profile, 'package.json'), 'utf8')).toBe(original)
    expect(services.get('workbenchProfilePackageManager')).toBe('dsh-native-plugin-manager')
  })

  it('projects a missing legacy Suite as read-only Core-owned capability, never an install target', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'dsh-native-builtin-missing-')); roots.push(profile)
    await writeFile(join(profile, 'package.json'), '{"name":"profile"}')
    const native = {
      listPlugins: vi.fn(async () => []),
      listBundles: vi.fn(async () => []),
      inspect: vi.fn(), installBundle: vi.fn(), cancelInstall: vi.fn(),
      setPluginEnabled: vi.fn(), setBundleEnabled: vi.fn(), removeBundle: vi.fn(),
    }
    const services = new Map<string, unknown>([['profileContext', { dir: profile }], ['pluginManager', native]])
    const ctx = {
      get<T = unknown>(name: string): T | undefined { return services.get(name) as T | undefined },
      provide(name: string, value: unknown) { services.set(name, value); return value },
    }
    expect(installWorkbenchCoreProfileServices(ctx)).toBe(true)
    await services.get('workbenchModuleStartupReady')
    const center = services.get('workbenchHostModuleCenter') as { facts(): Promise<unknown> }
    expect(await center.facts()).toMatchObject({ inventory: [{ kind: 'official-builtin', delivery: 'official-component', profilePresence: 'absent', allowedActions: ['open-details'] }] })
    expect(native.installBundle).not.toHaveBeenCalled()
  })
})
