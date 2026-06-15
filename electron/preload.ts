import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('stockAPI', {
  getStock: (stockCode: string, source: 'auto' | 'etnet' | 'yahoo' = 'auto') =>
    ipcRenderer.invoke('get-stock', stockCode, source)
})