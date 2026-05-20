"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codexEpd", {
  getLimits: () => ipcRenderer.invoke("usage:get-limits"),
  getWeather: () => ipcRenderer.invoke("usage:get-weather"),
  getTargetDevice: () => ipcRenderer.invoke("app:get-target-device"),
  setTargetDevice: deviceName => ipcRenderer.invoke("app:set-target-device", deviceName),
  hide: () => ipcRenderer.invoke("app:hide"),
  onRefreshNow: callback => {
    const handler = () => callback();
    ipcRenderer.on("client:refresh-now", handler);
    return () => ipcRenderer.removeListener("client:refresh-now", handler);
  },
  onBluetoothStatus: callback => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on("client:bluetooth-status", handler);
    return () => ipcRenderer.removeListener("client:bluetooth-status", handler);
  },
});
