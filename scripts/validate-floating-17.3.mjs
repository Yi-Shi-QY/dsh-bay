import fs from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
const output = process.env.DSH_BAY_VALIDATION_DIR
if (!output) throw new Error('Set DSH_BAY_VALIDATION_DIR to an isolated test directory')
await fs.mkdir(output, { recursive: true })
const desktop = process.env.DSH_BAY_DESKTOP === '1'
const raw = desktop ? undefined : await fs.readFile(path.join(process.env.TEMP, 'dsh-bay-tab-scroll/sidebar-diagnostic-server.log'))
const url = raw?.toString(raw[0] === 255 ? 'utf16le' : 'utf8').match(/http:\/\/127\.0\.0\.1:19274\/\?token=[^\s\u001b]+/)?.[0]
const browser = desktop ? await chromium.connectOverCDP('http://127.0.0.1:19373') : await chromium.launch({ channel: 'msedge', headless: true })
const context = desktop ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = desktop ? context.pages().find(page => !page.url().includes('welcome')) : await context.newPage(), errors = [], requests = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => { if (response.status() >= 400) requests.push({ path: new URL(response.url()).pathname, status: response.status() }) })
await page.addLocatorHandler(page.getByRole('dialog', { name: '开始使用' }), async dialog => { await dialog.getByRole('button', { name: '关闭', exact: true }).click() })
// Expose only references from the installed package. Do not substitute behavior.
const expose = body => body.replace(/(function applyWorkbenchCoreFoundation\([^\n]+\) \{)/, '$1;globalThis.__wbContext = ctx;')
  .replace('const floatingRuntime = createFloatingWorkspaceRuntime();', 'const floatingRuntime = createFloatingWorkspaceRuntime();globalThis.__floating = floatingRuntime;')
  .replace('const editorCatalog = extensionRegistry.catalog;', 'const editorCatalog = extensionRegistry.catalog;globalThis.__extensionRegistry = extensionRegistry;')
let interception
let externalBrowser, externalContext
if (desktop) {
  interception = await context.newCDPSession(page)
  await interception.send('Fetch.enable', { patterns: [{ resourceType: 'Script', requestStage: 'Response' }] })
  interception.on('Fetch.requestPaused', async event => {
    try {
      if (!event.responseStatusCode || event.responseStatusCode >= 300) return await interception.send('Fetch.continueRequest', { requestId: event.requestId })
      const response = await interception.send('Fetch.getResponseBody', { requestId: event.requestId })
      const original = response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body
      const body = expose(original)
      if (body === original) return await interception.send('Fetch.continueRequest', { requestId: event.requestId })
      await interception.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: event.responseStatusCode, responseHeaders: event.responseHeaders.filter(h => !['content-length', 'content-encoding'].includes(h.name.toLowerCase())), body: Buffer.from(body).toString('base64') })
    } catch (error) { errors.push('validation interception: ' + error.message); await interception.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {}) }
  })
} else await context.route('**/*', async route => {
  try {
    if (route.request().resourceType() !== 'script') return await route.continue()
    const response = await route.fetch({ maxRetries: 2 }); let body = await response.text()
    if (body.includes('function applyWorkbenchCoreFoundation(ctx,')) body = expose(body)
    await route.fulfill({ response, body })
  } catch (error) {
    // A popup/navigation may cancel a pending fetch. Keep failures visible
    // without leaking auth headers from Playwright's full call log.
    const message = String(error?.message ?? error).split('Call log:')[0].trim()
    errors.push('validation route: ' + message)
    await route.abort().catch(() => {})
  }
})
try {
  if (desktop) await page.reload(); else await page.goto(url)
  await page.waitForTimeout(1800)
  const next = page.getByRole('button', { name: '继续', exact: true }); if (await next.isVisible()) await next.click()
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.waitForFunction(() => !!globalThis.__wbContext)
  if (desktop && process.env.DSH_BAY_COMPANION === '1') {
    externalBrowser = await chromium.launch({ channel: 'msedge', headless: true })
    externalContext = await externalBrowser.newContext({ viewport: { width: 1440, height: 1000 } })
    await externalContext.route('**/*', async route => {
      if (route.request().resourceType() !== 'script') return route.continue()
      const response = await route.fetch()
      await route.fulfill({ response, body: expose(await response.text()) })
    })
    await page.exposeFunction('__qaLaunchCompanion', async url => {
      const companion = await externalContext.newPage()
      await companion.goto(url)
    })
    // Replace only the OS URL launcher so the test never touches a personal
    // browser profile. All other RPCs use the installed Host implementation.
    await page.evaluate(() => {
      const c = __wbContext, rpc = (c.connection ?? c.get('connection', false)).rpc
      const original = rpc.call, prepared = new Map()
      rpc.call = async function(channel, endpoint, payload, signal) {
        if (channel === '/api' && endpoint === 'workbench-window/launch') {
          const url = prepared.get(payload.windowId)
          if (!url) throw new Error('QA launcher missing prepared URL')
          await __qaLaunchCompanion(url)
          return { ok: true, value: { status: 'launched' } }
        }
        const result = await original.call(this, channel, endpoint, payload, signal)
        if (channel === '/api' && endpoint === 'workbench-window/prepare' && result.ok && result.value.url)
          prepared.set(result.value.windowId, result.value.url)
        return result
      }
      globalThis.__qaRestoreRpc = () => { rpc.call = original }
    })
  }
  await page.waitForFunction(() => Object.keys(globalThis.__wbContext.sessions.list.getSnapshot().byId).length > 0, { timeout: 10000 }).catch(() => {})
  await page.getByRole('dialog', { name: '开始使用' }).getByRole('button', { name: '关闭', exact: true }).click({ timeout: 1000 }).catch(() => {})
  const seed = await page.evaluate(async () => {
    const c = globalThis.__wbContext, form = c.configForms.get('workbench-layout'), snapshot = form.getSnapshot()
    globalThis.__backup173 = structuredClone(snapshot.value)
    const sid = c.uiSession.adapter.current.getSnapshot().key ?? Object.keys(c.sessions.list.getSnapshot().byId)[0] ?? 'session-56bee1ff-976e-4e6d-9735-1f73609631a8'
    c.uiWorkspace.openSession(sid)
    const workspace = c.workspaces.list.getSnapshot().items.find(row => row.sessionIds.includes(sid))
    const id = 'workbench-173-validation-' + Date.now(), areaId = 'area-173-validation', binding = { sessionId: sid, ...(workspace ? { workspaceId: workspace.workspaceId } : {}) }
    const record = { workbenchId: id, name: '17.3 浮动工作区验收', description: '', createdAt: Date.now(), updatedAt: Date.now(), document: { version: 3, root: { kind: 'area', areaId, areaBinding: binding, moduleHistory: [{ moduleInstanceId: 'conversation-173', editorId: 'workbench.conversation', editorScope: 'session', binding, bindingGeneration: 0, state: {}, lastKnownTitle: '对话' }], activeModuleInstanceId: 'conversation-173' }, activeAreaId: areaId } }
    const ok = await form.mutate([{ op: 'set', path: ['workbenches', id], value: record }, { op: 'set', path: ['openWorkbenchIds'], value: [id] }, { op: 'set', path: ['activeWorkbenchId'], value: id }], snapshot.revision)
    return { ok, sid, id }
  })
  assert.equal(seed.ok, true)
  await page.getByRole('button', { name: '进入工作台模式', exact: true }).click()
  await page.getByRole('tab', { name: '17.3 浮动工作区验收', exact: true }).click()
  await page.locator('[data-workbench-native-conversation]').waitFor()
  await page.locator('[data-workbench-group]').first().click({ position: { x: 100, y: 70 } })
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  const floating = page.locator('[data-workbench-floating-window]')
  if (process.env.DSH_BAY_MERGE === '1') {
    await (await import('./validate-floating-merge-17.3.mjs')).validateFloatingMerge(page, output, errors)
  } else {
  await floating.getByRole('button', { name: '添加内页', exact: true }).click()
  if (!desktop) await page.screenshot({ timeout: 5000, path: path.join(output, 'picker.png') }).catch(() => {})
  console.log('picker', await floating.getByRole('menuitem').allTextContents())
  await floating.getByRole('menuitem').filter({ hasText: '文件' }).first().click()
  await floating.locator('[data-workbench-native-area]').waitFor({ timeout: 10000 })
  await page.evaluate(() => { globalThis.__floatingElement = document.querySelector('[data-workbench-floating-window] [data-workbench-native-area]') })
  if (!desktop) await page.screenshot({ timeout: 5000, path: path.join(output, 'floating.png') }).catch(() => {})
  const initialRect = await floating.boundingBox()
  for (const edge of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
    const handle = await floating.locator('[data-floating-resize=' + edge + ']').boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2 + (edge.includes('w') ? -8 : edge.includes('e') ? 8 : 0), handle.y + handle.height / 2 + (edge.includes('n') ? -8 : edge.includes('s') ? 8 : 0), { steps: 3 }); await page.mouse.up()
  }
  assert.ok((await floating.boundingBox()).width >= initialRect.width)
  await floating.getByRole('button', { name: '最大化浮动工作区' }).click()
  await page.waitForTimeout(100)
  const canvasBox = await page.locator('[data-workbench-canvas]').boundingBox(), maxBox = await floating.boundingBox()
  assert.ok(Math.abs(maxBox.width - canvasBox.width) < 4)
  await floating.getByRole('button', { name: '还原浮动工作区' }).click()
  await page.getByRole('tab', { name: '工作台总览', exact: true }).click()
  await page.getByRole('tab', { name: '17.3 浮动工作区验收', exact: true }).click()
  assert.equal(await page.evaluate(() => document.querySelector('[data-workbench-floating-window] [data-workbench-native-area]') === globalThis.__floatingElement), true)
  await page.getByRole('button', { name: '退出工作台模式', exact: true }).last().click()
  await page.getByRole('button', { name: '进入工作台模式', exact: true }).click()
  await floating.waitFor()
  assert.equal(await page.evaluate(() => document.querySelector('[data-workbench-floating-window] [data-workbench-native-area]') === globalThis.__floatingElement), true)
  await floating.getByRole('button', { name: '最小化浮动工作区' }).click()
  await page.getByRole('button', { name: '展开浮动工作区', exact: true }).click()
  assert.equal(await page.evaluate(() => document.querySelector('[data-workbench-floating-window] [data-workbench-native-area]') === globalThis.__floatingElement), true)
  const box = await floating.locator('header').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 19); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y + 70, { steps: 8 }); await page.mouse.up()
  await floating.getByRole('button', { name: '浮动工作区菜单' }).click()
  await floating.getByRole('button', { name: '放入区域', exact: true }).click()
  await floating.getByRole('button', { name: '右侧分屏', exact: true }).first().click()
  await page.waitForFunction(() => [...globalThis.__floating.instances.values()].some(row => row.location === 'area' && row.tab.editorId === 'workbench.workspace-files'))
  assert.equal(await page.evaluate(() => document.querySelector('[data-workbench-group] [data-workbench-native-area]') === globalThis.__floatingElement), true)
  if (!desktop) await page.screenshot({ timeout: 5000, path: path.join(output, 'pinned.png') }).catch(() => {})
  if (!desktop && process.env.DSH_BAY_DETAILS === '1') {
    const { validateFloatingDetails } = await import('./validate-floating-details-17.3.mjs')
    await validateFloatingDetails(page, output)
  }
  await floating.getByRole('button', { name: '添加临时内页', exact: true }).click()
  await floating.getByRole('menuitem').filter({ hasText: '文件' }).first().click()
  const saved = await page.evaluate(() => ({ geometry: structuredClone(globalThis.__floating.workspace(globalThis.__floating.visibleWorkbenchId).rect), backup: globalThis.__backup173 }))
  if (!desktop) {
  await page.waitForTimeout(350)
  page.once('dialog', dialog => dialog.accept().catch(() => {})); await page.reload(); await page.waitForFunction(() => !!globalThis.__floating)
  await page.getByRole('dialog', { name: '开始使用' }).getByRole('button', { name: '关闭', exact: true }).click({ timeout: 1500 }).catch(() => {})
  await page.evaluate(backup => { globalThis.__backup173 = backup }, saved.backup)
  if (await page.getByRole('button', { name: '进入工作台模式', exact: true }).isVisible()) await page.getByRole('button', { name: '进入工作台模式', exact: true }).click()
  await page.getByRole('tab', { name: '17.3 浮动工作区验收', exact: true }).click()
  await page.getByRole('button', { name: '展开浮动工作区', exact: true }).waitFor()
  const restored = await page.evaluate(() => ({ geometry: globalThis.__floating.workspace(globalThis.__floating.visibleWorkbenchId).rect, count: [...globalThis.__floating.instances.values()].filter(row => row.location === 'floating').length }))
  assert.equal(restored.count, 0); assert.deepEqual(restored.geometry, saved.geometry)
  }
  if (process.env.DSH_BAY_COMPANION === '1') {
    await (await import('./validate-floating-handoff-17.3.mjs')).validateFloatingHandoff(page, context, output, errors, externalContext)
  }
  await page.getByRole('button', { name: '退出工作台模式', exact: true }).last().click()
  // The isolated desktop may restore an already-open native sidebar. Exercise
  // both directions instead of assuming its initial state is collapsed.
  const collapse = page.getByRole('button', { name: '收起右侧边栏', exact: true })
  if (await collapse.isVisible()) await collapse.click()
  await page.getByRole('button', { name: '打开右侧边栏', exact: true }).click()
  await page.waitForTimeout(300)
  const width = await page.locator('[data-rightbar-col]').evaluate(el => el.getBoundingClientRect().width)
  assert.ok(width > 0); assert.deepEqual(errors, [])
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ mode: desktop ? 'isolated-real-dsh-electron' : 'isolated-real-dsh-web', width, errors, requests, pinnedSameDom: true, packageVersion: '0.2.2-alpha.17.3' }, null, 2))
  console.log(JSON.stringify({ passed: true, width, errors, requests }))
  }
} catch (error) {
  await fs.writeFile(path.join(output, 'failure-dom.json'), JSON.stringify(await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight, scale: visualViewport?.scale },
    html: document.documentElement.getAttribute('style'), body: document.body.getAttribute('style'),
    topLayer: [...document.querySelectorAll('dialog, :modal, [popover]')].map(el => ({ tag: el.tagName, open: el.open, text: el.textContent.slice(0, 150), rect: el.getBoundingClientRect().toJSON() })),
    rootStyles: [...document.body.children].map(el => ({ tag: el.tagName, id: el.id, attrs: [...el.attributes].map(a => [a.name, a.value]), visibility: getComputedStyle(el).visibility, opacity: getComputedStyle(el).opacity, display: getComputedStyle(el).display, pointer: getComputedStyle(el).pointerEvents })),
    inert: [...document.querySelectorAll('[inert]')].map(el => ({ tag: el.tagName, attrs: [...el.attributes].map(a => [a.name, a.value]), rect: el.getBoundingClientRect().toJSON() })),
    float: [...document.querySelectorAll('[data-workbench-floating-window]')].map(el => ({ rect: el.getBoundingClientRect().toJSON(), pointer: getComputedStyle(el).pointerEvents, visibility: getComputedStyle(el).visibility, display: getComputedStyle(el).display, ancestors: [...function* () { for (let p = el; p; p = p.parentElement) yield { tag: p.tagName, inert: p.inert, style: p.getAttribute('style') } }()] })),
  })).catch(() => ({})), null, 2))
  await page.evaluate(() => document.querySelector('[data-workbench-instance-parking]')?.removeAttribute('inert')).catch(() => {})
  await fs.writeFile(path.join(output, 'failure-inert-ab.json'), JSON.stringify(await page.evaluate(() => { const button = document.querySelector('[data-workbench-floating-window] header button'); const r = button?.getBoundingClientRect(); return { hit: r ? document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,250) : null } }).catch(() => ({}))))
  await page.screenshot({ timeout: 5000, path: path.join(output, 'failure.png') }).catch(() => {}); await fs.writeFile(path.join(output, 'failure.txt'), await page.locator('body').ariaSnapshot().catch(() => 'Page closed')); console.error(error.message, { errors, requests }); process.exitCode = 1
} finally {
  await page.evaluate(() => globalThis.__qaRestoreRpc?.()).catch(() => {})
  await page.evaluate(async () => { if (globalThis.__backup173) { const f = globalThis.__wbContext.configForms.get('workbench-layout'); await f.mutate([{ op: 'set', path: [], value: globalThis.__backup173 }], f.getSnapshot().revision) } }).catch(() => {})
  await externalBrowser?.close()
  if (interception) await interception.detach().catch(() => {})
  await browser.close()
}
