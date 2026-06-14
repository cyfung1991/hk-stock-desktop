"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("stockAPI", {
  getStock: (stockCode) => electron.ipcRenderer.invoke("get-stock", stockCode)
});
