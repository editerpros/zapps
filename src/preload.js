const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("Zapps", {
  open: () => ipcRenderer.invoke("zapps:open"),
  getLibrary: () => ipcRenderer.invoke("zapps:library"),
  launch: id => ipcRenderer.invoke("zapps:launch", id),
  pin: app => ipcRenderer.invoke("zapps:pin", app),
  uninstall: id => ipcRenderer.invoke("zapps:uninstall", id),
  about: () => ipcRenderer.invoke("zapps:about"),
  checkForUpdates: () => ipcRenderer.invoke("zapps:checkUpdate")
});
