// Preload: kleine, sichere Brücke zwischen Renderer und Hauptprozess.
// tafelNative.refocus() behebt den Electron-Fokus-Bug nach nativen Dialogen
// (window.confirm/alert): danach nehmen Eingabefelder sonst keinen Fokus mehr
// an, bis das Fenster einmal den Fokus verliert und wiederbekommt.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tafelNative', {
  refocus: () => ipcRenderer.send('refocus-window'),
});
