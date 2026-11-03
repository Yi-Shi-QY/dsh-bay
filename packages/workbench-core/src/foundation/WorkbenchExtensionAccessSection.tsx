import { useCallback, useState, useSyncExternalStore } from 'react'
import type { WorkbenchExtensionRegistryV1 } from '../client/workbench-extension-registry.ts'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchExtensionAccessRowV1 } from '../workbench-extension-access.ts'
import type { WorkbenchExtensionAccessSnapshotV1 } from '../workbench-extension-access.ts'
import css from './WorkbenchModuleManagerSection.module.css'

const EMPTY_SNAPSHOT: WorkbenchExtensionAccessSnapshotV1 = { status: 'unavailable', extensions: [] }

function availabilityLabel(row: WorkbenchExtensionAccessRowV1, consent: import('../workbench-extension-access.ts').WorkbenchExtensionConsentV1 | undefined): string {
  if (row.allowed) return '已允许在 Workbench 中使用'
  switch (row.availability) {
    case 'ready': return '兼容，等待允许'
    case 'not-allowed': return consent?.allowed === false ? '已禁止在 Workbench 中使用' : consent === undefined ? '等待 Workbench 允许' : '许可需要更新'
    case 'confirmation-required': return '扩展声明已变化，需要重新确认'
    case 'dsh-missing': return 'DSH 插件未安装'
    case 'dsh-disabled': return 'DSH 中未运行'
    case 'inventory-unavailable': return 'DSH 插件清单暂不可用'
    case 'editor-missing': return '插件未提供此内页'
    case 'identity-unverified': return '无法核对 DSH 插件身份'
    case 'incompatible': return '版本不兼容'
    case 'invalid-contract': return '扩展声明无效'
  }
}

