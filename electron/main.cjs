// Electron-Hauptprozess: lädt die gebaute Web-App in ein großes Fenster.
// In der Produktion werden die Dateien aus dist/ über ein eigenes, sicheres
// app://-Protokoll ausgeliefert (korrekte MIME-Typen für ES-Module, stabiler
// Origin für localStorage und die File-System-Access-API).
const { app, BrowserWindow, protocol, net, Menu, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

// WICHTIG: Die App hieß früher „Digitale Tafel". Der Datenordner (localStorage mit
// dem gespeicherten Plan!) hängt am Produktnamen – deshalb bleibt er fest auf dem
// alten Ordner, damit beim Umbenennen auf „Zeitwerk" KEINE Daten verloren gehen.
app.setPath('userData', path.join(app.getPath('appData'), 'Digitale Tafel'));

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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  Menu.setApplicationMenu(null);
  win.maximize();
  win.show();
  // Tastaturfokus sofort auf das Fenster/den Inhalt legen – sonst nehmen die
  // Eingabefelder (z. B. Klassen-Beschriftung) beim ersten Start keine Eingaben an,
  // bis man irgendwo klickt/einen Dialog öffnet.
  win.focus();
  win.webContents.focus();
  win.webContents.on('did-finish-load', () => win.webContents.focus());

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

// Electron-Fokus-Bug nach nativen Dialogen (confirm/alert): Eingabefelder nehmen
// keinen Fokus mehr an, bis das Fenster den Fokus verliert und wiederbekommt.
// Der Renderer ruft das nach jedem Dialog auf (siehe src/main.ts).
ipcMain.on('refocus-window', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  win.blur();
  win.focus();
  win.webContents.focus();
});

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
