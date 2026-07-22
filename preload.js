const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sooderingCredentials", {
  available: true,
  load: () => ipcRenderer.invoke("credentials:load"),
  save: (credentials) => ipcRenderer.invoke("credentials:save", credentials),
  clear: () => ipcRenderer.invoke("credentials:clear")
});
