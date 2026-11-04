import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
const home = process.env.DSH_BAY_ELECTRON_HOME
if (!home || !path.isAbsolute(home) || !home.includes('dsh-bay-173')) throw new Error('Set an isolated DSH_BAY_ELECTRON_HOME')
const output = path.join(home, 'evidence')
await fs.mkdir(output, { recursive: true })
// Started by the caller with isolated DSH_HOME and --user-data-dir.
const browser = await chromium.connectOverCDP('http://127.0.0.1:19373')
try {
  for (const [index, page] of browser.contexts()[0].pages().entries()) {
    await page.reload(); await page.waitForTimeout(1500)
    const text = await page.locator('body').innerText()
    await page.screenshot({ path: path.join(output, 'desktop-' + index + '.png') })
    await fs.writeFile(path.join(output, 'desktop-' + index + '.txt'), await page.locator('body').ariaSnapshot())
    console.log(JSON.stringify({ index, url: new URL(page.url()).origin, text: text.slice(0, 2000) }))
    console.log(JSON.stringify(await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('workbench')))))
  }
} finally {
  if (process.env.DSH_BAY_CLOSE_DESKTOP === '1') { const session = await browser.newBrowserCDPSession(); await session.send('Browser.close') }
  else await browser.close()
}
