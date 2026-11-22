const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('riveraDesktop', {
  isDesktop: true,
  platform: process.platform,
});
