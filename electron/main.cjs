const { app, BrowserWindow, Menu, net, protocol, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const APP_ORIGIN = 'app://rivera';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;

function resolveDistFile(requestUrl) {
  const parsed = new URL(requestUrl);
  let relPath = '/';
  try {
    relPath = decodeURIComponent(parsed.pathname || '/');
  } catch {
    relPath = '/';
  }
  if (relPath === '/' || relPath === '') {
    relPath = '/index.html';
  }
  const normalized = path.posix.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  let candidate = path.join(DIST_DIR, normalized);
  const relFromDist = path.relative(DIST_DIR, candidate);

  if (relFromDist.startsWith('..') || path.isAbsolute(relFromDist)) {
    candidate = path.join(DIST_DIR, 'index.html');
  }
  if (!fs.existsSync(candidate) || fs.statSync(candidate).isDirectory()) {
    candidate = path.join(DIST_DIR, 'index.html');
  }
  return candidate;
}

function registerOfflineAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const targetFile = resolveDistFile(request.url);
      return net.fetch(pathToFileURL(targetFile).href, {
        method: request.method,
        headers: request.headers,
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // Enforce 100% offline renderer execution after startup (allow only local app/blob/data schemes)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url || '';
    const allowed =
      url.startsWith('app://') ||
      url.startsWith('blob:') ||
      url.startsWith('data:') ||
      url.startsWith('filesystem:') ||
      url.startsWith('devtools:') ||
      url.startsWith('file://');
    callback({ cancel: !allowed });
  });
}

function setupApplicationMenu() {
  if (process.platform === 'darwin') {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Editar',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'Janela',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'togglefullscreen' },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function createMainWindow() {
  const iconCandidates = [
    path.join(DIST_DIR, 'icon-512-v12.png'),
    path.resolve(__dirname, '..', 'public', 'icon-512-v12.png'),
  ];
  const iconPath = iconCandidates.find((p) => fs.existsSync(p));

  mainWindow = new BrowserWindow({
    width: 1160,
    height: 820,
    minWidth: 380,
    minHeight: 620,
    title: 'Rivera V/S Player',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(APP_ORIGIN)) {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

if (singleInstanceLock) {
  app.whenReady().then(() => {
    app.setName('Rivera V/S Player');
    registerOfflineAppProtocol();
    setupApplicationMenu();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
