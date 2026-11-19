import { useWorkbenchLocale } from './workbench-locale.ts'
import { IconCheckOutlineMedium, IconPanelLeftOutlineMedium, IconCordisPluginOutlineMedium, IconLinkOutlineMedium } from '@deepseek-ai/dsh-client-ui-primitives'
import { areasOf, type WorkbenchNodeV3 } from './document-v3.ts'
import { WORKBENCH_CONVERSATION_PAGE_METADATA } from '../conversation-page-metadata.ts'
import type { WorkbenchOfflinePackageV1 } from '../offline-package.ts'
import css from './WorkbenchModuleManagerSection.module.css'

export function WorkbenchTransferSteps({ labels, current, complete = false }: { labels: readonly string[]; current: number; complete?: boolean }) {
  const { t } = useWorkbenchLocale()
  return <ol className={css.steps} aria-label={t('share.offlinePackageProgress')}>{labels.map((label, index) => <li key={label}
    data-step={index < current || complete ? 'done' : index === current ? 'current' : 'pending'} aria-current={!complete && index === current ? 'step' : undefined}>
    <span className={css.stepNumber} aria-hidden="true">{index < current || complete ? <IconCheckOutlineMedium /> : index + 1}</span><span>{label}</span>
  </li>)}</ol>
}

function Layout({ node }: { node: WorkbenchNodeV3 }) {
  const { t } = useWorkbenchLocale()
  if (node.kind === 'split') return <div className={css.layoutSplit} style={node.axis === 'horizontal'
    ? { gridTemplateColumns: `${node.ratio}fr ${1 - node.ratio}fr` } : { gridTemplateRows: `${node.ratio}fr ${1 - node.ratio}fr` }}>
    <Layout node={node.first} /><Layout node={node.second} />
  </div>
  const module = node.moduleHistory.find(row => row.moduleInstanceId === node.activeModuleInstanceId) ?? node.moduleHistory[0]
  const label = WORKBENCH_CONVERSATION_PAGE_METADATA.find(page => page.id === module?.editorId)?.label ?? t('share.emptyArea')
  return <div className={css.layoutArea}><IconPanelLeftOutlineMedium /><span>{label}</span></div>
}

/** The same immutable package facts are reviewed before import and download. */
export function WorkbenchTransferPreview({ pkg }: { pkg: WorkbenchOfflinePackageV1 }) {
  const { t } = useWorkbenchLocale()
  const areas = areasOf(pkg.layout.document.root)
  const editors = new Set(areas.flatMap(area => area.moduleHistory.map(module => module.editorId)))
  const permissions = [...new Set(pkg.catalog?.entries.flatMap(entry => entry.signedCatalog?.permissions ?? []) ?? [])]
  return <div className={css.packageReview} data-offline-package-preview>
    <div className={css.reviewHeading}><div><h3>{pkg.layout.name}</h3>{pkg.layout.description ? <p>{pkg.layout.description}</p> : null}</div>
      <span className={css.badge} data-tone="success"><IconCheckOutlineMedium />{t('share.preflightPassed')}</span></div>
    <div className={css.reviewGrid}>
      <div className={css.offlinePreview} aria-label={t('share.offlineWorkbenchLayoutPreview')}><Layout node={pkg.layout.document.root} /></div>
      <div className={css.reviewFacts}>
        <div className={css.factRow}><IconPanelLeftOutlineMedium /><span>{t('share.workbenchLayout')}</span><strong>{areas.length} {t('share.areas')}</strong></div>
        <div className={css.factRow}><IconCordisPluginOutlineMedium /><span>{t('share.pageModules')}</span><strong>{t('share.entryCount', { count: pkg.manifest.modules.length })}</strong></div>
        <div className={css.factRow}><IconLinkOutlineMedium /><span>{t('share.recipientBindings')}</span><strong>{t('share.bindingCount', { count: pkg.layout.bindings.length })}</strong></div>
        <div className={css.miniPages}>{WORKBENCH_CONVERSATION_PAGE_METADATA.filter(page => editors.has(page.id)).map(page => <div key={page.id}>
          <span>{page.label}</span><small>{pkg.layout.hiddenEditorIds.includes(page.id) ? t('share.hiddenInTheMenu') : t('share.shownInTheMenu')}</small></div>)}</div>
      </div>
    </div>
    <div className={css.packageContents}>
      <div><span className={css.muted}>{t('transfer.packageContents')}</span><p>{t('share.layoutPageVisibilityPreferencesAndPortableSettings')}{pkg.manifest.modules.length > 0 ? t('share.originalTeamDirectoryAndModuleArtifacts') : ''}</p></div>
      <div><span className={css.muted}>{t('share.destinationEnvironment')}</span><p>Core {pkg.manifest.core.version} · DSH {pkg.manifest.dsh.generation}</p></div>
      <div><span className={css.muted}>{t('share.modulePermissions')}</span><p>{permissions.length === 0 ? t('share.noAdditionalPermissions') : permissions.map(permission => permission === 'dsh.conversation.render' ? t('share.renderConversationsAndRelatedPages') : permission).join('、')}</p></div>
    </div>
    <div className={css.privacyNote}><IconCheckOutlineMedium /><span>{t('share.doesNotIncludeConversationHistoryAttachmentsCredentials')}</span></div>
    <details className={css.trust}><summary>{t('share.moduleIdentityAndPackageValidation')}</summary><dl>
      {pkg.manifest.modules.map(module => <div key={module.moduleId}><dt>Conversation Suite</dt><dd>{module.version}<br /><code>{module.artifactDigest}</code></dd></div>)}
      <div><dt>{t('share.packageId')}</dt><dd><code>{pkg.packageId}</code></dd></div>
      <div><dt>{t('share.archiveSize')}</dt><dd>{(pkg.archive.byteLength / 1024 / 1024).toFixed(2)} MiB</dd></div>
      {permissions.length === 0 ? null : <div><dt>{t('share.declaredPermissions')}</dt><dd>{permissions.join(', ')}</dd></div>}
    </dl></details>
  </div>
}
