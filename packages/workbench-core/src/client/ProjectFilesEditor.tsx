import { useWorkbenchLocale } from '../foundation/workbench-locale.ts'
import { useEffect, useState } from 'react'
import { WORKBENCH_DIRECTORY_ROUTE } from '../workbench-directory-contract.ts'
import { WorkbenchPageLoading } from '../foundation/WorkbenchPageLoading.tsx'

interface Listing { project: string; truncated?: boolean; entries: { name: string; relativePath: string; kind: 'directory' | 'file' | 'unavailable' }[] }
/** Project files are available before the first conversation exists. */
export function ProjectFilesEditor({ workbenchId, areaId, projectId }: { workbenchId?: string | undefined; areaId?: string | undefined; projectId?: string | undefined }) {
  const { t } = useWorkbenchLocale()
  const [path, setPath] = useState(''), [listing, setListing] = useState<Listing>(), [error, setError] = useState('')
  const [preview, setPreview] = useState<{ path: string; text?: string; truncated?: boolean }>(), [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const request = async <T,>(action: string, relativePath: string, signal: AbortSignal): Promise<T> => {
    const response = await fetch(WORKBENCH_DIRECTORY_ROUTE, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ action, workbenchId, areaId, projectId, relativePath }) })
    const result = await response.json() as { value: T; error?: string }
    if (!response.ok) throw new Error(result.error ?? t('editor.projectFilesUnreadable'))
    return result.value
  }
  useEffect(() => { setPath(''); setPreview(undefined) }, [workbenchId, areaId, projectId])
  useEffect(() => {
    const controller = new AbortController()
    setError(''); setListing(undefined); setBusy(true)
    if (!workbenchId || (!areaId && !projectId)) { setBusy(false); setError(t('editor.projectFolderFirst')); return () => controller.abort() }
    void request<Listing>('project-entries', path, controller.signal).then(value => { if (!controller.signal.aborted) setListing(value) }, reason => { if (!controller.signal.aborted) setError(String(reason.message ?? reason)) }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [workbenchId, areaId, projectId, path, attempt])
  useEffect(() => {
    if (!preview) return
    const controller = new AbortController()
    void request<{ text: string; truncated: boolean }>('project-preview', preview.path, controller.signal).then(value => { if (!controller.signal.aborted) setPreview({ path: preview.path, ...value }) }, reason => { if (!controller.signal.aborted) setError(String(reason.message ?? reason)) })
    return () => controller.abort()
  }, [preview?.path, workbenchId, areaId, projectId])
  const button = { border: '1px solid var(--dsw-alias-border-l3)', background: 'transparent', color: 'inherit', borderRadius: 6, padding: '5px 9px', cursor: 'pointer' } as const
  return <section aria-label={t('editor.workbench.workspace-files')} style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)' }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 10, borderBottom: '1px solid var(--dsw-alias-border-l3)' }}>
      <button style={button} disabled={!path && !preview} onClick={() => preview ? setPreview(undefined) : setPath(path.split('/').slice(0, -1).join('/'))}>{t('editor.back2')}</button>
      <span style={{ flex: 1, overflowWrap: 'anywhere', fontSize: 12 }}>{listing?.project ?? t('editor.workbench.workspace-files')}{path ? ' / ' + path : ''}</span>
      <button style={button} disabled={busy} onClick={() => { setPreview(undefined); setAttempt(value => value + 1) }}>{t('editor.refresh')}</button>
    </div>
    {error ? <p role="alert" style={{ padding: 12 }}>{error}</p> : null}
    {busy ? <WorkbenchPageLoading label={t('editor.workbench.workspace-files')} icon="folder" /> : null}
    {listing?.truncated ? <p role="status" style={{ padding: 12 }}>{t('editor.showingTheFirst2000EntriesIn')}</p> : null}
    {busy ? null : preview ? preview.text === undefined && !error ? <WorkbenchPageLoading label={t('editor.workbench.document-preview')} icon="file-preview" /> : <div style={{ overflow: 'auto', padding: 12 }}><strong>{preview.path}</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{preview.text}</pre>{preview.truncated ? <p>{t('editor.showingTheFirst256KbOfThis')}</p> : null}</div>
      : <div style={{ overflow: 'auto', padding: 8 }}>{listing?.entries.length === 0 ? <p>{t('editor.thisFolderIsEmptyStartAConversation')}</p> : null}{listing?.entries.map(entry => <button key={entry.relativePath} disabled={entry.kind === 'unavailable'} style={{ ...button, display: 'block', width: '100%', textAlign: 'left', border: 0, padding: '8px 10px' }} onClick={() => { setError(''); if (entry.kind === 'directory') setPath(entry.relativePath); else setPreview({ path: entry.relativePath }) }}>{entry.kind === 'directory' ? '▸ ' : '· '}{entry.name}{entry.kind === 'unavailable' ? t('editor.targetUnavailable') : ''}</button>)}</div>}
  </section>
}
