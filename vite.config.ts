import { defineConfig } from 'vite';

// base: './' → relative Asset-Pfade, damit die gebaute App auch in Electron
// (über das app://-Protokoll bzw. lokal) korrekt geladen wird.
export default defineConfig({
  base: './',
});
