import { IconCheckOutlineMedium, IconPanelLeftOutlineMedium, IconCordisPluginOutlineMedium, IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { areasOf, type WorkbenchNodeV3 } from './document-v3.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from '../conversation-page-metadata.ts'
import type { WorkbenchOfflinePackageV1 } from '../offline-package.ts'
import css from './WorkbenchModuleManagerSection.module.css'

export function WorkbenchTransferSteps({ labels, current, complete = false }: { labels: readonly string[]; current: number; complete?: boolean }) {
  return <ol className={css.steps} aria-label="离线包处理进度">{labels.map((label, index) => <li key={label}
    data-step={index < current || complete ? 'done' : index === current ? 'current' : 'pending'} aria-current={!complete && index === current ? 'step' : undefined}>
    <span className={css.stepNumber} aria-hidden="true">{index < current || complete ? <IconCheckOutlineMedium /> : index + 1}</span><span>{label}</span>
  </li>)}</ol>
}

function Layout({ node }: { node: WorkbenchNodeV3 }) {
  if (node.kind === 'split') return <div className={css.layoutSplit} style={node.axis === 'horizontal'
    ? { gridTemplateColumns: `${node.ratio}fr ${1 - node.ratio}fr` } : { gridTemplateRows: `${node.ratio}fr ${1 - node.ratio}fr` }}>
    <Layout node={node.first} /><Layout node={node.second} />
  </div>
  const module = node.moduleHistory.find(row => row.moduleInstanceId === node.activeModuleInstanceId) ?? node.moduleHistory[0]
  const label = WORKBENCH_CONVERSATION_PAGE_METADATA.find(page => page.id === module?.editorId)?.label ?? '空容器'
  return <div className={css.layoutArea}><IconPanelLeftOutlineMedium /><span>{label}</span></div>
}

/** The same immutable package facts are reviewed before import and download. */
export function WorkbenchTransferPreview({ pkg }: { pkg: WorkbenchOfflinePackageV1 }) {
  const areas = areasOf(pkg.layout.document.root)
  const editors = new Set(areas.flatMap(area => area.moduleHistory.map(module => module.editorId)))
  const permissions = [...new Set(pkg.catalog?.entries.flatMap(entry => entry.signedCatalog?.permissions ?? []) ?? [])]
  return <div className={css.packageReview} data-offline-package-preview>
    <div className={css.reviewHeading}><div><h3>{pkg.layout.name}</h3>{pkg.layout.description ? <p>{pkg.layout.description}</p> : null}</div>
      <span className={css.badge} data-tone="success"><IconCheckOutlineMedium />预检通过</span></div>
    <div className={css.reviewGrid}>
      <div className={css.offlinePreview} aria-label="离线工作台布局预览"><Layout node={pkg.layout.document.root} /></div>
      <div className={css.reviewFacts}>
        <div className={css.factRow}><IconPanelLeftOutlineMedium /><span>工作台布局</span><strong>{areas.length} 个容器</strong></div>
        <div className={css.factRow}><IconCordisPluginOutlineMedium /><span>内页模块</span><strong>{pkg.manifest.modules.length} 个</strong></div>
        <div className={css.factRow}><IconLinkOutlineMedium /><span>接收方绑定</span><strong>{pkg.layout.bindings.length} 组</strong></div>
        <div className={css.miniPages}>{WORKBENCH_CONVERSATION_PAGE_METADATA.filter(page => editors.has(page.id)).map(page => <div key={page.id}>
          <span>{page.label}</span><small>{pkg.layout.hiddenEditorIds.includes(page.id) ? '菜单中关闭' : '菜单中启用'}</small></div>)}</div>
      </div>
    </div>
    <div className={css.packageContents}>
      <div><span className={css.muted}>包内内容</span><p>布局、内页显示偏好、可迁移配置{pkg.manifest.modules.length > 0 ? '、原始团队目录与模块制品' : ''}</p></div>
      <div><span className={css.muted}>接收环境</span><p>Core {pkg.manifest.core.version} · DSH {pkg.manifest.dsh.generation}</p></div>
      <div><span className={css.muted}>模块权限</span><p>{permissions.length === 0 ? '无额外权限' : permissions.map(permission => permission === 'dsh.conversation.render' ? '渲染对话与相关内页' : permission).join('、')}</p></div>
    </div>
    <div className={css.privacyNote}><IconCheckOutlineMedium /><span>不含聊天记录、附件内容、凭据和本机资源绑定。</span></div>
    <details className={css.trust}><summary>模块身份与包校验</summary><dl>
      {pkg.manifest.modules.map(module => <div key={module.moduleId}><dt>Conversation Suite</dt><dd>{module.version}<br /><code>{module.artifactDigest}</code></dd></div>)}
      <div><dt>包标识</dt><dd><code>{pkg.packageId}</code></dd></div>
      <div><dt>归档大小</dt><dd>{(pkg.archive.byteLength / 1024 / 1024).toFixed(2)} MiB</dd></div>
      {permissions.length === 0 ? null : <div><dt>权限声明</dt><dd>{permissions.join(', ')}</dd></div>}
    </dl></details>
  </div>
}
