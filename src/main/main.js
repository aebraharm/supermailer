'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, safeStorage, shell, session, Menu } = require('electron');
const { createServices } = require('./services');
const { registerHandlers } = require('./ipc/register-handlers');

let mainWindow = null;
let services = null;
let unregister = null;

// Single instance: a second launch focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b2a5b',
    title: 'Super Mailer',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function lockDownSession() {
  // Renderer content is local; deny every permission request (camera, geolocation, …).
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // Content Security Policy: no remote scripts or connections from the UI.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'"
        ]
      }
    });
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  lockDownSession();
  Menu.setApplicationMenu(null);

  const dataDir = app.getPath('userData');
  if (!safeStorage.isEncryptionAvailable()) {
    dialog.showErrorBox(
      'Secure storage unavailable',
      'Super Mailer needs Windows secure storage (DPAPI) to protect your SMTP password. The application will start, but sending will be disabled until secure storage is available.'
    );
  }
  services = createServices({
    dataDir,
    safeStorage: safeStorage.isEncryptionAvailable() ? safeStorage : { isEncryptionAvailable: () => false }
  });
  createWindow();
  unregister = registerHandlers({ services, window: mainWindow, dialog, app });
  // The window reference is captured by handlers; recreate-on-activate keeps it current.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', (event) => {
  const active = services && services.campaigns && services.campaigns.active;
  if (active && active.queue.state === 'running') {
    // Pause in-flight sending so nothing is half-written when the app exits.
    services.campaigns.pause();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
