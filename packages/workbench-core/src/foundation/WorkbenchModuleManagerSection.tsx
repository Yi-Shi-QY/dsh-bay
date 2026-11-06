import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react'
import { IconDownloadOutlineMedium, IconRefreshOutlineMedium, IconFolderOpenOutlineMedium, IconCordisPluginOutlineMedium,
  IconNewChatOutlineMedium, IconBranchOutlineMedium, IconCheckOutlineMedium, IconShareOutlineMedium, IconChevronDownOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchModuleManagerSnapshotV1, WorkbenchModuleManagerV1 } from '../module-manager.ts'
import { WORKBENCH_TEAM_TRUST_ROOT_V1 } from '../signed-catalog.ts'
import { WORKBENCH_CORE_VERSION, WORKBENCH_DSH_GENERATION } from '../release-compatibility.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from '../conversation-page-metadata.ts'
import type { WorkbenchDirectory, WorkbenchDirectorySnapshot } from './frame-settings-adapter.ts'
import type { WorkbenchEditorCatalog } from './catalog.ts'
import css from './WorkbenchModuleManagerSection.module.css'
import { workbenchRestartMessage, WorkbenchRestartError } from '../restart-contract.ts'
import type { WorkbenchModuleSourceRequestV1 } from '../module-source.ts'
import { WorkbenchOperationError, workbenchUserError } from '../user-error.ts'
import { WorkbenchNativePluginNavigationError, type WorkbenchNativePluginNavigation } from '../client/native-plugin-navigation.ts'
import { workbenchModuleKindFor } from '../module-contract.ts'

const EMPTY_SNAPSHOT: WorkbenchModuleManagerSnapshotV1 = { state: 'empty', entries: [], inventory: [] }
const EMPTY_DIRECTORY: WorkbenchDirectorySnapshot = { openWorkbenchIds: [], globalHiddenEditorIds: [], rows: [], invalidRows: [], templates: [] }
const EMPTY_EDITORS: ReturnType<WorkbenchEditorCatalog['getSnapshot']> = []

function localizeUiError(value: string): string {
  if (value.includes('unowned') || value.includes('profile-unowned')) return '当前 Profile 中存在未由 Workbench 管理的同名内页模块，请先验证并认领。'
  if (value.includes('conflict') || value.includes('identity')) return '当前 Profile 中的同名内页模块身份不匹配，Workbench 不会覆盖它。'
  if (value.includes('catalog') || value.includes('Catalog')) return '扩展目录无效或未通过信任校验，请重新导入。'
  if (value.includes('restart') || value.includes('重启')) return '此操作需要重启 DSH 后才能完成。'
  return '模块状态读取失败，请刷新后重试。'
}

function PagePreview({ kind }: { kind: string }) {
  return <div className={css.preview} data-page-preview={kind} aria-label="内页示例">
    {kind === 'start' ? <><strong>新建对话</strong><div className={css.sampleOptions}>工作区 <span>Agent</span><span>模型</span></div><div className={css.sampleInput}>输入消息…</div></>
      : kind === 'conversation' ? <><strong>对话</strong><div className={css.sampleMessage}>整理项目的实现计划</div><div>已完成项目结构检查。</div><div className={css.sampleInput}>发送消息…</div></>
      : kind === 'extension' ? <><strong>扩展内页</strong><div className={css.sampleOptions}>由已安装模块提供</div><div className={css.sampleInput}>预览不可用</div></>
        : <><strong>Agent 轨迹</strong><ol><li>分析项目结构</li><li>读取关联文件</li><li>整理实现计划</li></ol></>}
  </div>
}

