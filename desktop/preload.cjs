const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentDeskDesktop', Object.freeze({
  getCompanionState: () => ipcRenderer.invoke('taoling:state'),
  setCompanionEnabled: value => ipcRenderer.invoke('taoling:enabled', value),
  setCompanionSize: value => ipcRenderer.invoke('taoling:size', value),
  setCompanionMotion: value => ipcRenderer.invoke('taoling:motion', value),
  setCompanionStatus: value => ipcRenderer.invoke('taoling:status', value),
  onCompanionState: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('taoling:changed', listener);
    return () => ipcRenderer.removeListener('taoling:changed', listener);
  },
}));
