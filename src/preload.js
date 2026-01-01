const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("Zapps", {
  openZapp: () => ipcRenderer.invoke("zapps:open"),

  notify: (title, body) =>
    ipcRenderer.send("zapps:notify", { title, body }),

  storage: {
    get: key => ipcRenderer.invoke("zapps:storage:get", key),
    set: (key, value) =>
      ipcRenderer.invoke("zapps:storage:set", { key, value })
  },

  getLibrary: () => ipcRenderer.invoke("zapps:library"),

  onUpdateStatus: cb =>
    ipcRenderer.on("zapps:update:status", (_, s) => cb(s)),

  onUpdateProgress: cb =>
    ipcRenderer.on("zapps:update:progress", (_, p) => cb(p)),

  restartToUpdate: () =>
    ipcRenderer.send("zapps:update:restart")
});
