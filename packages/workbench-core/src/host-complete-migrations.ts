import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { NativeEventRemapper, NativeSessionRemap } from './host-native-session-portability.ts'
import type { CompleteExtensionLock, CompleteMigrationDeclaration } from './workbench-complete-contract.ts'

export const WORKBENCH_COMPLETE_MIGRATIONS = 'workbenchCompleteMigrations'
export interface CompleteMigrationProvider {
  packageName: string
  moduleId: string
  artifactSha256: string
  events: { type: string; schemaVersion: number; remap: NativeEventRemapper }[]
  workbenchData: {
    key: string; schemaVersion: number
    export(input: { workbenchId: string; root: string }): Promise<unknown>
    /** Must be idempotent for jobId; must never activate agents or replay tools. */
    restore(value: unknown, input: { jobId: string; workbenchId: string; root: string; remap: NativeSessionRemap }): Promise<void>
  }[]
}
const identity = (value: Pick<CompleteExtensionLock, 'packageName' | 'moduleId' | 'artifactSha256'>) => JSON.stringify([value.packageName, value.moduleId, value.artifactSha256])
const schema = (event: SessionEvent): number => {
  const data = event.data as { schemaVersion?: unknown } | undefined
  return typeof data?.schemaVersion === 'number' ? data.schemaVersion : 1
}

/** Host-only registry. A package cannot claim another build's migration contract. */
export class CompleteMigrationRegistry {
  private readonly providers = new Map<string, CompleteMigrationProvider>()
  register(provider: CompleteMigrationProvider): () => void {
    if (!provider.packageName || !provider.moduleId || !/^[a-f0-9]{64}$/u.test(provider.artifactSha256)) throw new Error('迁移器扩展身份无效。')
    const key = identity(provider)
    if (this.providers.has(key)) throw new Error('扩展迁移器重复注册。')
    for (const rows of [provider.events.map(row => ({ key: row.type, schemaVersion: row.schemaVersion })), provider.workbenchData]) {
      if (new Set(rows.map(row => row.key)).size !== rows.length || rows.some(row => !row.key || !Number.isSafeInteger(row.schemaVersion) || row.schemaVersion < 1)) throw new Error('迁移器数据声明无效。')
    }
    this.providers.set(key, provider)
    return () => { if (this.providers.get(key) === provider) this.providers.delete(key) }
  }
  declaration(extension: Pick<CompleteExtensionLock, 'packageName' | 'moduleId' | 'artifactSha256'>): CompleteMigrationDeclaration {
    const provider = this.providers.get(identity(extension))
    return { events: provider?.events.map(({ type, schemaVersion }) => ({ type, schemaVersion })) ?? [], workbenchData: provider?.workbenchData.map(({ key, schemaVersion }) => ({ key, schemaVersion })) ?? [] }
  }
  exportAdapters(used: (packageName: string) => void): ReadonlyMap<string, NativeEventRemapper> {
    const result = new Map<string, NativeEventRemapper>()
    for (const provider of this.providers.values()) {
      for (const handler of provider.events) {
        if (result.has(handler.type)) throw new Error('多个扩展声明相同事件迁移器：' + handler.type)
        result.set(handler.type, (event, context) => {
          if (schema(event) !== handler.schemaVersion) throw new Error('不支持的事件 schema：' + handler.type)
          used(provider.packageName)
          return handler.remap(structuredClone(event), context)
        })
      }
    }
    return result
  }
  assertExportOwners(extensions: readonly CompleteExtensionLock[], packages: ReadonlySet<string>): void {
    for (const name of packages) {
      const extension = extensions.find(row => row.packageName === name)
      if (!extension || !this.providers.has(identity(extension))) throw new Error('事件迁移器注册身份与扩展制品不一致：' + name)
    }
  }
  assertAvailable(extension: CompleteExtensionLock): void {
    const actual = this.declaration(extension)
    for (const row of extension.migrations.events) if (!actual.events.some(value => value.type === row.type && value.schemaVersion === row.schemaVersion)) throw new Error(`缺少事件迁移器：${extension.packageName} / ${row.type} v${row.schemaVersion}`)
    for (const row of extension.migrations.workbenchData) if (!actual.workbenchData.some(value => value.key === row.key && value.schemaVersion === row.schemaVersion)) throw new Error(`缺少工作台数据迁移器：${extension.packageName} / ${row.key} v${row.schemaVersion}`)
  }
  adapters(extensions: readonly CompleteExtensionLock[]): ReadonlyMap<string, NativeEventRemapper> {
    const result = new Map<string, NativeEventRemapper>()
    for (const extension of extensions) {
      this.assertAvailable(extension)
      const provider = this.providers.get(identity(extension))
      for (const declaration of extension.migrations.events) {
        if (result.has(declaration.type)) throw new Error('多个扩展声明相同事件迁移器：' + declaration.type)
        const handler = provider!.events.find(row => row.type === declaration.type && row.schemaVersion === declaration.schemaVersion)!
        result.set(declaration.type, (event, context) => {
          if (schema(event) !== handler.schemaVersion) throw new Error('不支持的事件 schema：' + declaration.type)
          const migrated = handler.remap(structuredClone(event), context)
          if (migrated.type !== event.type || migrated.seq !== event.seq) throw new Error('迁移器改变了事件身份。')
          return migrated
        })
      }
    }
    return result
  }
  async exportData(extensions: readonly CompleteExtensionLock[], input: { workbenchId: string; root: string }) {
    const result: { packageName: string; moduleId: string; artifactSha256: string; key: string; schemaVersion: number; value: unknown }[] = []
    for (const extension of extensions) {
      this.assertAvailable(extension)
      for (const declared of extension.migrations.workbenchData) {
        const handler = this.providers.get(identity(extension))!.workbenchData.find(row => row.key === declared.key)!
        result.push({ packageName: extension.packageName, moduleId: extension.moduleId, artifactSha256: extension.artifactSha256, ...declared, value: await handler.export(input) })
      }
    }
    return result
  }
  async restoreData(extensions: readonly CompleteExtensionLock[], data: Awaited<ReturnType<CompleteMigrationRegistry['exportData']>>, input: Parameters<CompleteMigrationProvider['workbenchData'][number]['restore']>[1]) {
    const expected = extensions.flatMap(extension => extension.migrations.workbenchData.map(row => identity(extension) + ':' + row.key))
    if (data.length !== expected.length || new Set(data.map(row => identity(row) + ':' + row.key)).size !== data.length) throw new Error('扩展数据清单不完整或重复。')
    for (const extension of extensions) {
      this.assertAvailable(extension)
      for (const declaration of extension.migrations.workbenchData) {
        const row = data.find(value => identity(value) === identity(extension) && value.key === declaration.key && value.schemaVersion === declaration.schemaVersion)
        if (!row) throw new Error('缺少声明的扩展数据：' + declaration.key)
        await this.providers.get(identity(extension))!.workbenchData.find(value => value.key === row.key)!.restore(row.value, input)
      }
    }
  }
}
