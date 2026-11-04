import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const root = path.join(os.tmpdir(), 'dsh-bay-172-isolated')
const artifacts = JSON.parse(await fs.readFile(path.join(root, 'current-artifacts.json'), 'utf8'))
const { workbenchExtensionContractFingerprint } = createRequire(import.meta.url)(path.join(root, 'qa-contract.cjs'))
const action = process.argv[2] ?? 'inspect'
const receiver = action.startsWith('receiver')
const port = receiver ? 19273 : 19272
if (!process.env.DSH_QA_TOKEN) throw new Error('Provide isolated Profile launch token')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true })
const blocked = []
await context.route('**/*', route => {
  const u = new URL(route.request().url())
  if (['127.0.0.1', 'localhost'].includes(u.hostname) || ['data:', 'blob:'].includes(u.protocol)) return route.continue()
  blocked.push(u.origin); return route.abort()
})
const page = await context.newPage()
page.on('pageerror', error => console.error('Page error:', error.message))
async function rpc(method, args = {}) {
  return page.evaluate(async ({ method, args }) => {
    const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    return response.json()
  }, { method, args })
}
async function settings() {
  const reply = await rpc('settings/describe')
  return reply.result.value.namespaces.find(n => n.ns === 'workbench-layout')
}
async function settle() {
  await page.waitForTimeout(2200)
  const button = page.getByRole('button', { name: '继续', exact: true })
  await button.waitFor({timeout:5000}).catch(()=>{})
  if (await button.isVisible().catch(() => false)) await button.click()
  await page.waitForTimeout(1200)
  await page.getByText('开始使用', {exact:true}).waitFor({timeout:5000}).catch(()=>{})
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
}
async function home() {
  const tab = page.getByRole('tab', { name: '工作台总览', exact: true })
  if (await tab.isVisible()) await tab.click()
  else {
    const enter=page.getByRole('button',{name:'进入工作台模式',exact:true})
    if(await enter.isVisible()){await enter.click();await settle();await page.getByRole('tab',{name:'工作台总览',exact:true}).click();return}
    const mode = page.getByText('Workbench', { exact: true })
    if (await mode.isVisible().catch(() => false)) await mode.click()
  }
}
try {
  await page.goto('http://127.0.0.1:' + port + '/?token=' + process.env.DSH_QA_TOKEN)
  await settle()
  if (action === 'sender-seed') {
    const d = await settings(), value = d.value
    const pageFor = (id, editor, acknowledged) => ({ moduleInstanceId: id, editorId: editor, editorScope: 'root', lastKnownTitle: id, state: { schemaVersion: 1, acknowledged } })
    const document = { version: 3, activeAreaId: 'qa-left', root: { kind: 'split', id: 'qa-split', axis: 'horizontal', ratio: 0.6, first: { kind: 'area', areaId: 'qa-left', moduleHistory: [pageFor('client-background', 'qa.client', true), pageFor('client-selected', 'qa.client', false)], activeModuleInstanceId: 'client-selected' }, second: { kind: 'area', areaId: 'qa-right', moduleHistory: [pageFor('host-selected', 'qa.host', false)], activeModuleInstanceId: 'host-selected' } } }
    const consents = {}
    for (const kind of ['client', 'host']) {
      const m = JSON.parse(await fs.readFile(path.join(root, 'fixture-' + kind, 'package.json'), 'utf8')), w = m.dsh.workbench
      consents[m.name + '::' + w.moduleId] = { packageName: m.name, moduleId: w.moduleId, apiVersion: 1, editorIds: w.editorIds, allowed: true, allowedAt: Date.now(), contractFingerprint: workbenchExtensionContractFingerprint({ schemaVersion: 1, moduleId: w.moduleId, apiVersion: 1, editorIds: w.editorIds, coreCompatibility: w.coreCompatibility, dshGeneration: w.dshGeneration }, w.editors) }
    }
    const next = { ...value, version: 4, activeWorkbenchId: 'qa-full', openWorkbenchIds: ['qa-full'], workbenches: { ...value.workbenches, 'qa-full': { workbenchId: 'qa-full', name: '17.2 完整分发验收', description: 'Client + Host，两个区域、三个保留标签', tags: ['17.2'], createdAt: Date.now(), updatedAt: Date.now(), document } }, extensionConsents: { ...value.extensionConsents, ...consents } }
    const result = await rpc('settings/mutate', { ns: 'workbench-layout', ops: [{ op: 'set', path: [], value: next }], expectedRevision: d.revision })
    assert(result.result?.value, JSON.stringify(result))
    await page.reload(); await settle(); await home()
  }
  if (action === 'sender-export') {
    await home()
    const card = page.locator('article').filter({ hasText: '17.2 完整分发验收' })
    await card.getByRole('button', { name: '导出', exact: true }).click()
    await page.getByLabel('导出模式', { exact: true }).selectOption('offline-embedded')
    await page.getByRole('button', { name: '准备运行制品并生成签名预览', exact: true }).click()
    const downloadButton = page.getByRole('button', { name: '下载已核对的工作台包', exact: true })
    await downloadButton.waitFor({ timeout: 30000 })
    const pending = page.waitForEvent('download'); await downloadButton.click()
    await (await pending).saveAs(path.join(root, 'private-workbench-current.wbpkg'))
    await page.screenshot({ path: path.join(root, 'sender-current-export.png'), fullPage: true })
  }
  if (action === 'receiver-import') {
    await home()
    assert((await settings()).value.openWorkbenchIds.length === 0)
    await page.getByRole('button', { name: '导入工作台包', exact: true }).click()
    await page.getByLabel('工作台包文件').setInputFiles(path.join(root, 'private-workbench-current.wbpkg'))
    await page.getByRole('button', { name: '确认导入', exact: true }).waitFor({ timeout: 30000 })
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '确认导入', exact: true }).click()
    await page.getByText('请重启 DSH 后继续', {exact:true}).waitFor({timeout:60000})
    const result=await page.evaluate(async()=> (await (await fetch('/api/workbench/distribution/v4/history',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()).value)
    assert.equal(result[0].state,'restart-required',JSON.stringify(result))
    assert.equal(result[0].installed.length,2)
    assert.equal(Object.keys((await settings()).value.workbenches).length,0)
    await fs.writeFile(path.join(root,'receiver-install-evidence.json'),JSON.stringify({coreHash:artifacts.coreHash,result:result[0],time:new Date().toISOString()},null,2))
    await page.screenshot({ path: path.join(root, 'receiver-current-import.png'), fullPage: true })
  }
  if (action === 'receiver-continue') {
    await home(); await page.getByRole('button', { name: '导入工作台包', exact: true }).click()
    await page.getByRole('button', { name: '导入记录', exact: true }).click()
    await page.getByRole('button', { name: '查看与继续', exact: true }).first().click()
    const resume = page.getByRole('button', { name: '检查并继续此事务', exact: true })
    if (await resume.isVisible()) await resume.click()
    await page.getByRole('button', { name: '打开导入的工作台', exact: true }).waitFor({ timeout: 30000 })
    const before = await settings()
    const record = Object.values(before.value.workbenches).find(w => w.name === '17.2 完整分发验收')
    assert(record); assert(!before.value.openWorkbenchIds.includes(record.workbenchId))
    assert.equal(record.document.root.ratio, 0.6)
    assert.deepEqual(record.document.root.first.moduleHistory.map(p => p.state.acknowledged), [true, false])
    assert.equal(record.document.root.second.moduleHistory[0].state.acknowledged, false)
    assert.equal(record.document.root.first.activeModuleInstanceId, record.document.root.first.moduleHistory[1].moduleInstanceId)
    await page.getByRole('button', { name: '打开导入的工作台', exact: true }).click()
    await page.getByRole('button', { name: '记录本机状态', exact: true }).waitFor()
    await page.getByRole('button', { name: '记录本机状态', exact: true }).click()
    await page.getByRole('button', { name: '验证私有 Host 功能', exact: true }).click()
    await page.waitForTimeout(1800)
    const after = await settings(), restored = after.value.workbenches[record.workbenchId]
    assert.equal(restored.document.root.first.moduleHistory[1].state.acknowledged, true)
    assert.equal(restored.document.root.second.moduleHistory[0].state.acknowledged, true)
    await fs.writeFile(path.join(root, 'receiver-evidence.json'), JSON.stringify({ coreHash: artifacts.coreHash, before: record, after: restored, browserBlocked: blocked, time: new Date().toISOString() }, null, 2))
    await page.screenshot({ path: path.join(root, 'receiver-restored.png'), fullPage: true })
  }
  if(action==='receiver-cancel'){
    const history=await page.evaluate(async()=> (await (await fetch('/api/workbench/distribution/v4/history',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()).value)
    for(const row of history.filter(r=>r.state==='recovery-required')){
      const result=await page.evaluate(async id=>(await (await fetch('/api/workbench/distribution/v4/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactionId:id})})).json()),row.transactionId)
      assert.equal(result.value.state,'cancelled',JSON.stringify(result))
    }
  }
  if (action === 'receiver-restart-check') {
    const d = await settings(), w = Object.values(d.value.workbenches).find(w => w.name === '17.2 完整分发验收')
    assert(w);assert.equal(w.document.root.first.moduleHistory[1].state.acknowledged,true);assert.equal(w.document.root.second.moduleHistory[0].state.acknowledged,true)
    const host = await page.evaluate(async()=> (await fetch('/api/qa-private-host',{method:'POST'})).json())
    assert.equal(host.answer,42)
    console.log('Restart persistence and private Host function passed')
  }
  console.log((await page.locator('body').innerText()).slice(-13000))
} catch (error) {
  console.error((await page.locator('body').innerText()).slice(-10000))
  await page.screenshot({ path: path.join(root, action + '-error.png'), fullPage: true })
  throw error
} finally { await browser.close() }
