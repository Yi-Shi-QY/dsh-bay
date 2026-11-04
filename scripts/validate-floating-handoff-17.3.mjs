import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function validateFloatingHandoff(page, context, output, errors, externalContext) {
  const floating = page.locator('[data-workbench-floating-window]')
  await page.locator('[data-workbench-group] [data-workbench-native-conversation]').first().click({ position: { x: 90, y: 60 } })
  if (!await floating.isVisible()) await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  const add = async (target, name) => {
    const panel = target.locator('[data-workbench-floating-window]')
    await panel.getByRole('button', { name: /添加.*内页/ }).first().click()
    await panel.getByRole('menuitem').filter({ hasText: name }).first().click()
    return target.evaluate(() => __floating.workspace(__floating.visibleWorkbenchId).activeId)
  }
  const a = await add(page, /文件/), b = await add(page, /^对话/)
  await floating.locator('[data-workbench-native-conversation]').waitFor()
  const sent = await page.evaluate(() => __floating.snapshotHandoff(__floating.visibleWorkbenchId))
  await page.getByRole('button', { name: '打开“17.3 浮动工作区验收”工作台菜单', exact: true }).click()
  // Desktop opens a separately controlled Edge process through the test URL
  // launcher. The controller, Host tickets and handoff protocol stay real.
  const popup = (externalContext ?? context).waitForEvent('page')
  await page.getByRole('menuitem', { name: '在浏览器打开工作台“17.3 浮动工作区验收”', exact: true }).click()
  const companion = await popup
  companion.on('pageerror', e => errors.push('companion: ' + e.message))
  await companion.locator('[data-workbench-browser-toolbar]').waitFor({ timeout: 25000 })
  await companion.waitForFunction(id => __floating.find(id)?.location === 'floating', b)
  const received = await companion.evaluate(() => __floating.snapshotHandoff(__floating.visibleWorkbenchId))
  assert.deepEqual(received.tabs.map(t => [t.id, t.editorId, t.binding]), sent.tabs.map(t => [t.id, t.editorId, t.binding]))
  assert.equal(received.activeId, b)
  assert.equal(await companion.getByRole('tab', { name: '工作台总览', exact: true }).count(), 0)
  const cf = companion.locator('[data-workbench-floating-window]')
  await cf.getByRole('button', { name: '关闭 对话', exact: true }).click()
  await companion.waitForFunction(id => !__floating.find(id), b)
  await companion.locator('[data-workbench-group] [data-workbench-native-conversation]').first().click({ position: { x: 90, y: 60 } })
  const c = await add(companion, /^对话/)
  await cf.locator('[data-workbench-native-conversation]').waitFor()
  await cf.getByRole('button', { name: '浮动工作区菜单' }).click()
  await cf.getByRole('button', { name: '放入区域', exact: true }).click()
  await cf.getByRole('button', { name: '右侧分屏', exact: true }).first().click()
  await companion.waitForFunction(id => __floating.find(id)?.location === 'area', c)
  const d = await add(companion, /^对话/)
  await companion.screenshot({ timeout: 5000, path: path.join(output, 'companion-handoff.png') })
  await companion.getByRole('button', { name: '收回到 DSH 客户端', exact: true }).click()
  await companion.getByText('工作台已收回到 DSH 客户端', { exact: true }).waitFor({ timeout: 25000 })
  await page.waitForFunction(({ a, b, c, d }) => __floating.find(a)?.location === 'floating'
    && !__floating.find(b) && __floating.find(c)?.location === 'area' && __floating.find(d)?.location === 'floating', { a, b, c, d }, { timeout: 25000 })
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  await floating.getByRole('button', { name: '关闭 对话', exact: true }).click()
  await page.waitForFunction(id => !__floating.find(id), d)
  await companion.close()
  const result = { passed: true, carrier: externalContext ? 'electron-to-edge-to-electron' : 'web-to-companion-to-web',
    ...(externalContext ? { urlLauncher: 'test-controlled Edge; OS URL association not exercised' } : {}),
    sourceTabs: sent.tabs.length, browserClosedTabRemoved: true, browserNewTabReturned: true,
    browserPinnedTabRestored: true, sourceBindingPreserved: true, returnedTabCloses: true }
  await fs.writeFile(path.join(output, 'handoff.json'), JSON.stringify(result, null, 2))
  console.log('trusted companion handoff', JSON.stringify(result))
}
