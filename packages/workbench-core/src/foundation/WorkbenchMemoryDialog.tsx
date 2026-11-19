import { useWorkbenchLocale } from './workbench-locale.ts'
import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchMemoryEntry, WorkbenchMemoryWrite } from '../workbench-memory-contract.ts'
import css from './WorkbenchHome.module.css'

export function WorkbenchMemoryDialog({ directory, workbenchId, projectId, onClose }: { directory: WorkbenchDirectory; workbenchId: string; projectId?: string; onClose(): void }) {
  const { t } = useWorkbenchLocale()
  const [entries, setEntries] = useState<WorkbenchMemoryEntry[]>([])
  const [selected, setSelected] = useState<{ entry: WorkbenchMemoryEntry; body: string }>()
  const [title, setTitle] = useState(''), [summary, setSummary] = useState(''), [body, setBody] = useState('')
  const [query, setQuery] = useState(''), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const forView = (rows: WorkbenchMemoryEntry[]) => projectId ? rows.filter(row => row.projectId === projectId) : rows
  const refresh = async () => setEntries(forView(await directory.memoryRequest!({ action: 'memory-list', workbenchId, query, projectId })))
  useEffect(() => { let live = true
    void directory.memoryRequest!<WorkbenchMemoryEntry[]>({ action: 'memory-list', workbenchId, query, projectId })
      .then(rows => { if (live) setEntries(forView(rows)) }).catch(reason => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [directory, workbenchId, query, projectId])
  const load = async (id: string, revision?: number) => {
    setBusy(true); setError(undefined)
    try {
      const result = await directory.memoryRequest!<{ entry: WorkbenchMemoryEntry; body: string }>({ action: 'memory-read', workbenchId, id, revision })
      setSelected(result); setTitle(result.entry.title); setSummary(result.entry.summary); setBody(result.body)
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const save = async (removed = false) => {
    setBusy(true); setError(undefined)
    try {
      const entry: WorkbenchMemoryWrite = { id: selected?.entry.id ?? browserSafeUuid(), expectedRevision: selected?.entry.revision ?? 0,
        requestId: browserSafeUuid(), title, summary, body, source: { kind: 'user', reference: 'workbench-memory-editor', description: '用户编辑确认' },
        verification: 'verified', environmentDependent: selected?.entry.environmentDependent ?? false, removed,
        ...((selected?.entry.projectId ?? projectId) ? { projectId: (selected?.entry.projectId ?? projectId)! } : {}),
        ...(selected?.entry.areaId ? { areaId: selected.entry.areaId } : {}) }
      const result = await directory.memoryRequest!<{ status: string; entry: WorkbenchMemoryEntry; body: string }>({ action: 'memory-write', workbenchId, entry })
      if (result.status !== 'committed') throw new Error(t('memory.stale'))
      setSelected(removed ? undefined : result); if (removed) { setTitle(''); setSummary(''); setBody('') }
      await refresh()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title={projectId ? t('memory.project') : t('memory.workbench')} closeLabel={t('action.close')}>
    <div className={css.wizard}>
      <div className={css.wizardBody}>
        <p>{projectId ? t('memory.projectLocation') : t('memory.overview')}{t('workspace.sourceAndRevisionHistoryAreRetainedAnd')}</p>
        <Input aria-label={t('workspace.searchMemory')} placeholder={t('workspace.searchTitlesOrSummaries')} value={query} onChange={event => setQuery(event.target.value)} />
        <div aria-label={t('workspace.memoryList')}>{entries.map(entry => <Button key={entry.id} disabled={busy} onClick={() => { void load(entry.id) }}>{entry.title} · {entry.verification === 'verified' ? t('memory.verified') : entry.verification === 'candidate' ? t('memory.pendingVerification') : t('memory.needsVerification')}</Button>)}</div>
        <Button disabled={busy} onClick={() => { setSelected(undefined); setTitle(''); setSummary(''); setBody('') }}>{t('workspace.addMemory')}</Button>
        {selected ? <p>{t('workspace.revision')} {selected.entry.revision} {t('workspace.source')}{selected.entry.source.description}（{selected.entry.source.reference}）
          {selected.entry.revision > 1 ? <Button disabled={busy} onClick={() => { void load(selected.entry.id, selected.entry.revision - 1) }}>{t('workspace.previousRevision')}</Button> : null}
          <Button disabled={busy} onClick={() => { void load(selected.entry.id) }}>{t('workspace.currentRevision')}</Button>
        </p> : null}
        <label>{t('workspace.title')}<Input value={title} maxLength={160} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
        <label>{t('workspace.shortSummary')}<textarea value={summary} maxLength={1200} disabled={busy} onChange={event => setSummary(event.target.value)} rows={3} /></label>
        <label>{t('workspace.content')}<textarea value={body} maxLength={100000} disabled={busy} onChange={event => setBody(event.target.value)} rows={12} /></label>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}>
        {selected ? <Button disabled={busy} onClick={() => { void save(true) }}>{t('workspace.removeMemory')}</Button> : null}
        <Button disabled={busy} onClick={onClose}>{t('action.close')}</Button>
        <Button variant="primary" disabled={busy || !title.trim()} onClick={() => { void save() }}>{busy ? t('project.saving') : t('memory.confirmSave')}</Button>
      </footer>
    </div>
  </Modal>
}
