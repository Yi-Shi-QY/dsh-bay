import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { FLOATING_UI_SETTINGS_NAMESPACE, FLOATING_UI_SETTINGS_ROUTE, validFloatingGeometry, type FloatingUiGeometry } from './floating-ui-settings.ts'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

/** Dedicated Profile UI namespace. Never part of Workbench Settings/export. */
export function createFloatingUiSettings(profile: string) {
  const root = join(profile, '.dsh-workbench', 'ui-settings'), path = join(root, FLOATING_UI_SETTINGS_NAMESPACE + '.json')
  const validKey = (key: string) => /^[a-zA-Z0-9_.:-]{1,160}$/u.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)
  const read = (): Record<string, Record<string, FloatingUiGeometry>> => {
    if (!existsSync(path)) return {}
    if (statSync(path).size > 2 * 1024 * 1024) throw new Error('UI preferences too large')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid UI preferences')
    return value
  }
  return {
    list(clientId: string) {
      if (!validKey(clientId)) throw new Error('Invalid client identity')
      return Object.fromEntries(Object.entries(read()[clientId] ?? {}).filter(([key, value]) => validKey(key) && validFloatingGeometry(value)))
    },
    save(clientId: string, workbenchId: string, geometry: unknown) {
      if (!validKey(clientId) || !validKey(workbenchId) || !validFloatingGeometry(geometry)) throw new Error('Invalid geometry')
      const all = read(); all[clientId] = { ...all[clientId], [workbenchId]: geometry }
      const body = JSON.stringify(all); if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('UI preferences full')
      mkdirSync(root, { recursive: true }); const temporary = join(root, randomUUID() + '.tmp')
      writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path)
    },
  }
}
export function installFloatingUiSettings(ctx: { get<T>(name: string, strict?: boolean): T | undefined }) {
  const connection = ctx.get<HostConnectionHandle>('connection', false), profile = ctx.get<{ dir: string }>('profileContext', false)
  if (!connection?.fetch || !profile?.dir) return undefined
  const store = createFloatingUiSettings(profile.dir)
  return connection.fetch.register({ path: FLOATING_UI_SETTINGS_ROUTE, methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      const reader = request.body?.getReader(); if (!reader) throw new Error('body required')
      const chunks: Uint8Array[] = []; let size = 0
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4096) { await reader.cancel(); throw new Error('too large') }; chunks.push(next.value) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || typeof body.clientId !== 'string' || Object.keys(body).some(key => !['clientId', 'workbenchId', 'geometry'].includes(key))) throw new Error('Invalid request')
      if (body.workbenchId !== undefined) { if (typeof body.workbenchId !== 'string') throw new Error('Invalid workbench'); store.save(body.clientId, body.workbenchId, body.geometry) }
      return Response.json({ value: store.list(body.clientId) }, { headers: { 'cache-control': 'no-store' } })
    } catch { return Response.json({ error: '浮动工作区位置偏好暂时无法保存。' }, { status: 400 }) }
  } })
}
