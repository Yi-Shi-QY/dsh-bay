import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Use a disposable DSH profile, never a user's production profile. Browser
// plugin is unavailable in this environment; Playwright uses installed Edge.
const url = process.env.BAY_VALIDATION_URL ?? 'http://127.0.0.1:53921/'
const auth = process.env.BAY_VALIDATION_AUTH ?? path.join(process.env.TEMP, 'bay-agent-validation-auth.json')
const output = path.resolve('releases/alpha17.5-bay-agent-host-private/evidence')
mkdirSync(output, { recursive: true })
const previousPath = path.join(output, 'browser.json')
const previous = existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, 'utf8')) : undefined
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ storageState: auth, viewport: { width: 1440, height: 1000 } })
const page = await context.newPage(), errors = [], snapshots = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 900)) })
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {
  if (response.url().endsWith('/api/workbench/bay-agent')) void response.json().then(body => { if (body.snapshot) snapshots.push(body.snapshot); else errors.push(JSON.stringify(body)) }).catch(() => {})
})
async function openBay() {
  const enter = page.getByRole('button', { name: '进入工作台模式', exact: true })
  try { await enter.waitFor({ timeout: 5000 }); await enter.click() } catch { /* already in Workbench */ }
  const back = page.getByRole('button', { name: '返回工作台', exact: true })
  if (await back.isVisible()) await back.click()
  await page.locator('[data-workbench-group]').first().waitFor({ timeout: 25000 })
  const preview = page.getByRole('button', { name: '继续', exact: true })
  try { await preview.waitFor({ timeout: 2500 }); await preview.click() } catch { /* already acknowledged */ }
  const welcome = page.getByText('开始使用', { exact: true })
  try { await welcome.waitFor({ timeout: 1500 }); await page.keyboard.press('Escape'); await welcome.waitFor({ state: 'hidden', timeout: 2500 }) } catch { /* no sign-in reminder */ }
  await page.getByRole('button', { name: '浮动工作区', exact: true }).click()
  const region = page.getByRole('region', { name: '浮动工作区', exact: true })
  const tab = region.getByRole('tab', { name: /Bay Agent/ })
  await tab.waitFor({ timeout: 15000 }); await tab.click()
  await page.getByText('Bay Agent · 持久主控会话', { exact: true }).waitFor()
  await page.waitForFunction(() => !document.body.textContent.includes('正在恢复工作台主控会话'))
  if (await region.count() !== 1) throw new Error('Expected exactly one existing floating workspace')
  await region.locator('[data-workbench-native-conversation="chat"]').waitFor({ timeout: 15000 })
  await region.locator('[contenteditable="true"], textarea').first().waitFor({ timeout: 10000 })
  if ((await region.innerText()).includes('选择一个工作区开始')) throw new Error('Main requires manual project binding')
  return region
}
try {
  await page.goto(url)
  const region = await openBay()
  await page.getByRole('button', { name: '浮动工作区菜单', exact: true }).click()
  if (!await page.getByRole('button', { name: '选择来源对话', exact: true }).isDisabled()) throw new Error('Main identity can be rebound')
  if (!await page.getByRole('button', { name: '放入区域', exact: true }).isDisabled()) throw new Error('Main tab can leave the floating workspace')
  await page.getByRole('button', { name: '关闭浮窗菜单', exact: true }).click()
  await page.locator('summary').filter({ hasText: '工作台任务' }).click()
  await page.screenshot({ path: path.join(output, 'bay-agent.png'), fullPage: true })
  await page.getByRole('button', { name: '最小化浮动工作区', exact: true }).click()
  await page.getByRole('button', { name: '展开浮动工作区', exact: true }).click()
  await page.setViewportSize({ width: 1000, height: 760 })
  await page.screenshot({ path: path.join(output, 'bay-agent-compact.png'), fullPage: true })
  const last = snapshots.at(-1)
  if (!last?.bayAgentSessionId) throw new Error('Host did not return a persisted Main Session')
  if (previous?.workbenchId === last.workbenchId && previous.mainSessionId !== last.bayAgentSessionId) throw new Error('Main identity changed between validation runs')
  await page.reload()
  await openBay()
  const refreshed = snapshots.at(-1)
  if (refreshed?.bayAgentSessionId !== last.bayAgentSessionId) throw new Error('Main identity changed after browser refresh')
  if (errors.length) throw new Error(errors.join('\n'))
  const result = { passed: true, workbenchId: last.workbenchId, mainSessionId: last.bayAgentSessionId, refreshReusedMain: true, reusedPreviousRun: previous?.mainSessionId === last.bayAgentSessionId, nativeComposer: true, manualProjectBindingRequired: false, floatingWindows: await region.count(), tasks: last.workItems.length, errors, at: new Date().toISOString() }
  writeFileSync(path.join(output, 'browser.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
} catch (error) {
  await page.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ error: String(error), errors, text: (await page.locator('body').innerText()).slice(-6500) }))
  process.exitCode = 1
} finally {
  await context.storageState({ path: auth })
  await browser.close()
}
