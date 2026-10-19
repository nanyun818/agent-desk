const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('taolingPet', Object.freeze({
  config: () => ipcRenderer.invoke('taoling:pet-config'),
  menu: () => ipcRenderer.invoke('taoling:pet-action', 'menu'),
  hide: () => ipcRenderer.invoke('taoling:pet-action', 'hide'),
  open: () => ipcRenderer.invoke('taoling:pet-action', 'open'),
  greet: () => ipcRenderer.invoke('taoling:pet-action', 'greet'),
  pat: () => ipcRenderer.invoke('taoling:pet-action', 'pat'),
  chat: () => ipcRenderer.invoke('taoling:pet-action', 'chat'),
  drag: (phase, point) => ipcRenderer.invoke('taoling:pet-drag', { phase, point }),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('taoling:changed', listener);
    return () => ipcRenderer.removeListener('taoling:changed', listener);
  },
}));
