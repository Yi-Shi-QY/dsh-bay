import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'

/** Installed-package checks, exclusively against the isolated fixture Profile. */
export async function validateFloatingDetails(page, output) {
  const floating = page.locator('[data-workbench-floating-window]')
  const add = async name => {
    await floating.getByRole('button', { name: '添加临时内页', exact: true }).click()
    await floating.getByRole('menuitem').filter({ hasText: name }).first().click()
  }
  const drag = async (selector, edge = 'center') => {
    const id = await page.evaluate(() => globalThis.__floating.workspace(globalThis.__floating.visibleWorkbenchId).activeId)
    await page.locator(selector).evaluate(el => { globalThis.__detailsElement = el })
    if (edge === 'bottom') {
      await floating.getByRole('button', { name: '浮动工作区菜单' }).click()
      await floating.getByRole('button', { name: '放入区域', exact: true }).click()
      await floating.getByRole('button', { name: '下方分屏', exact: true }).last().click()
    } else {
      const tab = await floating.getByRole('tab', { selected: true }).boundingBox()
      const area = await page.locator('[data-workbench-area-header]').last().boundingBox()
      await page.mouse.move(tab.x + 20, tab.y + tab.height / 2); await page.mouse.down()
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2, { steps: 10 })
      await page.locator('[data-drop-valid=true]').waitFor()
      await page.mouse.up()
    }
    await page.waitForFunction(id => globalThis.__floating.find(id)?.location === 'area', id)
    assert.equal(await page.locator(selector).evaluate(el => el === globalThis.__detailsElement), true)
  }
  const allow = await page.evaluate(async () => {
    const c = globalThis.__wbContext, registry = globalThis.__extensionRegistry
    await registry.refresh()
    const row = registry.getSnapshot().extensions.find(row => row.moduleId === 'qa.icon-extension')
    if (!row || !['ready', 'not-allowed', 'confirmation-required'].includes(row.availability)) throw new Error('Missing compatible isolated QA fixture: ' + row?.availability)
    const form = c.configForms.get('workbench-layout')
    return form.mutate([{ op: 'set', path: ['extensionConsents', row.key], value: { packageName: row.packageName, moduleId: row.moduleId, apiVersion: 1, editorIds: row.editorIds, contractFingerprint: row.contractFingerprint, allowedAt: Date.now(), allowed: true } }], form.getSnapshot().revision)
  })
  assert.equal(allow, true)
  await add('团队笔记')
  await floating.getByRole('button', { name: 'Local count 0' }).click()
  await floating.getByRole('textbox', { name: 'Local draft' }).fill('state survives dragging')
  const mount = await page.locator('[data-empty-area-icon-qa]').getAttribute('data-mount-id')
  await drag('[data-empty-area-icon-qa]')
  assert.equal(await page.getByRole('textbox', { name: 'Local draft' }).inputValue(), 'state survives dragging')
  assert.equal(await page.locator('[data-empty-area-icon-qa]').getAttribute('data-mount-id'), mount)
  await page.getByRole('button', { name: 'Local count 1' }).waitFor()
  console.log('custom editor: pointer pin preserves React state and DOM')
  await add('终端')
  await floating.locator('.xterm-helper-textarea').waitFor({ state: 'attached', timeout: 15000 })
  await floating.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('echo WB173_TERMINAL_ALIVE'); await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)
  await floating.locator('.xterm-screen').screenshot({ path: path.join(output, 'terminal-before.png') })
  await drag('[data-workbench-native-area=terminal]', 'bottom')
  await page.locator('[data-workbench-native-area=terminal] .xterm-helper-textarea').focus()
  await page.keyboard.type('echo WB173_AFTER_PIN'); await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
  await page.locator('[data-workbench-native-area=terminal] .xterm-screen').screenshot({ path: path.join(output, 'terminal-after.png') })
  console.log('terminal: same native DOM accepts input before and after menu split')
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><title>17.3 local browser fixture</title><input aria-label="Browser draft"><button onclick="this.textContent=Number(this.textContent)+1">0</button>') })
  await new Promise(resolve => server.listen(19276, '127.0.0.1', resolve))
  try {
    await add('浏览器')
    const address = floating.getByRole('textbox', { name: '浏览器地址', exact: true })
    await address.fill('http://127.0.0.1:19276/'); await address.press('Enter')
    const browserSelector = '[data-workbench-native-area=browser], [data-workbench-native-fallback=browser]'
    const draft = page.frameLocator('[data-workbench-floating-window] iframe').getByRole('textbox', { name: 'Browser draft' })
    await draft.fill('browser state survives pin')
    await drag(browserSelector)
    assert.equal(await page.frameLocator('[data-workbench-group] iframe').getByRole('textbox', { name: 'Browser draft' }).inputValue(), 'browser state survives pin')
    console.log('browser: iframe input state survives pointer pin')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '重置位置', exact: true }).click()
  const reset = await floating.boundingBox(); assert.ok(Math.abs(reset.width - 720) < 4)
  await floating.getByRole('button', { name: '添加内页', exact: true }).focus()
  await page.keyboard.press('Alt+m')
  await page.getByRole('button', { name: '展开浮动工作区', exact: true }).focus(); await page.keyboard.press('Enter')
  await floating.waitFor()
  await page.setViewportSize({ width: 720, height: 650 })
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(250)
  const canvas = await page.locator('[data-workbench-canvas]').boundingBox(), small = await floating.boundingBox()
  assert.ok(small.width <= canvas.width + 3 && small.height <= canvas.height + 3)
  await page.screenshot({ path: path.join(output, 'narrow-dark.png') })
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' })
  await fs.writeFile(path.join(output, 'details.json'), JSON.stringify({ customReactState: true, pointerHeaderPin: true, menuSplit: true, terminalDomAndInput: true, browserIframeState: true, toolbarReset: true, keyboardMinimize: true, narrowBounds: true }, null, 2))
}
