const { contextBridge, ipcRenderer, webUtils } = require('electron')
contextBridge.exposeInMainWorld('__DSH_DIRECTORY_PICKER__', {
  pick: () => ipcRenderer.invoke('workbench:pick-directory'),
})
contextBridge.exposeInMainWorld('__DSH_HOST_PATHS__', {
  pathFor: file => webUtils.getPathForFile(file),
})
// Implements DSH's public DesktopBrowserBridge contract for our own window.
contextBridge.exposeInMainWorld('dshDesktop', {
  protocolVersion: 1,
  browser: {
    acquire: workspace => ipcRenderer.invoke('workbench:browser-acquire', workspace),
    release: lease => ipcRenderer.invoke('workbench:browser-release', lease),
    onOpenRequested: (lease, listener) => {
      const receive = (_event, request) => { if (request.lease === lease) listener(request.url) }
      ipcRenderer.on('workbench:browser-open', receive)
      return () => ipcRenderer.off('workbench:browser-open', receive)
    },
  },
})
