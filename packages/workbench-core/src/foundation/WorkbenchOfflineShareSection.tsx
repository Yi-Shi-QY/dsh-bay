import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { IconDownloadOutlineMedium, IconFolderOpenOutlineMedium, IconRefreshOutlineMedium, IconCheckOutlineMedium,
  IconArchiveOutlineMedium, IconChevronLeftOutlineMedium, IconWarningOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory, WorkbenchDirectorySnapshot } from './frame-settings-adapter.ts'
import type { WorkbenchOfflinePackageServiceV1 } from '../offline-package-service.ts'
import type { WorkbenchOfflinePackageV1 } from '../offline-package.ts'
import type { WorkbenchOfflineImportReceipt, WorkbenchOfflineImportPreflight } from '../offline-import-contract.ts'
import type { DshNativePortableBundleOperationV1, DshNativePortableBundlePreviewV1 } from '../dsh-native-offline-bundle.ts'
import { WorkbenchTransferPreview, WorkbenchTransferSteps } from './WorkbenchTransferPreview.tsx'
import css from './WorkbenchModuleManagerSection.module.css'

const EMPTY_DIRECTORY: WorkbenchDirectorySnapshot = { rows: [], openWorkbenchIds: [], globalHiddenEditorIds: [], invalidRows: [], templates: [] }
export type WorkbenchOfflineShareMode = 'import' | 'export' | 'history'
const modes = ['import', 'export', 'history'] as const
const NATIVE_OPERATION_STORAGE_KEY = 'workbench:dsh-native-bundle-operation:v1'
const stateLabels: Record<WorkbenchOfflineImportReceipt['state'], string> = { prepared: '已准备', installing: '安装中', 'restart-required': '等待重启 DSH',
  verifying: '等待浏览器验证', 'committing-layout': '布局待保存', completed: '已导入', failed: '导入失败' }

