const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('taolingChat', Object.freeze({
  close: () => ipcRenderer.invoke('taoling:chat-action', 'hide'),
  openMain: () => ipcRenderer.invoke('taoling:chat-action', 'open'),
  status: value => ipcRenderer.invoke('taoling:chat-status', value),
}));