export function WorkbenchModuleManagerSection({ moduleManager, workbenchDirectory, editorCatalog, nativePluginNavigation, close, active: visible = true, onShare, children }: {
  moduleManager?: WorkbenchModuleManagerV1
  workbenchDirectory?: WorkbenchDirectory
  editorCatalog?: WorkbenchEditorCatalog
  nativePluginNavigation?: WorkbenchNativePluginNavigation
  close?: () => void
  active?: boolean
  onShare?: (mode: 'import' | 'export') => void
  children?: ReactNode
}) {
  const subscribe = useCallback((listener: () => void) => moduleManager?.subscribe(listener) ?? (() => {}), [moduleManager])
  const getSnapshot = useCallback(() => moduleManager?.getSnapshot() ?? EMPTY_SNAPSHOT, [moduleManager])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const subscribeDirectory = useCallback((listener: () => void) => workbenchDirectory?.subscribe(listener) ?? (() => {}), [workbenchDirectory])
  const getDirectory = useCallback(() => workbenchDirectory?.getSnapshot() ?? EMPTY_DIRECTORY, [workbenchDirectory])
  const directory = useSyncExternalStore(subscribeDirectory, getDirectory, getDirectory)
  const globalHiddenEditorIds = directory.globalHiddenEditorIds ?? []
  const subscribeEditors = useCallback((listener: () => void) => editorCatalog?.subscribe(listener) ?? (() => {}), [editorCatalog])
  const getEditors = useCallback(() => editorCatalog?.getSnapshot() ?? EMPTY_EDITORS, [editorCatalog])
  const liveEditors = useSyncExternalStore(subscribeEditors, getEditors, getEditors)
  const subscribeNative = useCallback((listener: () => void) => nativePluginNavigation?.subscribe(listener) ?? (() => {}), [nativePluginNavigation])
  const getNative = useCallback(() => nativePluginNavigation?.getSnapshot() ?? false, [nativePluginNavigation])
  const nativeAvailable = useSyncExternalStore(subscribeNative, getNative, getNative)
  const [message, setMessage] = useState<{ text: string; error?: boolean }>()
  const [actionBusy, setBusy] = useState(false)
  const busy = actionBusy || snapshot.restartPending === true
  const [view, setView] = useState<'catalog' | 'installable' | 'installed' | 'trust'>('catalog')
  const [directKind, setDirectKind] = useState<'npm' | 'git'>('npm')
  const [directPackage, setDirectPackage] = useState('')
  const [directRef, setDirectRef] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const scopeId = useId()
  useEffect(() => { if (visible) void moduleManager?.refresh?.() }, [moduleManager, visible])
  const suite = snapshot.entries.find(entry => entry.moduleId === 'workbench.conversation-suite')
  const identity = suite ?? snapshot.host?.installed
  const plan = useMemo(() => {
    if (moduleManager === undefined || suite === undefined) return undefined
    try { return moduleManager.createInstallPlan('workbench.conversation-suite') }
    catch (error) { return { status: 'blocked' as const, blockers: [{ message: error instanceof Error ? error.message : '模块预检未完成。' }] } }
  }, [moduleManager, suite, snapshot])
  const exact = suite !== undefined && snapshot.host?.installed !== undefined
    && suite.version === snapshot.host.installed.version && suite.artifactDigest === snapshot.host.installed.artifactDigest
  const installedConflict = suite !== undefined && snapshot.host?.installed !== undefined && !exact
  const restart = snapshot.state === 'restart-required'
  const repair = snapshot.host?.activation === 'unverified'
  const profileConflict = snapshot.host?.profileConflict === 'unowned-module'
  const inventory = (snapshot.inventory ?? []).find(item => item.moduleId === 'workbench.conversation-suite')
  const otherInventory = (snapshot.inventory ?? []).filter(item => item.moduleId !== 'workbench.conversation-suite')
  const officialInventory = (snapshot.inventory ?? []).filter(item => item.kind === 'official-builtin')
  const nativeOfficialEditorIds = new Set([
    'workbench.workspace-files', 'workbench.terminal', 'workbench.browser',
    'workbench.conversation.start', 'workbench.conversation', 'workbench.agent-trajectory',
  ])
  const nativeConversationEditorIds = new Set(['workbench.conversation.start', 'workbench.conversation', 'workbench.agent-trajectory'])
  const coreNativeReady = [...nativeOfficialEditorIds].every(id => liveEditors.some(editor => editor.id === id))
  const legacySuiteInProfile = inventory?.profilePresence === 'present' && identity?.moduleId === 'workbench.conversation-suite' && coreNativeReady
  const active = legacySuiteInProfile || (snapshot.state === 'active' && (snapshot.host === undefined || (snapshot.host.activation === 'active' && exact)))
  const officialCatalogEntries = snapshot.entries.filter(entry => workbenchModuleKindFor(entry) === 'official-builtin')
  const extensionCatalogEntries = snapshot.entries.filter(entry => workbenchModuleKindFor(entry) === 'extension')
  const suiteIsOfficialBuiltin = workbenchModuleKindFor(inventory ?? suite ?? { moduleId: 'workbench.conversation-suite' }) === 'official-builtin'
  const officialBuiltinMissing = suiteIsOfficialBuiltin && inventory?.profilePresence !== 'present' && !coreNativeReady
  const inventoryNeedsInstall = inventory?.profilePresence === 'absent' && inventory.allowedActions.includes('install')
  const officialNeedsProvision = inventory?.allowedActions.includes('provision-official') === true
  const inventoryNeedsClaim = inventory?.allowedActions.includes('claim')
  const label = inventory?.nativeRuntime === 'disabled' ? '由 DSH 原生插件停用' : inventory?.nativeRuntime === 'restart-required' ? 'DSH 原生状态等待重启' : officialBuiltinMissing ? '等待官方内置交付' : inventoryNeedsClaim ? '待验证认领' : inventory?.diagnosticCode === 'profile-identity-conflict' ? '外部版本冲突' : profileConflict ? '配置冲突' : suite?.signedCatalog?.revoked ? '已撤销，禁止安装与激活' : installedConflict ? '身份冲突'
    : suite === undefined ? '缺少受信任目录' : restart ? '已安装，等待重启' : active ? '已验证激活'
      : repair ? '已安装，未通过激活验证' : inventoryNeedsInstall && plan?.status === 'ready' ? '可安装' : '等待 Profile 预检'
  const pages = [
    ...WORKBENCH_CONVERSATION_PAGE_METADATA.filter(page => (coreNativeReady || suite?.manifest?.provides.editorIds.includes(page.id))
      && liveEditors.some(editor => editor.id === page.id)),
    ...liveEditors
      .filter(editor => !WORKBENCH_CONVERSATION_PAGE_METADATA.some(page => page.id === editor.id))
      .map(editor => ({ id: editor.id, label: editor.label, scope: editor.scope, preview: 'extension' as const })),
  ]
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage(undefined)
    try { await action() }
    catch (error) { setMessage({ text: error instanceof WorkbenchNativePluginNavigationError || error instanceof WorkbenchRestartError || error instanceof WorkbenchOperationError ? error.message : localizeUiError(error instanceof Error ? error.message : '操作失败，请重试。'), error: true }) }
    finally { setBusy(false) }
  }
  const requestRestart = () => { void run(async () => {
    if (moduleManager?.requestRestart === undefined || moduleManager.restartAvailability !== 'available') {
      setMessage({ text: '当前启动方式不支持一键安全重启。请先关闭此 DSH 实例，再使用相同 Profile 重新启动。已安装模块和工作台布局会保留。' })
      return
    }
    await moduleManager.requestRestart()
    setMessage({ text: '重启已完成，正在刷新内页模块状态。' })
    await moduleManager.refresh?.()
  }) }
  const importCatalog = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.item(0)
    event.currentTarget.value = ''
    if (file == null || moduleManager === undefined) return
    void run(async () => {
      if (file.size > 64 * 1024 * 1024) throw new Error('目录归档超过 64 MiB。')
      await moduleManager.importCatalogArchive(new Uint8Array(await file.arrayBuffer()))
      setMessage({ text: '团队目录已验证并保存。' })
    })
  }
  const viewTitles = { catalog: '扩展目录', installable: '可安装扩展', installed: '已安装扩展', trust: '来源与信任' } as const
  const viewVisible = view === 'catalog' || view === 'trust' || (view === 'installable' && inventoryNeedsInstall) || (view === 'installed' && ((inventory?.profilePresence === 'present') || otherInventory.length > 0))
  const viewDescription = view === 'catalog' ? '浏览受信目录及其提供的内页能力。'
    : view === 'installable' ? '只显示 Profile 中不存在、且通过完整预检的扩展。'
      : view === 'installed' ? '显示 Profile 中实际存在的包，并区分 Workbench 所有权和激活状态。'
        : '查看目录签名、信任根、来源和离线导入信息。'
  return <section className={css.center} data-workbench-module-manager="v1" aria-label="容器内页中心" aria-busy={busy}>
    <header className={css.header}>
      <div><h2>容器内页中心</h2><span className={css.subtle}>查看已安装扩展、预览内页，并管理所有工作台的入口</span></div>
      <div className={css.actions}>
        {nativeAvailable ? <button className={css.command} type="button" disabled={busy} onClick={() => { void run(async () => { await nativePluginNavigation!.open(); close?.() }) }}><IconCordisPluginOutlineMedium />打开 DSH 原生插件管理</button> : null}
        <input className={css.fileInput} ref={fileInput} aria-label="本地签名目录归档" type="file" accept=".zip,.dshcatalog,application/zip"
          disabled={busy || moduleManager === undefined || restart} onChange={importCatalog} />
        <button className={css.command} type="button" disabled={busy || moduleManager === undefined || restart} onClick={() => fileInput.current?.click()}><IconFolderOpenOutlineMedium />导入扩展目录</button>
        <button className={css.iconButton} type="button" title="刷新模块状态" aria-label="刷新模块状态" disabled={busy || moduleManager?.refresh === undefined}
          onClick={() => { void run(async () => { await moduleManager?.refresh?.() }) }}><IconRefreshOutlineMedium /></button>
      </div>
    </header>
    {children}
    <section className={css.versionInfo} data-workbench-version-info="true"
      data-workbench-core-version={WORKBENCH_CORE_VERSION}
      data-workbench-native-pages-version={WORKBENCH_CORE_VERSION}
      aria-label="Workbench 版本信息">
      <article className={css.versionCard} data-workbench-version-card="core">
        <div className={css.versionCardHeading}><h3>Workbench Core</h3><span className={css.badge} data-tone="success">当前运行</span></div>
        <strong className={css.versionNumber}>{WORKBENCH_CORE_VERSION}</strong>
        <span className={css.subtle}>dsh-bay</span>
      </article>
      <article className={css.versionCard} data-workbench-version-card="native-pages">
        <div className={css.versionCardHeading}><h3>默认 DSH 原生内页</h3><span className={css.badge}>随 Core 交付</span></div>
        <strong className={css.versionNumber}>{WORKBENCH_CORE_VERSION}</strong>
        <span className={css.subtle}>没有单独安装包 · 适配 DSH {WORKBENCH_DSH_GENERATION}</span>
      </article>
    </section>
    <p className={css.viewDescription}>官方内置模块复用 DSH 原生能力；功能扩展模块才提供 DSH 原版之外的能力。DSH 原生插件管理负责安装、更新、启停与卸载，Workbench 只展示验证结果和入口偏好。</p>
    <nav role="tablist" aria-label="扩展管理视图" className={css.viewTabs}>
      {(Object.keys(viewTitles) as Array<keyof typeof viewTitles>).map(key => {
        const count = key === 'installable' ? (inventoryNeedsInstall ? 1 : 0) : key === 'installed' ? (inventory?.profilePresence === 'present' ? 1 : 0) : undefined
        return <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? css.viewTabActive : css.viewTab} onClick={() => setView(key)}>{viewTitles[key]}{count === undefined ? null : <span className={css.viewCount}>{count}</span>}</button>
      })}
    </nav>
    <p className={css.viewDescription}>{viewDescription}</p>
    {!snapshot.restartErrorCode && (snapshot.restartPending || snapshot.restartStatus) ? <div className={css.notice} role="status">
      {snapshot.restartStatus ? workbenchRestartMessage(snapshot.restartStatus) : '正在重新连接 DSH 并恢复重启状态…'}
      {snapshot.restartStatus ? <details><summary>操作详情</summary><div>事务 ID：{snapshot.restartStatus.transactionId}</div><div>重启操作 ID：{snapshot.restartStatus.operationId}</div></details> : null}
    </div> : null}
    {message === undefined ? null : <div className={css.notice} data-tone={message.error ? 'error' : 'success'} role={message.error ? 'alert' : 'status'}>{message.text}</div>}
    {snapshot.error === undefined ? null : <div className={css.notice} data-tone="error" role="alert">{snapshot.restartErrorCode === undefined ? localizeUiError(snapshot.error) : new WorkbenchRestartError(snapshot.restartErrorCode).message}</div>}
    {moduleManager === undefined ? <div className={css.notice} role="status">当前 DSH 未提供模块安装服务。</div> : null}
    {view === 'catalog' ? <section className={css.moduleKinds} aria-label="模块类别">
      <div className={css.moduleKind} data-module-kind="official-builtin"><div><h3>官方内置模块</h3><p>随 Workbench Core 提供，复用 DSH 原生会话、对话和轨迹能力。它们不是社区扩展，不通过 npm / Git 直接来源安装。</p></div><span className={css.kindCount}>{officialCatalogEntries.length || (officialInventory.length > 0 ? officialInventory.length : coreNativeReady ? 1 : 0)} 项</span></div>
      <div className={css.moduleKind} data-module-kind="extension"><div><h3>功能扩展模块</h3><p>在 DSH 原版能力之外增加功能的容器内页，未来通过受信 Catalog 管理。当前目录中有 {extensionCatalogEntries.length} 项。</p></div><span className={css.kindCount}>{extensionCatalogEntries.length} 项</span></div>
    </section> : null}
    {!viewVisible ? <div className={css.empty} role="tabpanel"><h3>当前视图暂无扩展</h3><p>{view === 'installable' ? '当前没有可安装的功能扩展；官方内置能力已随 Core 提供。' : 'Profile 和受信目录中没有符合此视图的模块。'}</p></div> : view === 'trust' ? <section className={css.trustPanel} role="tabpanel">
      <h3>来源与信任</h3><p>官方内置模块随 Core 的受信发布一起交付；功能扩展只接受完整签名目录或离线包。浏览器不会直接编辑信任根。</p>
      <dl><div><dt>目录状态</dt><dd>{snapshot.catalogId === undefined ? '尚未导入' : '已验证并保存'}</dd></div><div><dt>Catalog ID</dt><dd><code>{snapshot.catalogId ?? '—'}</code></dd></div><div><dt>发布者 Key ID</dt><dd>{WORKBENCH_TEAM_TRUST_ROOT_V1.keyId}</dd></div><div><dt>DSH 代际</dt><dd>{suite?.signedCatalog?.dshGeneration ?? WORKBENCH_DSH_GENERATION}</dd></div><div><dt>撤销状态</dt><dd>{suite?.signedCatalog?.revoked ? '已撤销' : suite === undefined ? '未知' : '未撤销'}</dd></div></dl>
      <div className={css.trustActions}><button className={css.command} type="button" disabled={busy || moduleManager === undefined} onClick={() => fileInput.current?.click()}><IconFolderOpenOutlineMedium />重新导入签名目录</button>{onShare === undefined ? null : <button className={css.command} type="button" disabled={busy} onClick={() => onShare('import')}><IconShareOutlineMedium />导入离线包</button>}</div>
      {moduleManager?.installDirectSource === undefined || snapshot.host?.directSourceAvailable !== true || extensionCatalogEntries.length === 0 ? null : <details className={css.directSource}><summary>高级安装：功能扩展 npm / Git 直接来源</summary><p className={css.subtle}>仅用于 DSH 原版之外的功能扩展。你必须明确选择来源；Host 会固定版本或 commit，校验包内清单，并在真实重启后验证，来源不会自动进入公共目录。</p><label>来源类型<select value={directKind} onChange={event => setDirectKind(event.target.value as 'npm' | 'git')}><option value="npm">npm</option><option value="git">Git（HTTPS）</option></select></label>{directKind === 'npm' ? <label>包名<input value={directPackage} onChange={event => setDirectPackage(event.target.value)} placeholder="@scope/package" /></label> : <><label>仓库地址<input value={directPackage} onChange={event => setDirectPackage(event.target.value)} placeholder="https://github.com/example/module.git" /></label><label>分支、标签或 commit<input value={directRef} onChange={event => setDirectRef(event.target.value)} placeholder="v1.2.3 或 commit" /></label></>}<button type="button" className={css.command + ' ' + css.primary} disabled={busy || directPackage.trim() === '' || (directKind === 'git' && directRef.trim() === '')} onClick={() => { void run(async () => { const source: WorkbenchModuleSourceRequestV1 = directKind === 'npm' ? { kind: 'npm', packageName: directPackage.trim() } : { kind: 'git', repository: directPackage.trim(), ref: directRef.trim() }; await moduleManager.installDirectSource!(source); setMessage({ text: '直接来源已暂存，请重启 DSH 完成验证。' }) }) }}>校验并安装直接来源</button></details>}
    </section> : view === 'catalog' && coreNativeReady && inventory?.profilePresence !== 'present' ? <section className={css.moduleList} role="tabpanel" aria-label="Workbench 官方内置能力">
      <h3>Workbench Core 官方内置</h3>
      <p className={css.subtle}>以下容器内页直接复用 DSH {WORKBENCH_DSH_GENERATION} 原生能力，随 Core 一起提供，不需要单独安装或导入 Conversation Suite。</p>
      <article className={css.module} data-workbench-module-identity="workbench.core">
        <div className={css.moduleSummary}><span className={css.moduleIcon}><IconCordisPluginOutlineMedium size={24} /></span><div className={css.moduleName}><h3>DSH 原生会话工作台</h3><span className={css.subtle}>Core 内置 · {liveEditors.filter(editor => nativeConversationEditorIds.has(editor.id)).length} 个容器内页</span></div><span className={css.badge} data-tone="success"><IconCheckOutlineMedium />随 Core 已就绪</span></div>
        <dl className={css.trust}><div><dt>能力来源</dt><dd>DSH 原生 Session、Conversation、Trajectory</dd></div><div><dt>Workbench 责任</dt><dd>Area、布局、入口显示和绑定生命周期</dd></div><div><dt>安装方式</dt><dd>随 dsh-bay 交付</dd></div></dl>
        <p className={css.notice}>会话数据、Composer、工作区选择和轨迹视图由 DSH 原生实现；Workbench 不复制运行时，也不把它们作为社区扩展安装。</p>
        {suite !== undefined ? <p className={css.notice} data-tone="warning">当前受信目录中的 Conversation Suite 是历史迁移包，仅用于旧 Profile 的验证、认领和修复；全新 Profile 不需要安装它。</p> : null}
      </article>
    </section> : identity === undefined && otherInventory.length === 0 && extensionCatalogEntries.length === 0 ? <div className={css.empty}>
      <span className={css.emptyIcon}><IconCordisPluginOutlineMedium size={28} /></span><h3>暂无团队内页模块</h3><p>尚未导入团队目录</p>
      {onShare === undefined ? null : <button className={css.command} type="button" onClick={() => onShare('import')}><IconShareOutlineMedium />导入工作台离线包</button>}
    </div> : identity === undefined ? <section className={css.moduleList} role="tabpanel" aria-label="Profile 中的其他扩展">
      <h3>功能扩展模块</h3>
      <p className={css.subtle}>这些模块由 Host 根据 Profile 实际内容投影。Workbench 不会因为目录条目存在就假定它们可安装。</p>
      {extensionCatalogEntries.map(entry => <article className={css.module} key={`catalog-${entry.moduleId}`} data-workbench-module-identity={entry.moduleId}>
        <div className={css.moduleSummary}><span className={css.moduleIcon}><IconCordisPluginOutlineMedium size={24} /></span><div className={css.moduleName}><h3>{entry.moduleId}</h3><span className={css.subtle}>功能扩展 · {entry.version}</span></div><span className={css.badge} data-tone="neutral">受信目录条目</span></div>
        <dl className={css.trust}><div><dt>模块类别</dt><dd>功能扩展模块</dd></div><div><dt>安装身份</dt><dd><code>{entry.artifactDigest}</code></dd></div><div><dt>来源</dt><dd>签名 Catalog</dd></div></dl>
        <p className={css.notice}>此条目属于 DSH 原版之外的功能扩展。当前实验版先完成分类和信任投影，安装事务会在扩展 Host API 完成后开放。</p>
      </article>)}
      {otherInventory.map(item => <article className={css.module} key={item.moduleId} data-workbench-module-identity={item.moduleId}>
        <div className={css.moduleSummary}><span className={css.moduleIcon}><IconCordisPluginOutlineMedium size={24} /></span><div className={css.moduleName}><h3>{item.moduleId}</h3><span className={css.subtle}>{item.packageName}</span></div>
          <span className={css.badge} data-tone={item.activation === 'active' ? 'success' : item.ownership === 'owned' ? 'warning' : 'error'}>{item.kind === 'official-builtin' ? '官方内置' : item.activation === 'active' ? '已激活' : item.ownership === 'owned' ? '需要处理' : '外部安装'}</span></div>
        <dl className={css.trust}><div><dt>Profile 状态</dt><dd>{item.profilePresence === 'present' ? '已存在' : '不存在'}</dd></div><div><dt>Workbench 所有权</dt><dd>{item.ownership === 'owned' ? '已接管' : item.ownership === 'unowned' ? '未接管' : item.ownership}</dd></div><div><dt>运行状态</dt><dd>{item.activation}</dd></div><div><dt>信任</dt><dd>{item.trust ?? '未知'}</dd></div>{item.diagnosticCode === undefined ? null : <div><dt>诊断</dt><dd>{item.diagnosticCode}</dd></div>}</dl>
        {item.allowedActions.includes('external-uninstall-required') ? <p className={css.notice} data-tone="error">当前 Profile 中存在其他来源安装的同名扩展。请使用原安装来源卸载或升级，Workbench 不会覆盖它。</p> : null}
      </article>)}
    </section> : <>
      <div className={css.categoryHeading}><h3>官方内置模块</h3><span className={css.subtle}>复用 DSH 原生能力，Workbench 只管理布局入口和验证状态</span></div>
      <section className={css.module} data-workbench-module-identity={identity.moduleId}>
        <div className={css.moduleSummary}>
          <span className={css.moduleIcon}><IconCordisPluginOutlineMedium size={24} /></span>
          <div className={css.moduleName}><h3>{legacySuiteInProfile ? 'DSH 原生会话工作台' : 'Conversation Suite'}</h3><span className={css.subtle}>{legacySuiteInProfile ? 'Core 内置 · 历史 Suite 包已留存' : `${identity.version} · ${pages.length} 个容器内页`}</span></div>
          <span className={css.badge} data-tone={active ? 'success' : restart ? 'warning' : profileConflict || repair || installedConflict ? 'error' : 'neutral'} data-module-status>{active ? <IconCheckOutlineMedium /> : null}{label}</span>
          {!legacySuiteInProfile && inventoryNeedsClaim && !suiteIsOfficialBuiltin ? <button type="button" className={css.command + ' ' + css.primary} disabled={busy || restart}
            onClick={() => { void run(async () => { await moduleManager!.claim('workbench.conversation-suite'); setMessage({ text: '包身份已验证并认领，请重启 DSH 完成激活。' }) }) }}><IconCheckOutlineMedium />验证并认领</button>
            : !legacySuiteInProfile && !active && !profileConflict && (!suiteIsOfficialBuiltin || officialNeedsProvision) ? <button type="button" className={css.command + ' ' + css.primary} disabled={busy || plan?.status !== 'ready' || restart || (!inventoryNeedsInstall && !officialNeedsProvision && !inventory?.allowedActions.includes('repair'))}
            onClick={() => { void run(async () => {
              const result = await moduleManager!.install('workbench.conversation-suite')
              setMessage({ text: result.state === 'active' ? '官方内置组件已激活。' : '官方内置组件已交付，请重启 DSH。' })
            }) }}><IconDownloadOutlineMedium />{suiteIsOfficialBuiltin ? '补齐官方内置组件' : repair ? '修复功能扩展' : '安装功能扩展'}</button> : null}
        </div>
        {restart ? <div className={css.notice} data-tone="warning" role="status"><IconRefreshOutlineMedium /><div><strong>等待重启 DSH</strong><p>新增或修复的内页尚未激活；重启不会删除布局和已有工作台配置。</p>
          {moduleManager?.restartAvailability === 'available' && (snapshot.restartRequiredTransaction?.transactionId ?? snapshot.host?.restartTransactionId) !== undefined
            ? <button className={css.command + ' ' + css.primary} type="button" disabled={busy} onClick={requestRestart}>一键安全重启</button>
            : <p className={css.subtle}>{moduleManager?.restartAvailability === 'busy' ? '已有操作正在进行，请等待当前操作完成。' : moduleManager?.restartAvailability === 'transaction-missing' ? '当前安装事务没有可用的重启标识，请先刷新或恢复事务状态。' : moduleManager?.restartAvailability === 'supervisor-owned' ? '当前实例由其他宿主进程管理，请从宿主控制面板执行重启。' : moduleManager?.restartAvailability === 'debugger-attached' ? '调试模式不支持一键安全重启，请手动重启实例。' : '当前启动方式不支持一键安全重启。请先关闭此 DSH 实例，再使用相同 Profile 重新启动，然后返回此处继续验证。'}</p>}
        </div></div> : null}
        {profileConflict && !inventoryNeedsClaim ? <div className={css.notice} data-tone="error" role="alert">当前 Profile 已存在未由 Workbench 管理的内页模块，无法直接接管。请使用原安装来源修复，或在干净 Profile 中重新安装。</div> : null}
        {inventory?.nativeRuntime === 'disabled' ? <div className={css.notice} data-tone="warning" role="status">此官方内置模块已由 DSH 原生插件管理停用。请在 DSH 原生插件管理中启用并按提示重启；Workbench 不会在这里重复提供启停按钮。</div> : null}
        {legacySuiteInProfile ? <div className={css.notice} data-tone="warning" role="status">当前会话能力已由 Core 内置并直接使用 DSH 原生实现。Profile 中的 Conversation Suite 是历史残留，Workbench 不会重复安装、覆盖或通过此页启停它。</div> : null}
        {suiteIsOfficialBuiltin && inventory?.profilePresence !== 'present' && !coreNativeReady ? <div className={css.notice} data-tone="warning" role="status">此模块属于 Workbench 官方内置交付，不是社区扩展。当前 Core 官方发行单元尚未带齐它，可以补齐官方组件；这里不会把它当作 Catalog/npm/Git 扩展安装。</div> : null}
        {inventory?.diagnosticCode === 'profile-identity-conflict' ? <div className={css.notice} data-tone="error" role="alert">当前 Profile 中存在其他来源安装的同名扩展。Workbench 不会覆盖它，请使用原安装来源卸载或升级后返回此处重新检查。</div> : null}
        {inventoryNeedsClaim && !suiteIsOfficialBuiltin ? <div className={css.notice} data-tone="warning" role="status">发现同名功能扩展。请先验证包身份并认领，Workbench 不会重复安装或覆盖现有文件。</div> : null}
        {plan?.status === 'blocked' && !profileConflict ? <div className={css.notice} data-tone="error" role="status">{workbenchUserError(suite?.signedCatalog?.revoked ? 'catalog-revoked' : 'module-incompatible').message}</div> : null}
        <details className={css.trust}><summary>模块身份、权限与来源</summary><dl>
          <div><dt>模块</dt><dd>{identity.moduleId}</dd></div>
          <div><dt>包名</dt><dd>{inventory?.packageName ?? suite?.signedCatalog?.packageName ?? '—'}</dd></div>
          <div><dt>模块类别</dt><dd>官方内置 · DSH 原生能力复用</dd></div>
          <div><dt>DSH 原生运行</dt><dd>{inventory?.nativeRuntime === 'enabled' ? '已启用' : inventory?.nativeRuntime === 'disabled' ? '已停用（请在 DSH 原生插件管理中启用）' : inventory?.nativeRuntime === 'restart-required' ? '等待重启' : '未确认'}</dd></div>
          <div><dt>来源</dt><dd>{inventory?.source?.kind ?? (suite === undefined ? '未知' : 'official-builtin')}</dd></div>
          <div><dt>信任</dt><dd>{inventory?.trust ?? (suite === undefined ? '未知' : 'catalog-verified')}</dd></div>
          <div><dt>SHA-256</dt><dd><code>{identity.artifactDigest}</code></dd></div>
          <div><dt>权限</dt><dd>{suite?.signedCatalog?.permissions.join(', ') ?? '目录待验证'}</dd></div>
          <div><dt>团队目录</dt><dd data-catalog-state={suite === undefined ? 'missing' : 'verified'}>{snapshot.catalogId ?? '尚未导入'}</dd></div>
          <div><dt>发布者</dt><dd>{WORKBENCH_TEAM_TRUST_ROOT_V1.keyId}</dd></div>
          <div><dt>DSH 代际</dt><dd>{suite?.signedCatalog?.dshGeneration ?? WORKBENCH_DSH_GENERATION}</dd></div>
          <div><dt>所需能力</dt><dd>{suite?.requires.capabilities.join(', ') ?? '目录待验证'}</dd></div>
          <div><dt>上游</dt><dd><code>{suite?.signedCatalog?.provenance.upstreamCommit}</code></dd></div>
          <div><dt>源摘要</dt><dd><code>{suite?.signedCatalog?.provenance.sourceDigest}</code></dd></div>
          <div><dt>补丁摘要</dt><dd><code>{suite?.signedCatalog?.provenance.patchDigest}</code></dd></div>
          {installedConflict ? <div><dt>已安装身份</dt><dd>{snapshot.host?.installed?.version}<br /><code>{snapshot.host?.installed?.artifactDigest}</code></dd></div> : null}
        </dl></details>
      </section>
      <div className={css.scopeBar}>
          <div><strong>Workbench 入口显示</strong><span className={css.subtle}>适用于所有工作台和新建工作台，不会启用或停用 DSH 插件</span></div>
        <span className={css.subtle}>{pages.filter(page => liveEditors.some(editor => editor.id === page.id) && !globalHiddenEditorIds.includes(page.id)).length} / {pages.length} 个入口已显示</span>
      </div>
       <div className={css.pageHeading}><h3>管理内页入口</h3><span id={scopeId} className={css.subtle}>这里只控制 Workbench 的“添加内页”菜单显示；插件启停请使用 DSH 原生插件管理</span></div>
      <div className={css.pages}>
      {pages.map(page => <article className={css.page} key={page.id} data-module-page={page.id}>
        <div className={css.pageRow}>
          <span className={css.pageIcon} data-kind={page.preview}>{page.preview === 'trajectory' ? <IconBranchOutlineMedium /> : page.preview === 'extension' ? <IconCordisPluginOutlineMedium /> : <IconNewChatOutlineMedium />}</span>
          <div className={css.pageTitle}><h4>{page.label}</h4><span className={css.subtle}>{page.scope === 'root' ? '独立新对话' : '绑定已有会话'}</span></div>
          {(() => {
            const available = liveEditors.some(editor => editor.id === page.id && editor.scope === page.scope)
            const enabled = available && !globalHiddenEditorIds.includes(page.id)
             return <label className={css.toggle}><span>{!available ? '模块未激活' : enabled ? '入口已显示' : '入口已隐藏'}</span>
            <input type="checkbox" aria-label={'显示' + page.label} aria-describedby={scopeId} checked={enabled}
              disabled={busy || workbenchDirectory?.setGlobalEditorVisible === undefined || !coreNativeReady || !available}
              onChange={event => {
                const enabled = event.target.checked
                void run(async () => {
                  const result = await workbenchDirectory?.setGlobalEditorVisible?.(page.id, enabled)
                  if (result?.status !== 'committed') throw new Error('内页显示偏好保存失败，请重试。')
                })
              }} />
          </label>
          })()}
        </div>
        <details className={css.pageDetails}><summary><IconChevronDownOutlineMedium />内页预览</summary><PagePreview kind={page.preview} /></details>
      </article>)}</div>
      {pages.length === 0 ? <p className={css.empty}>内页预览不可用</p> : null}
       {onShare === undefined ? null : <footer className={css.sectionFooter}><span className={css.subtle}>这里的偏好对所有工作台生效；正在使用的标签不会被关闭，只会影响之后添加的入口。</span>
        <button className={css.command} type="button" disabled={busy} onClick={() => onShare('export')}><IconShareOutlineMedium />分享工作台布局</button></footer>}
    </>}
  </section>
}