export function WorkbenchOfflineShareSection({ workbenchDirectory, offlinePackage, active = true, selectedWorkbenchId,
  onSelectWorkbench, onClose, mode: controlledMode, onModeChange }: {
  workbenchDirectory?: WorkbenchDirectory
  offlinePackage?: WorkbenchOfflinePackageServiceV1
  active?: boolean
  selectedWorkbenchId?: string | undefined
  onSelectWorkbench?: (id: string) => void
  onClose?: (() => void) | undefined
  mode?: WorkbenchOfflineShareMode
  onModeChange?: (mode: WorkbenchOfflineShareMode) => void
}) {
  const subscribe = useCallback((listener: () => void) => workbenchDirectory?.subscribe(listener) ?? (() => {}), [workbenchDirectory])
  const getSnapshot = useCallback(() => workbenchDirectory?.getSnapshot() ?? EMPTY_DIRECTORY, [workbenchDirectory])
  const directory = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [localMode, setLocalMode] = useState<WorkbenchOfflineShareMode>('import')
  const mode = controlledMode ?? localMode
  const changeMode = (value: WorkbenchOfflineShareMode) => { setLocalMode(value); onModeChange?.(value) }
  const [selected, setSelected] = useState<string>()
  const selectedId = directory.rows.some(row => row.workbenchId === (selectedWorkbenchId ?? selected))
    ? selectedWorkbenchId ?? selected : directory.activeWorkbenchId ?? directory.rows[0]?.workbenchId
  const [prepared, setPrepared] = useState<{ pkg: WorkbenchOfflinePackageV1; workbenchId: string }>()
  const preview = prepared !== undefined && prepared.workbenchId === selectedId ? prepared.pkg : undefined
  const [downloaded, setDownloaded] = useState<string>()
  const [busy, setBusy] = useState(false)
  const operation = useRef(false)
  const [message, setMessage] = useState<{ text: string; scope: WorkbenchOfflineShareMode; error?: boolean }>()
  const [incoming, setIncoming] = useState<{ pkg: WorkbenchOfflinePackageV1; preflight: WorkbenchOfflineImportPreflight; filename: string }>()
  const [receipts, setReceipts] = useState<WorkbenchOfflineImportReceipt[]>([])
  const [focusedId, setFocusedId] = useState<string>()
  const initialReceipt = useRef(true)
  const receiptRevision = useRef(0)
  const [loadingReceipts, setLoadingReceipts] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const nativeFileInput = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const nativeAvailable = offlinePackage?.nativeBundleAvailable?.() === true
  const [importKind, setImportKind] = useState<'native' | 'core'>('native')
  const [nativeIncoming, setNativeIncoming] = useState<{
    bytes: Uint8Array
    preview: DshNativePortableBundlePreviewV1
    filename: string
  }>()
  const [nativeOperation, setNativeOperation] = useState<DshNativePortableBundleOperationV1>()
  const nativePolling = useRef<{ operationId: string; promise: Promise<DshNativePortableBundleOperationV1 | undefined> }>()
  const id = useId()
  const current = receipts.find(row => row.packageId === focusedId)
  const importedWorkbench = directory.rows.find(row => row.workbenchId === current?.workbenchId)
  const completedDescription = importedWorkbench === undefined ? '导入记录已保留，工作台已不存在。'
    : importedWorkbench.archivedAt !== undefined ? '工作台已导入，当前已归档。'
      : directory.openWorkbenchIds.includes(importedWorkbench.workbenchId) ? '工作台已导入，当前已加载。' : '工作台已导入，状态为未使用。'
  const pendingCount = receipts.filter(row => row.state !== 'completed' && row.state !== 'failed').length
  const updateReceipt = (row: WorkbenchOfflineImportReceipt) => {
    receiptRevision.current++
    setReceipts(rows => [...rows.filter(value => value.packageId !== row.packageId), row])
    setFocusedId(row.packageId)
  }
  useEffect(() => {
    if (!active) return
    let mounted = true
    const revision = ++receiptRevision.current
    setLoadingReceipts(true)
    void offlinePackage?.imports().then(rows => {
      if (!mounted || revision !== receiptRevision.current || operation.current) return
      setReceipts(rows)
      if (initialReceipt.current && rows.length > 0) {
        setFocusedId((rows.find(row => row.state !== 'completed' && row.state !== 'failed') ?? rows.at(-1))?.packageId)
        initialReceipt.current = false
      }
    }).catch(() => {
      if (mounted && revision === receiptRevision.current) setMessage({ text: '导入记录暂时不可用，请重试。', scope: 'history', error: true })
    }).finally(() => { if (mounted) setLoadingReceipts(false) })
    if (offlinePackage === undefined) setLoadingReceipts(false)
    return () => { mounted = false }
  }, [offlinePackage, active])
  const run = async (scope: WorkbenchOfflineShareMode, action: () => Promise<void>) => {
    if (operation.current) return
    receiptRevision.current++
    operation.current = true; setBusy(true); setMessage(undefined)
    try { await action() }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : '操作未完成，请重试。', scope, error: true }) }
    finally { operation.current = false; setBusy(false) }
  }
  const waitForNativeOperation = async (operationId: string): Promise<DshNativePortableBundleOperationV1> => {
    if (offlinePackage?.getNativeBundleStatus === undefined) throw new Error('当前 DSH 未提供原生离线包状态服务。')
    let delay = 250
    for (let attempt = 0; attempt < 80; attempt++) {
      const status = await offlinePackage.getNativeBundleStatus(operationId)
      setNativeOperation(status)
      if (status.phase === 'ready' || status.phase === 'failed' || status.phase === 'cancelled') return status
      await new Promise(resolve => setTimeout(resolve, delay))
      delay = Math.min(1_000, Math.round(delay * 1.35))
    }
    throw new Error('DSH 原生离线包导入超时，请在 DSH Manager 中查看操作状态。')
  }
  const pollNativeOperation = (operationId: string): Promise<DshNativePortableBundleOperationV1 | undefined> => {
    const existing = nativePolling.current
    if (existing?.operationId === operationId) return existing.promise
    const promise = (async (): Promise<DshNativePortableBundleOperationV1 | undefined> => {
      try {
        const result = await waitForNativeOperation(operationId)
        if (result.phase === 'ready' || result.phase === 'failed' || result.phase === 'cancelled') {
          try { sessionStorage.removeItem(NATIVE_OPERATION_STORAGE_KEY) } catch { /* storage may be unavailable */ }
        }
        return result
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : 'DSH 原生离线包状态读取失败。', scope: 'import', error: true })
        return undefined
      }
    })()
    nativePolling.current = { operationId, promise }
    void promise.finally(() => { if (nativePolling.current?.operationId === operationId) nativePolling.current = undefined })
    return promise
  }
  useEffect(() => {
    if (!active || !nativeAvailable || offlinePackage?.getNativeBundleStatus === undefined) return
    try {
      const raw = sessionStorage.getItem(NATIVE_OPERATION_STORAGE_KEY)
      if (raw === null || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(raw)) return
      setNativeOperation({ schemaVersion: 1, operationId: raw, phase: 'accepted' })
      void pollNativeOperation(raw)
    } catch { /* session storage is optional */ }
  }, [active, nativeAvailable, offlinePackage])
  const receiveNative = (file: File | undefined) => {
    const inspectNativeBundle = offlinePackage?.inspectNativeBundle
    if (file === undefined || inspectNativeBundle === undefined || operation.current) return
    setNativeIncoming(undefined); setNativeOperation(undefined)
    void run('import', async () => {
      if (file.size > 512 * 1024 * 1024) throw new Error('DSH 原生离线包不能超过 512 MiB。')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const preview = await inspectNativeBundle(bytes)
      setNativeIncoming({ bytes, preview, filename: file.name })
    })
  }
  const commitNativeImport = () => {
    const importNativeBundle = offlinePackage?.importNativeBundle
    if (nativeIncoming === undefined || importNativeBundle === undefined) return
    void run('import', async () => {
      const accepted = await importNativeBundle(nativeIncoming.bytes)
      setNativeOperation(accepted)
      try { sessionStorage.setItem(NATIVE_OPERATION_STORAGE_KEY, accepted.operationId) } catch { /* storage is optional */ }
      const result = await pollNativeOperation(accepted.operationId)
      if (result === undefined) throw new Error('DSH 原生离线包状态读取失败。')
      if (result.phase !== 'ready') throw new Error(result.message ?? 'DSH 原生离线包导入未完成。')
      setMessage({ text: 'DSH 原生离线包已导入，新的 DSH 实例正在由 Manager 准备。', scope: 'import' })
      setNativeIncoming(undefined)
    })
  }
  const exportNative = () => {
    const exportNativeBundle = offlinePackage?.exportNativeBundle
    if (exportNativeBundle === undefined) return
    void run('export', async () => {
      const result = await exportNativeBundle({ distribution: 'embedded' })
      const filename = result.filename ?? `dsh-portable-bundle-${result.bundleId ?? 'export'}.dshbundle`
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.archive).buffer], { type: 'application/octet-stream' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = filename; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setMessage({ text: `DSH 原生离线包已导出（${Math.round((result.archiveSize ?? result.archive.byteLength) / 1024)} KiB）。`, scope: 'export' })
    })
  }
  const receive = (file: File | undefined) => {
    if (file === undefined || offlinePackage === undefined || operation.current) return
    initialReceipt.current = false; setIncoming(undefined); setFocusedId(undefined)
    void run('import', async () => {
      if (file.size > 72 * 1024 * 1024) throw new Error('离线包不能超过 72 MiB。')
      setIncoming({ ...await offlinePackage.inspectImport(new Uint8Array(await file.arrayBuffer())), filename: file.name })
    })
  }
  const resetImport = () => { initialReceipt.current = false; setIncoming(undefined); setFocusedId(undefined); setMessage(undefined) }
  const commitImport = () => {
    if (incoming === undefined || offlinePackage === undefined) return
    void run('import', async () => {
      updateReceipt(await offlinePackage.importWorkbench(incoming.pkg))
    })
  }
  const refreshImports = (packageId?: string) => {
    if (offlinePackage === undefined) return
    void run(mode, async () => {
      const rows = await offlinePackage.imports()
      setReceipts(rows)
      const target = rows.find(row => row.packageId === packageId)
      if (target && ['verifying', 'committing-layout'].includes(target.state)) updateReceipt(await offlinePackage.resumeImport(target.packageId))
      else if (target?.state === 'restart-required') setMessage({ text: '尚未检测到 DSH 重启。', scope: mode })
    })
  }
  const prepare = (download = false) => {
    if (offlinePackage === undefined || selectedId === undefined) return
    void run('export', async () => {
      setPrepared(undefined); setDownloaded(undefined)
      const result = await offlinePackage.exportWorkbench(selectedId)
      setPrepared({ pkg: result, workbenchId: selectedId }); setDownloaded(undefined)
      if (download && result.packageId !== preview?.packageId) {
        setMessage({ text: '工作台内容已变化，预览已更新，请重新确认下载。', scope: 'export' }); return
      }
      if (download) {
        const url = URL.createObjectURL(new Blob([new Uint8Array(result.archive).buffer], { type: 'application/zip' }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = 'workbench-' + result.packageId.slice(0, 12) + '.dsh-workbench-offline.zip'
        anchor.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        setDownloaded(result.packageId)
        setMessage({ text: '工作台布局分享包已导出。', scope: 'export' })
      }
    })
  }
  const openWorkbench = (row: WorkbenchOfflineImportReceipt) => {
    if (workbenchDirectory === undefined) return
    void run('import', async () => {
      const result = await workbenchDirectory.openAndSelect(row.workbenchId)
      if (result.status !== 'committed') throw new Error('工作台暂时无法打开，请在工作台列表中检查其状态。')
      onClose?.()
    })
  }
  const importStep = current?.state === 'completed' ? 3 : current !== undefined ? 2 : incoming !== undefined ? 1 : 0
  return <section className={css.center} data-workbench-offline-share aria-label="离线分享" aria-busy={busy}>
    <header className={css.header}><div><h2>离线分享</h2><span className={css.subtle}>{nativeAvailable ? '使用 DSH Manager 原生 Portable Bundle 导出或导入实例' : '分享脱敏工作台布局，接收端再由 DSH 原生管理模块'}</span></div>
      <span className={css.badge}>{nativeAvailable ? 'DSH 原生 Bundle' : 'Core-only 布局包'}</span></header>
    <div className={css.modeTabs} role="tablist" aria-label="离线分享方式">
      {modes.map(value => <button key={value} type="button" role="tab" id={id + '-' + value} aria-controls={id + '-' + value + '-panel'}
        aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} disabled={busy}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? modes[0] : event.key === 'End' ? modes[2] : modes[(modes.indexOf(mode) + (event.key === 'ArrowLeft' ? 2 : 1)) % modes.length]!
          changeMode(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[id="' + id + '-' + next + '"]')?.focus()
        }} onClick={() => changeMode(value)}>
        {value === 'import' ? '导入离线包' : value === 'export' ? '导出离线包' : '导入记录'}{value === 'history' && pendingCount > 0 ? <span className={css.count}>{pendingCount}</span> : null}
      </button>)}
    </div>
    {offlinePackage === undefined ? <div className={css.notice} data-tone="warning" role="status">当前 DSH 未提供离线包服务。</div>
      : !nativeAvailable ? <div className={css.notice} data-tone="neutral" role="status">当前 DSH 未提供 Portable Bundle bridge，下面使用工作台布局分享（Core-only）格式。</div> : null}
    {message === undefined || message.scope !== mode ? null : <div className={css.notice} data-tone={message.error ? 'error' : 'neutral'} role={message.error ? 'alert' : 'status'}>{message.text}</div>}
    <div id={id + '-import-panel'} role="tabpanel" aria-labelledby={id + '-import'} hidden={mode !== 'import'} data-workbench-offline-import>
      {nativeAvailable ? <div className={css.modeTabs} role="tablist" aria-label="离线包类型">
        <button type="button" role="tab" aria-selected={importKind === 'native'} onClick={() => { setImportKind('native'); setNativeIncoming(undefined); setFocusedId(undefined) }} disabled={busy}>DSH 原生离线包</button>
        <button type="button" role="tab" aria-selected={importKind === 'core'} onClick={() => { setImportKind('core'); setNativeIncoming(undefined) }} disabled={busy}>工作台布局分享（Core-only）</button>
      </div> : null}
      {nativeAvailable && importKind === 'native' ? <>
        <input ref={nativeFileInput} className={css.fileInput} type="file" aria-label="选择 DSH 原生离线包" accept=".dshbundle" disabled={busy}
          onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; receiveNative(file) }} />
        {nativeIncoming === undefined && nativeOperation === undefined ? <div className={css.fileDrop} data-dragging={dragging}
          onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)}
          onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) receiveNative(event.dataTransfer.files[0]) }}>
          <span className={css.emptyIcon}><IconArchiveOutlineMedium size={32} /></span>
          <h3>{busy ? '正在检查 DSH 原生离线包' : '导入 DSH 原生离线包'}</h3><p>.dshbundle · 由 DSH Manager 创建和恢复实例</p>
          <button className={css.command + ' ' + css.primary} type="button" disabled={busy} onClick={() => nativeFileInput.current?.click()}><IconFolderOpenOutlineMedium />选择原生离线包</button>
        </div> : null}
        {nativeIncoming !== undefined ? <>
          <div className={css.fileBar}><span>{nativeIncoming.filename}</span><button className={css.command} type="button" disabled={busy} onClick={() => nativeFileInput.current?.click()}><IconFolderOpenOutlineMedium />更换文件</button></div>
          <div className={css.trustPanel}><h3>{nativeIncoming.preview.name}</h3><p>DSH 原生 Portable Bundle · {nativeIncoming.preview.version}</p>
            <dl><div><dt>Bundle ID</dt><dd><code>{nativeIncoming.preview.bundleId}</code></dd></div><div><dt>发布者</dt><dd>{nativeIncoming.preview.publisherName ?? '未提供'}</dd></div>
              <div><dt>运行时分发</dt><dd>{nativeIncoming.preview.runtimeDistribution ?? '由 Manager 决定'}</dd></div><div><dt>扩展数量</dt><dd>{nativeIncoming.preview.extensionCount ?? 0}</dd></div>
              <div><dt>SHA-256</dt><dd><code>{nativeIncoming.preview.archiveSha256}</code></dd></div></dl>
            <p className={css.subtle}>导入后由 DSH Manager 验证签名并创建或恢复新的 DSH 实例，当前工作台不会直接写入此归档。</p>
          </div>
          <footer className={css.sectionFooter}><button className={css.command} type="button" disabled={busy} onClick={() => setNativeIncoming(undefined)}><IconChevronLeftOutlineMedium />重新选择</button>
            <button className={css.command + ' ' + css.primary} type="button" disabled={busy} onClick={commitNativeImport}><IconDownloadOutlineMedium />{busy ? '正在交给 DSH Manager' : '确认导入原生离线包'}</button></footer>
        </> : null}
        {nativeOperation !== undefined ? <div className={css.transferResult} data-offline-import-state={nativeOperation.phase}>
          <div className={css.resultHeading} data-tone={nativeOperation.phase === 'ready' ? 'success' : nativeOperation.phase === 'failed' ? 'error' : 'warning'}>
            {nativeOperation.phase === 'ready' ? <IconCheckOutlineMedium size={24} /> : nativeOperation.phase === 'failed' ? <IconWarningOutlineMedium size={24} /> : <IconRefreshOutlineMedium size={24} />}
            <div><h3>{nativeOperation.phase === 'ready' ? 'DSH 原生离线包已导入' : nativeOperation.phase === 'failed' ? '原生离线包导入失败' : '正在由 DSH Manager 导入'}</h3>
              <p>{nativeOperation.phase === 'ready' ? '新的 DSH 实例已由 Manager 创建或恢复，请切换到该实例继续使用。' : nativeOperation.message ?? '正在验证签名、准备运行时和恢复扩展。'}</p></div>
          </div>
          <div className={css.resultIdentity}><span>{nativeOperation.bundleId ?? 'DSH Portable Bundle'}</span><code title={nativeOperation.operationId}>{nativeOperation.operationId.slice(0, 12)}</code></div>
          {nativeOperation.phase !== 'ready' && nativeOperation.phase !== 'failed' && nativeOperation.phase !== 'cancelled' ? <button className={css.command} type="button" disabled={busy} onClick={() => void run('import', async () => { await pollNativeOperation(nativeOperation.operationId) })}><IconRefreshOutlineMedium />刷新导入状态</button> : null}
        </div> : null}
      </> : null}
      {!nativeAvailable || importKind === 'core' ? <>
      <WorkbenchTransferSteps labels={['选择文件', '核对内容', '安装与验证', '导入完成']} current={importStep} complete={current?.state === 'completed'} />
      <input ref={fileInput} className={css.fileInput} type="file" aria-label="选择工作台离线包" accept=".zip" disabled={busy || offlinePackage === undefined}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; receive(file) }} />
      {current === undefined && incoming === undefined ? <div className={css.fileDrop} data-dragging={dragging}
        onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) receive(event.dataTransfer.files[0]) }}>
        <span className={css.emptyIcon}><IconArchiveOutlineMedium size={32} /></span>
        <h3>{busy ? '正在检查离线包' : '接收工作台离线包'}</h3><p>ZIP 文件 · 最大 72 MiB</p>
        <button className={css.command + ' ' + css.primary} type="button" disabled={busy || offlinePackage === undefined} onClick={() => fileInput.current?.click()}><IconFolderOpenOutlineMedium />选择离线包</button>
      </div> : null}
      {incoming !== undefined && current === undefined ? <>
        <div className={css.fileBar}><span>{incoming.filename}</span><button className={css.command} type="button" disabled={busy} onClick={() => fileInput.current?.click()}><IconFolderOpenOutlineMedium />更换文件</button></div>
        <WorkbenchTransferPreview pkg={incoming.pkg} />
        <div className={css.notice} data-tone={incoming.preflight.action === 'install-and-restart' ? 'warning' : 'neutral'}>
          <div><strong>{{ 'install-and-restart': '需要安装模块并重启', reuse: '复用已验证模块', resume: '继续已有导入', 'already-imported': '此包已导入' }[incoming.preflight.action]}</strong>
            <p>{incoming.preflight.action === 'already-imported' ? '保留接收方已有编辑。' : '导入后新增一个未使用工作台，当前工作台保持不变。'}</p></div>
        </div>
        <footer className={css.sectionFooter}><button className={css.command} type="button" disabled={busy} onClick={resetImport}><IconChevronLeftOutlineMedium />重新选择</button>
          <button className={css.command + ' ' + css.primary} type="button" disabled={busy} onClick={commitImport}>{busy ? <IconRefreshOutlineMedium /> : <IconDownloadOutlineMedium />}{busy ? '正在导入' : '确认导入工作台'}</button></footer>
      </> : null}
      {current === undefined ? null : <div className={css.transferResult} data-offline-import-state={current.state}>
        <div className={css.resultHeading} data-tone={current.state === 'completed' ? 'success' : current.state === 'failed' ? 'error' : 'warning'}>
          {current.state === 'completed' ? <IconCheckOutlineMedium size={24} /> : current.state === 'failed' ? <IconWarningOutlineMedium size={24} /> : <IconRefreshOutlineMedium size={24} />}
          <div><h3>{stateLabels[current.state]}</h3><p>{current.state === 'completed' ? completedDescription : current.state === 'restart-required'
            ? '模块已安装，工作台布局等待重启验证。' : current.state === 'failed' ? '此次导入未完成，原有工作台保留。' : '模块与内页通过验证后保存布局。'}</p></div>
        </div>
        <div className={css.resultIdentity}><span>{directory.rows.find(row => row.workbenchId === current.workbenchId)?.name ?? incoming?.pkg.layout.name ?? '工作台离线包'}</span>
          <code title={current.packageId}>{current.packageId.slice(0, 12)}</code></div>
        {current.error === undefined ? null : <div className={css.notice} data-tone="warning" role="status">{current.error === 'layout-pending' ? '布局尚未写入，可以继续重试。'
          : current.error === 'rollback-pending' ? '模块清理尚未完成，需要重启后恢复。' : '安装或内页验证失败。'}</div>}
        <footer className={css.sectionFooter}>
          <button className={css.command} type="button" disabled={busy} onClick={resetImport}><IconFolderOpenOutlineMedium />{current.state === 'failed' ? '重新选择离线包' : '导入另一个离线包'}</button>
          <div className={css.actions}>{current.state === 'completed' ? <>
            <button className={css.command + ' ' + css.primary} type="button" disabled={busy || workbenchDirectory === undefined || importedWorkbench === undefined || importedWorkbench.archivedAt !== undefined}
              onClick={() => openWorkbench(current)}><IconFolderOpenOutlineMedium />打开工作台</button>
          </> : current.state !== 'failed' ? <button className={css.command + ' ' + css.primary} type="button" disabled={busy || offlinePackage === undefined}
            onClick={() => refreshImports(current.packageId)}><IconRefreshOutlineMedium />{current.state === 'restart-required' ? '检查重启状态' : '继续验证并保存'}</button> : null}</div>
        </footer>
      </div>}
      </> : null}
    </div>
    <div id={id + '-export-panel'} role="tabpanel" aria-labelledby={id + '-export'} hidden={mode !== 'export'}>
      {nativeAvailable ? <div className={css.exportContents}>
        <h3>导出 DSH 原生离线包</h3>
        <ul><li><IconCheckOutlineMedium />由 DSH Manager 保存运行时、实例模板和扩展</li><li><IconCheckOutlineMedium />接收方通过原生 Manager 验证并创建新实例</li><li><IconCheckOutlineMedium />不包含 Session、凭据和本机绝对路径</li></ul>
        <p className={css.subtle}>这是 DSH Manager Portable Bundle（.dshbundle），与下方的工作台布局分享格式不同。</p>
        <button className={css.command + ' ' + css.primary} type="button" disabled={busy || offlinePackage?.exportNativeBundle === undefined} onClick={exportNative}><IconDownloadOutlineMedium />{busy ? '正在导出' : '导出原生离线包'}</button>
      </div> : null}
      {nativeAvailable ? <div className={css.notice} data-tone="neutral"><div><strong>工作台布局分享（Core-only）</strong><p>仅包含 Workbench 布局和模块身份，不创建 DSH 实例。适用于没有 Portable Bundle bridge 的接收端。</p></div></div> : null}
      <WorkbenchTransferSteps labels={['选择工作台', '检查离线包', '下载分享']} current={preview === undefined ? 0 : downloaded === preview.packageId ? 2 : 1} complete={preview !== undefined && downloaded === preview.packageId} />
      <div className={css.scopeBar}><label>选择要导出的工作台（仅选择布局来源）<select aria-label="离线导出工作台，仅选择布局来源" value={selectedId ?? ''} disabled={busy || directory.rows.length === 0}
        onChange={event => { setSelected(event.target.value); onSelectWorkbench?.(event.target.value); setPrepared(undefined); setDownloaded(undefined); setMessage(undefined) }}>
        {directory.rows.map(row => <option key={row.workbenchId} value={row.workbenchId}>{row.name}</option>)}
      </select></label></div>
      {preview === undefined ? <div className={css.exportContents}><h3>{nativeAvailable ? '导出工作台布局分享（Core-only）' : '导出工作台布局分享（Core-only）'}</h3>
        <ul><li><IconCheckOutlineMedium />区域布局、工作台名称和标签</li><li><IconCheckOutlineMedium />布局中使用的内页扩展和原始制品</li><li><IconCheckOutlineMedium />内页入口状态和接收方需要重新绑定的资源</li></ul>
        <p className={css.subtle}>聊天记录、凭据和本机文件不会写入包内。接收方需要兼容的 DSH 与 Workbench Core，并在导入后完成重启验证。</p>
        <button className={css.command + ' ' + css.primary} type="button" disabled={busy || offlinePackage === undefined || selectedId === undefined}
          onClick={() => prepare()}><IconCheckOutlineMedium />{busy ? '正在检查' : '检查布局分享包'}</button>
      </div> : <>
        <WorkbenchTransferPreview pkg={preview} />
        <footer className={css.sectionFooter}><button className={css.command} type="button" disabled={busy} onClick={() => prepare()}><IconRefreshOutlineMedium />重新检查</button>
          <button className={css.command + ' ' + css.primary} type="button" disabled={busy} onClick={() => prepare(true)}><IconDownloadOutlineMedium />{downloaded === preview.packageId ? '再次下载布局分享包' : '下载布局分享包'}</button></footer>
      </>}
    </div>
    <div id={id + '-history-panel'} role="tabpanel" aria-labelledby={id + '-history'} hidden={mode !== 'history'}>
      <div className={css.pageHeading}><h3>导入记录 <span className={css.subtle}>{receipts.length}</span></h3><button className={css.iconButton} type="button" title="刷新导入记录" aria-label="刷新导入记录"
        disabled={busy || offlinePackage === undefined || loadingReceipts} onClick={() => refreshImports()}><IconRefreshOutlineMedium /></button></div>
      {receipts.length === 0 ? <div className={css.empty}><IconArchiveOutlineMedium size={28} /><p>{loadingReceipts ? '正在读取导入记录' : '暂无导入记录'}</p></div>
        : <div className={css.receiptList}>{[...receipts].reverse().map(row => <button className={css.receiptRow} type="button" key={row.packageId} disabled={busy}
          onClick={() => { initialReceipt.current = false; setIncoming(undefined); setFocusedId(row.packageId); changeMode('import') }}>
          <IconArchiveOutlineMedium /><span><strong>{directory.rows.find(workbench => workbench.workbenchId === row.workbenchId)?.name ?? '工作台离线包'}</strong><code>{row.packageId.slice(0, 12)}</code></span>
          <span className={css.badge} data-tone={row.state === 'completed' ? 'success' : row.state === 'failed' ? 'error' : 'warning'}>{stateLabels[row.state]}</span>
        </button>)}</div>}
    </div>
  </section>
}
