import './style.css';
import { App } from './App';

new App().start();

// PWA: Service Worker registrieren – nur im Produktiv-Build über http(s).
// In Electron (app://) und im Dev-Server wird er übersprungen.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
