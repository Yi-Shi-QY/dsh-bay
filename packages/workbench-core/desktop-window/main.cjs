const { app, BrowserWindow, ipcMain, dialog, session } = require('electron')
const readline = require('node:readline')
const path = require('node:path')
const { connect } = require('node:net')
const { randomUUID, createHash } = require('node:crypto')

let window
let startupStage = 'boot'
const pipe = connect(process.env.WORKBENCH_BOOT_PIPE)
const emit = (event, done) => { if (pipe.writable) pipe.write(JSON.stringify(event) + '\n', done) }
const input = readline.createInterface({ input: pipe })
pipe.on('error', () => app.quit())
const boot = new Promise(resolve => input.on('line', line => {
  try {
    const message = JSON.parse(line)
    if (message.action === 'boot') resolve(message)
    if (message.action === 'focus' && window && !window.isDestroyed()) {
      window.restore(); window.show(); window.focus(); emit({ type: 'ack', requestId: message.requestId, ok: true })
    }
    if (message.action === 'close') {
      emit({ type: 'ack', requestId: message.requestId, ok: true }, () => { app.quit() })
    }
  } catch { emit({ type: 'failed' }); app.quit() }
}))
input.on('close', () => app.quit())
app.setName('DSH Workbench')
if (/^\d{4,5}$/.test(process.env.WORKBENCH_WINDOW_DEBUG_PORT ?? '')) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', process.env.WORKBENCH_WINDOW_DEBUG_PORT)
}
app.on('window-all-closed', () => app.quit())

;(async () => {
  const config = await boot
  startupStage = 'configuration'
  const auth = new URL(config.authUrl)
  const target = new URL(config.url)
  if (auth.protocol !== 'http:' || auth.hostname !== '127.0.0.1' || auth.pathname !== target.pathname
    || target.origin !== auth.origin || target.pathname !== `/_workbench/window/${config.windowId}/`)
    throw new Error('Invalid Workbench window URL')
  app.setPath('userData', path.join(config.dataDirectory, config.windowId))
  app.setPath('sessionData', path.join(config.dataDirectory, config.windowId, 'session'))
  await app.whenReady()
  startupStage = 'create-window'
  window = new BrowserWindow({ width: 1280, height: 850, minWidth: 480, minHeight: 420,
    title: `${config.title} - Workbench`, show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: true,
    partition: `workbench-${config.windowId}`, preload: path.join(__dirname, 'preload.cjs') } })
  const owned = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && new URL(event.senderFrame.url).origin === target.origin
  const leases = new Map()
  const safePage = raw => {
    try { const url = new URL(raw); return ['http:', 'https:'].includes(url.protocol)
      && url.origin !== target.origin && !url.username && !url.password } catch { return false }
  }
  const browserSessions = new Set()
  ipcMain.handle('workbench:browser-acquire', (event, workspace) => {
    if (!owned(event) || typeof workspace !== 'string' || workspace.length > 32768 || leases.size >= 32) throw new Error('Invalid browser reservation')
    const lease = randomUUID()
    const partition = 'workbench-browser-' + createHash('sha256').update(workspace).digest('hex')
    const guestSession = session.fromPartition(partition)
    if (!browserSessions.has(partition)) {
      browserSessions.add(partition)
      guestSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
      guestSession.setPermissionCheckHandler(() => false)
      guestSession.on('will-download', event => event.preventDefault())
    }
    leases.set(lease, { partition })
    return { lease, partition }
  })
  ipcMain.handle('workbench:browser-release', (event, lease) => {
    if (!owned(event)) throw new Error('Unowned browser release')
    const record = leases.get(lease)
    leases.delete(lease)
    if (record?.guest && !record.guest.isDestroyed()) record.guest.close()
  })
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    const record = leases.get(params.name)
    if (!record || record.attaching || record.partition !== params.partition || params.src !== 'about:blank#' + params.name) {
      event.preventDefault(); return
    }
    record.attaching = true
    delete preferences.preload
    preferences.nodeIntegration = false; preferences.nodeIntegrationInSubFrames = false
    preferences.contextIsolation = true; preferences.sandbox = true; preferences.webSecurity = true
    preferences.webviewTag = false
  })
  window.webContents.on('did-attach-webview', (_event, guest) => {
    const entry = [...leases.entries()].find(([, row]) => row.attaching && !row.guest && session.fromPartition(row.partition) === guest.session)
    const [lease, record] = entry ?? []
    if (!record) { guest.close(); return }
    record.guest = guest
    const gate = (event, url) => { if (!safePage(url) && url !== 'about:blank#' + lease) event.preventDefault() }
    guest.on('will-navigate', gate); guest.on('will-redirect', gate)
    guest.setWindowOpenHandler(({ url }) => {
      if (safePage(url)) window.webContents.send('workbench:browser-open', { lease, url })
      return { action: 'deny' }
    })
    guest.once('destroyed', () => { record.guest = undefined })
  })
  ipcMain.handle('workbench:pick-directory', async event => {
    if (!owned(event)) throw new Error('Unowned directory picker caller')
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const next = new URL(url)
    if (next.origin !== target.origin || next.pathname !== target.pathname) event.preventDefault()
  })
  window.on('focus', () => emit({ type: 'focus' }))
  window.on('blur', () => emit({ type: 'blur' }))
  window.webContents.on('render-process-gone', () => { emit({ type: 'failed' }); app.quit() })
  startupStage = 'authentication'
  const authentication = await window.webContents.session.fetch(auth.href, { redirect: 'manual' })
  if (authentication.status !== 303) throw new Error('Workbench authentication failed')
  startupStage = 'load-workbench'
  await window.loadURL(target.href)
  window.setTitle(`${config.title} - Workbench`)
  window.show(); window.focus(); emit({ type: 'ready', windowId: config.windowId })
})().catch(() => { emit({ type: 'failed', code: `companion-${startupStage}-failed` }, () => app.quit()) })
