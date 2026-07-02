import './style.css';
import { App } from './App';

// Electron-Fokus-Bug umgehen: Nach einem nativen Dialog (window.confirm/alert)
// nehmen Eingabefelder (z. B. die Klassen-Beschriftung u+g) keinen Fokus mehr an,
// bis das Fenster den Fokus verliert und wiederbekommt. Deshalb werden confirm und
// alert einmal zentral gewrappt und stoßen danach über die Preload-Brücke ein
// kurzes blur+focus des Fensters an. Im Browser (ohne tafelNative) ändert sich nichts.
const native = (window as unknown as { tafelNative?: { refocus: () => void } }).tafelNative;
if (native) {
  const origConfirm = window.confirm.bind(window);
  window.confirm = (message?: string): boolean => {
    const ok = origConfirm(message);
    native.refocus();
    return ok;
  };
  const origAlert = window.alert.bind(window);
  window.alert = (message?: string): void => {
    origAlert(message);
    native.refocus();
  };
}

new App().start();

// PWA: Service Worker registrieren – nur im Produktiv-Build über http(s).
// In Electron (app://) und im Dev-Server wird er übersprungen.
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