/** Read-only DSH discovery plus a separate, profile-local Workbench opt-in. */
export function WorkbenchExtensionAccessSection({ registry, directory }: {
  registry?: WorkbenchExtensionRegistryV1
  directory?: WorkbenchDirectory
}) {
  const subscribeRegistry = useCallback((listener: () => void) => registry?.subscribe(listener) ?? (() => {}), [registry])
  const getRegistry = useCallback(() => registry?.getSnapshot() ?? EMPTY_SNAPSHOT, [registry])
  const snapshot = useSyncExternalStore(subscribeRegistry, getRegistry, getRegistry)
  const subscribeDirectory = useCallback((listener: () => void) => directory?.subscribe(listener) ?? (() => {}), [directory])
  const getDirectory = useCallback(() => directory?.getSnapshot(), [directory])
  const directorySnapshot = useSyncExternalStore(subscribeDirectory, getDirectory, getDirectory)
  const [busyKey, setBusyKey] = useState<string>()
  const [message, setMessage] = useState<{ key?: string; text: string; error?: boolean }>()

  const changeConsent = async (row: WorkbenchExtensionAccessRowV1, allowed: boolean) => {
    if (directory?.setExtensionAllowed === undefined || row.packageName === undefined || row.apiVersion !== 1) return
    setBusyKey(row.key)
    setMessage(undefined)
    try {
      const result = await directory.setExtensionAllowed({
        packageName: row.packageName,
        moduleId: row.moduleId,
        apiVersion: row.apiVersion,
        editorIds: row.editorIds,
        ...(allowed && row.contractFingerprint !== undefined ? { contractFingerprint: row.contractFingerprint } : {}),
      }, allowed)
      if (result.status !== 'committed') throw new Error('设置保存失败或版本发生冲突，请刷新后重试。')
      setMessage({ key: row.key, text: allowed ? '已允许此扩展在 Workbench 中提供内页。' : '已撤销 Workbench 使用许可。' })
    } catch (error) {
      setMessage({ key: row.key, text: error instanceof Error ? error.message : '设置保存失败，请重试。', error: true })
    } finally {
      setBusyKey(undefined)
    }
  }

  const refresh = () => {
    setMessage(undefined)
    void registry?.refresh().catch(() => setMessage({ text: '读取 DSH 插件清单失败，请检查连接后重试。', error: true }))
  }

  return <section className={css.extensionAccess} aria-labelledby="workbench-extension-access-title" data-workbench-extension-access>
    <header className={css.settingsSectionHeader}>
      <div>
        <h3 id="workbench-extension-access-title">已发现的 DSH 扩展</h3>
        <p>扩展本身仍由 DSH 插件管理器安装、启用、更新和卸载。这里的允许只控制它能否向 Workbench 提供内页。</p>
      </div>
      <button className={css.command} type="button" onClick={refresh} disabled={registry === undefined}>刷新清单</button>
    </header>
    {snapshot.status === 'unavailable' ? <p className={css.extensionAccessNotice} role="status">
      目前无法核对 DSH 插件包和运行清单。为避免误加载，扩展内页保持不可用；连接恢复后可以刷新。撤销已有 Workbench 许可仍可操作。
      {snapshot.inventoryFailures?.map((failure, index) => <span key={`${failure.operation}:${index}`}>
        <br />{failure.operation}{failure.code === undefined ? '' : ` (${failure.code})`}: {failure.message}
      </span>)}
    </p> : null}
    {directory?.setExtensionAllowed === undefined ? <p className={css.extensionAccessNotice} role="status">当前设置存储不可写，无法更改扩展许可。</p> : null}
    {snapshot.status === 'ready' && snapshot.extensions.length === 0 ? <p className={css.extensionAccessEmpty}>尚未发现声明 Workbench 内页的外部 DSH 插件。</p> : null}
    <div className={css.extensionAccessRows}>
      {snapshot.extensions.map(row => {
        const consent = directorySnapshot?.extensionConsents?.[row.key]
        const hasConsent = consent !== undefined
        const canAllow = snapshot.status === 'ready' && (row.availability === 'not-allowed' || row.availability === 'confirmation-required')
          && row.packageName !== undefined && row.apiVersion === 1 && row.contractFingerprint !== undefined
        const canRevoke = hasConsent && consent?.allowed !== false && row.packageName !== undefined && directory?.setExtensionAllowed !== undefined
        const label = availabilityLabel(row, consent)
        return <article className={css.extensionAccessRow} key={row.key} data-extension-state={row.availability}>
          <div className={css.extensionAccessHeading}>
            <div><strong>{row.moduleId}</strong><div className={css.subtle}>{row.packageName ?? 'DSH 插件包身份未确认'}{row.packageVersion === undefined ? '' : ` · ${row.packageVersion}`}</div></div>
            <span className={css.badge} data-tone={row.allowed ? 'success' : row.availability === 'not-allowed' || row.availability === 'confirmation-required' || row.availability === 'ready' ? 'warning' : 'error'}>{label}</span>
          </div>
          <p className={css.extensionAccessDetail}>{row.detail}</p>
          {row.providerDiagnostic === undefined ? null : <details className={css.extensionAccessEditors}>
            <summary>身份核验诊断</summary>
            <dl>
              <div><dt>失败原因</dt><dd><code>{row.providerDiagnostic.code}</code></dd></div>
              <div><dt>Slot registrant</dt><dd><code>{row.providerDiagnostic.registrant ?? '未提供'}</code></dd></div>
              <div><dt>runtime entryId</dt><dd><code>{row.providerDiagnostic.runtimeEntryIds.join(', ') || '无'}</code></dd></div>
              <div><dt>runtime moduleName</dt><dd><code>{row.providerDiagnostic.runtimeModuleNames.join(', ') || '无'}</code></dd></div>
              <div><dt>bundle</dt><dd><code>{row.providerDiagnostic.bundleNames.join(', ') || '无'}</code></dd></div>
            </dl>
            <p>{row.providerDiagnostic.detail}</p>
          </details>}
          {row.editorIds.length === 0 ? null : <details className={css.extensionAccessEditors}>
            <summary>声明的内页（{row.editorIds.length}）</summary>
            <ul>{row.editorIds.map(id => <li key={id}><code>{id}</code></li>)}</ul>
          </details>}
          <div className={css.extensionAccessActions}>
            {canAllow ? <button className={css.command + ' ' + css.primary} type="button" disabled={busyKey !== undefined || directory?.setExtensionAllowed === undefined}
              onClick={() => { void changeConsent(row, true) }}>{row.availability === 'confirmation-required' ? '重新确认' : hasConsent ? '更新许可' : '允许使用'}</button> : null}
            {canRevoke ? <button className={css.command} type="button" disabled={busyKey !== undefined}
              onClick={() => { void changeConsent(row, false) }}>撤销许可</button> : null}
            {message?.key === row.key ? <span role={message.error ? 'alert' : 'status'} data-tone={message.error ? 'error' : 'success'}>{message.text}</span> : null}
          </div>
        </article>
      })}
    </div>
    {message?.key === undefined && message !== undefined ? <p className={css.extensionAccessNotice} role={message.error ? 'alert' : 'status'}>{message.text}</p> : null}
    <p className={css.extensionAccessFootnote}>Workbench 许可不是安全沙箱，也不会替 DSH 启用插件；它只控制内页是否进入 Workbench 的可用目录。扩展停止或移除后，已有布局引用会保留并显示不可用状态。</p>
  </section>
}
