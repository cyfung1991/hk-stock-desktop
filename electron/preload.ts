import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('stockAPI', {
  getStock: (stockCode: string) => ipcRenderer.invoke('get-stock', stockCode)
})