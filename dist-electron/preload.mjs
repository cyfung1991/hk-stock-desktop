"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("stockAPI", {
  getStock: (stockCode, source = "auto") => electron.ipcRenderer.invoke("get-stock", stockCode, source)
});
