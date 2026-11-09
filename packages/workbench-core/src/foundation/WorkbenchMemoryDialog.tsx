import { browserSafeUuid } from '../browser-safe-id.ts'
import { useEffect, useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkbenchDirectory } from './frame-settings-adapter.ts'
import type { WorkbenchMemoryEntry, WorkbenchMemoryWrite } from '../workbench-memory-contract.ts'
import css from './WorkbenchHome.module.css'

export function WorkbenchMemoryDialog({ directory, workbenchId, onClose }: { directory: WorkbenchDirectory; workbenchId: string; onClose(): void }) {
  const [entries, setEntries] = useState<WorkbenchMemoryEntry[]>([])
  const [selected, setSelected] = useState<{ entry: WorkbenchMemoryEntry; body: string }>()
  const [title, setTitle] = useState(''), [summary, setSummary] = useState(''), [body, setBody] = useState('')
  const [query, setQuery] = useState(''), [error, setError] = useState<string>(), [busy, setBusy] = useState(false)
  const refresh = async () => setEntries(await directory.memoryRequest!({ action: 'memory-list', workbenchId, query }))
  useEffect(() => { let live = true
    void directory.memoryRequest!<WorkbenchMemoryEntry[]>({ action: 'memory-list', workbenchId, query })
      .then(rows => { if (live) setEntries(rows) }).catch(reason => { if (live) setError(String(reason)) })
    return () => { live = false }
  }, [directory, workbenchId, query])
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
        ...(selected?.entry.areaId ? { areaId: selected.entry.areaId } : {}) }
      const result = await directory.memoryRequest!<{ status: string; entry: WorkbenchMemoryEntry; body: string }>({ action: 'memory-write', workbenchId, entry })
      if (result.status !== 'committed') throw new Error('记忆已更新，请重新选择当前版本后编辑。')
      setSelected(removed ? undefined : result); if (removed) { setTitle(''); setSummary(''); setBody('') }
      await refresh()
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title="工作台专属记忆" closeLabel="关闭">
    <div className={css.wizard}>
      <div className={css.wizardBody}>
        <p>记忆保存在当前工作台文件夹中。每次修改保留来源和修订记录，并随完整工作台包导出。</p>
        <Input aria-label="搜索记忆" placeholder="搜索标题或摘要" value={query} onChange={event => setQuery(event.target.value)} />
        <div aria-label="记忆列表">{entries.map(entry => <Button key={entry.id} disabled={busy} onClick={() => { void load(entry.id) }}>{entry.title} · {entry.verification === 'verified' ? '已核验' : entry.verification === 'candidate' ? '待核验' : '需重新核验'}</Button>)}</div>
        <Button disabled={busy} onClick={() => { setSelected(undefined); setTitle(''); setSummary(''); setBody('') }}>新增记忆</Button>
        {selected ? <p>修订 {selected.entry.revision} · 来源：{selected.entry.source.description}（{selected.entry.source.reference}）
          {selected.entry.revision > 1 ? <Button disabled={busy} onClick={() => { void load(selected.entry.id, selected.entry.revision - 1) }}>上一修订</Button> : null}
          <Button disabled={busy} onClick={() => { void load(selected.entry.id) }}>当前修订</Button>
        </p> : null}
        <label>标题<Input value={title} maxLength={160} disabled={busy} onChange={event => setTitle(event.target.value)} /></label>
        <label>简短摘要<textarea value={summary} maxLength={1200} disabled={busy} onChange={event => setSummary(event.target.value)} rows={3} /></label>
        <label>正文<textarea value={body} maxLength={100000} disabled={busy} onChange={event => setBody(event.target.value)} rows={12} /></label>
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <footer className={css.wizardActions}>
        {selected ? <Button disabled={busy} onClick={() => { void save(true) }}>移除记忆</Button> : null}
        <Button disabled={busy} onClick={onClose}>关闭</Button>
        <Button variant="primary" disabled={busy || !title.trim()} onClick={() => { void save() }}>{busy ? '正在保存…' : '确认并保存'}</Button>
      </footer>
    </div>
  </Modal>
}
