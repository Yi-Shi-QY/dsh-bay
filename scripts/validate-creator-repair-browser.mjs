import { build } from 'esbuild'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

// Real Chrome is required: jsdom cannot reproduce native dialog top-layer
// inertness. Native Session/directory integration is tested in apply-core.
const project = path.resolve(import.meta.dirname, '..')
const output = await mkdtemp(path.join(tmpdir(), 'bay-creator-browser-'))
const source = `
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkbenchCoreSettingsDialog } from './packages/workbench-core/src/foundation/WorkbenchCoreSettingsDialog.tsx'
const empty = [], subscribe = () => () => {}
const record = { workbenchId: 'a', name: 'Repair test', description: '', createdAt: 1, updatedAt: 1,
  document: { version: 3, activeAreaId: 'area-a', root: { kind: 'area', areaId: 'area-a', moduleHistory: [] } } }
const snapshot = { status: 'ready', revision: 1, writable: true, mode: 'host', value: {
  version: 4, activeWorkbenchId: 'a', openWorkbenchIds: ['a'], workbenches: { a: record },
  invalidWorkbenches: {}, sessionMarkers: {}, layoutTemplates: {} } }
const extensions = { status: 'ready', extensions: [{ key: 'old', moduleId: 'local.pomodoro', packageName: '@local/pomodoro',
  packageVersion: '1.0', editorIds: ['local.pomodoro.page'], availability: 'incompatible', allowed: false, detail: '需要更新扩展版本。' }] }
const bridge = window.repairTest = { calls: [], fail: false, resolve: undefined }
function App() {
  const [open, setOpen] = useState(true)
  return <><button onClick={() => setOpen(true)}>打开设置</button><textarea aria-label="修复会话草稿" />
    {open && <WorkbenchCoreSettingsDialog
      workbenchSettings={{ getSnapshot: () => snapshot, subscribe }} onClose={() => setOpen(false)}
      openOptions={{ section: 'pages' }} editorCatalog={{ getSnapshot: () => empty, subscribe }}
      useSessions={select => select({ ids: [], byId: {} })} useWorkspaces={select => select({ items: [] })}
      extensionRegistry={{ getSnapshot: () => extensions, subscribe, refresh: async () => {}, dispose() {}, catalog: { getSnapshot: () => empty, subscribe } }}
      openCreator={async (prompt, title, target) => {
        bridge.calls.push({ prompt, title, target })
        if (bridge.fail) throw new Error('模拟目录不可写，请重试。')
        await new Promise(resolve => { bridge.resolve = resolve })
        document.querySelector('textarea').value = prompt
      }} />}
  </>
}
createRoot(document.getElementById('root')).render(<App />)
`
let browser, server
try {
  await build({ stdin: { contents: source, loader: 'tsx', resolveDir: project }, outfile: path.join(output, 'app.js'),
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'local-css', '.svg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })
  await writeFile(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>')
  server = createServer(async (request, response) => {
    const filename = request.url === '/app.js' ? 'app.js' : request.url === '/app.css' ? 'app.css' : 'index.html'
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8')
    response.end(await readFile(path.join(output, filename)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  browser = await chromium.launch({ channel: process.env.BAY_BROWSER_CHANNEL ?? 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []; page.on('pageerror', error => errors.push(error.message))

  // Preserve the original browser-only failure as an explicit control sample.
  await page.setContent('<dialog><button id="repair">Repair</button></dialog>')
  await page.evaluate(() => {
    document.querySelector('dialog').showModal()
    document.querySelector('button').onclick = () => {
      const portal = document.createElement('div')
      portal.innerHTML = '<button id="target">Open Creator</button>'
      portal.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;display:grid;place-items:center'
      document.body.append(portal)
    }
  })
  await page.locator('#repair').click()
  assert.equal(await page.evaluate(() => {
    const button = document.querySelector('#target'), rect = button.getBoundingClientRect()
    button.focus()
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button || document.activeElement === button
  }), false, 'Old external portal should be inert under native showModal')

  await page.goto('http://127.0.0.1:' + server.address().port)
  const button = page.getByRole('button', { name: '在创造模式中修复', exact: true })
  await button.waitFor()
  assert.equal(await page.locator('dialog').evaluate(element => element.matches(':modal')), true)
  await page.evaluate(() => { window.repairTest.fail = true })
  await button.click()
  await page.getByRole('alert').filter({ hasText: '模拟目录不可写' }).waitFor()
  assert.equal(await page.locator('dialog').evaluate(element => element.matches(':modal')), true)
  await page.evaluate(() => { window.repairTest.fail = false })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.getByRole('button', { name: '正在打开创造模式…', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '正在打开创造模式…', exact: true }).isDisabled(), true)
  assert.equal(await page.evaluate(() => window.repairTest.calls.length), 2)
  assert.deepEqual(await page.evaluate(() => window.repairTest.calls[1].target), { workbenchId: 'a', moduleId: 'local.pomodoro', packageName: '@local/pomodoro' })
  await page.evaluate(() => window.repairTest.resolve())
  await page.locator('dialog').waitFor({ state: 'detached' })
  const input = page.getByRole('textbox', { name: '修复会话草稿' })
  assert.match(await input.inputValue(), /local.pomodoro/u)
  await input.fill('可以继续编辑修复说明')
  assert.equal(await input.inputValue(), '可以继续编辑修复说明')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: true, originalPortalBugReproduced: true, nativeDialog: true, directClick: true, visibleFailureAndRetry: true, closeAfterSuccess: true, inputInteractiveAfterClose: true, nativeSessionIntegration: 'covered separately in Vitest' }))
} finally {
  await browser?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  // This fresh, checked temp directory contains only this test's bundle.
  if (path.dirname(output) === tmpdir() && path.basename(output).startsWith('bay-creator-browser-')) await rm(output, { recursive: true, force: true })
}
