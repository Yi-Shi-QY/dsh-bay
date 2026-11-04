import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function validateFloatingMerge(page, output, errors) {
  const floating = page.locator('[data-workbench-floating-window]')
  const results = []
  const count = () => page.locator('[data-workbench-group]').count()
  for (let i = 0; i < 18; i++) {
    if (!await floating.isVisible()) await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
    const name = [/^对话/, /文件/, /^终端/, /^浏览器/, /文件预览/, /^新建对话/][i % 6]
    if (i % 6 === 4) {
      const opened = await page.evaluate(() => {
        const runtime = __floating, wb = runtime.visibleWorkbenchId
        const source = [...runtime.instances.values()].find(row => row.workbenchId === wb && row.tab.binding)
        const address = 'dsh-resource://file/session/' + source.tab.sessionId + '/workbench-tetris-extension/README.md'
        return runtime.route({ workbenchId: wb, sourceId: source.tab.id, binding: source.tab.binding, kind: 'documentpreview',
          options: { floating: true, resourceAddress: address, nativeContentId: address, alwaysNew: true } })
      })
      assert.equal(opened, true)
    } else {
      await floating.getByRole('button', { name: /添加.*内页/ }).first().click()
      await floating.getByRole('menuitem').filter({ hasText: name }).first().click()
    }
    const id = await page.evaluate(() => __floating.workspace(__floating.visibleWorkbenchId).activeId)
    await floating.locator('[data-workbench-retained-target="' + id + '"]').waitFor()
    await page.waitForTimeout(200)
    await page.evaluate(id => { globalThis.__mergeElement = __floating.find(id).element }, id)
    const before = await count()
    await floating.getByRole('button', { name: '浮动工作区菜单' }).click()
    await floating.getByRole('button', { name: '放入区域', exact: true }).click()
    await floating.getByRole('button', { name: '右侧分屏', exact: true }).first().click()
    await page.waitForFunction(id => __floating.find(id)?.location === 'area', id)
    await page.waitForFunction(n => document.querySelectorAll('[data-workbench-group]').length === n + 1, before)
    await floating.getByRole('button', { name: '最小化浮动工作区' }).click()
    const pinned = page.locator('[data-workbench-group]').filter({ has: page.locator('[data-workbench-area-tab="' + id + '"]') })
    const pinnedId = await pinned.getAttribute('data-workbench-group')
    const other = page.locator('[data-workbench-group]').filter({ hasNot: page.locator('[data-workbench-area-tab="' + id + '"]') }).first()
    const source = i % 2 ? other : pinned, destination = i % 2 ? pinned : other
    const from = await source.locator('[data-area-merge-drag-handle]').boundingBox(), to = await destination.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + 90, { steps: 10 }); await page.mouse.up()
    await page.waitForFunction(n => document.querySelectorAll('[data-workbench-group]').length === n, before)
    assert.equal(await page.evaluate(id => __floating.find(id).element === __mergeElement && __mergeElement.isConnected, id), true)
    assert.deepEqual(errors, [])
    // Leave every third native page in the background to exercise retained histories.
    if (i % 3 !== 0) {
      await page.locator('[data-workbench-area-tab="' + id + '"] [role=tab]').click()
      await page.locator('[data-workbench-area-tab="' + id + '"] button[title^="关闭"]').click()
      await page.waitForFunction(id => !__floating.find(id), id)
    }
    results.push({ iteration: i, editor: String(name), reverse: !!(i % 2), retained: i % 3 === 0, pinnedId })
    console.log('native merge passed', i, String(name))
  }
  await page.screenshot({ path: path.join(output, 'merged-native.png') })
  await fs.writeFile(path.join(output, 'merge.json'), JSON.stringify({ passed: true, results, errors }, null, 2))
}
