// Electron-Hauptprozess: lädt die gebaute Web-App in ein großes Fenster.
// In der Produktion werden die Dateien aus dist/ über ein eigenes, sicheres
// app://-Protokoll ausgeliefert (korrekte MIME-Typen für ES-Module, stabiler
// Origin für localStorage und die File-System-Access-API).
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// Muss vor app.ready registriert werden.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.show();

  // Druck-/Vorschaufenster (window.open für die Stundenplan-PDFs) ausdrücklich
  // erlauben – sonst blockiert Electron das Pop-up je nach Version.
  win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));

  // F11: Vollbild umschalten; Esc verlässt den Vollbildmodus.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
    }
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://bundle/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    const file = path.join(DIST, rel);
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      const mime = MIME[path.extname(file).toLowerCase()];
      if (mime) headers.set('content-type', mime);
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
