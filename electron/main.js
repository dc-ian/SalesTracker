// Electron main process.
// Starts the Express server on a free loopback port, opens a chrome-less
// window pointed at it, and shuts everything down cleanly on exit.
//
// The server runs inside this main process (not a child process) so that
// better-sqlite3 and Electron's userData path resolution (config/paths.js)
// share one process and one DB connection, and so packaging stays simple.
//
// Phase 6 hardening: contextIsolation on, nodeIntegration off, renderer
// sandboxed, no <webview>, no permission grants, navigation pinned to our
// own origin.

const { app, BrowserWindow, Menu, session, shell } = require('electron');
const { startServer, stopServer } = require('../server');
const { closeConnection } = require('../server/db/connection');

let httpServer = null;
let origin = null;
let mainWindow = null;
let isShuttingDown = false;

// Only one running instance: two instances would fight over the SQLite file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot).catch(fatal);
}

// Applies to every web contents Electron ever creates, not just our window.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault()); // no <webview>

  const pinToOrigin = (e, url) => {
    if (!origin || !url.startsWith(`${origin}/`)) e.preventDefault();
  };
  contents.on('will-navigate', pinToOrigin);
  contents.on('will-redirect', pinToOrigin);

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url); // external links -> default browser
    return { action: 'deny' };
  });
});

async function boot() {
  // No menu bar => no View > Toggle DevTools / Reload shortcuts, no address bar.
  Menu.setApplicationMenu(null);

  // The app never needs camera, mic, geolocation, notifications, etc.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  // port 0 => OS assigns a free port, so we never collide with another app.
  const { server, host, port } = await startServer({ port: 0, host: '127.0.0.1' });
  httpServer = server;
  origin = `http://${host}:${port}`;

  createWindow();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true, // page scripts can't reach Electron/Node internals
      nodeIntegration: false, // no require() in the page
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      devTools: false, // no dev tools in the desktop app
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`${origin}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Closing the main window exits the app on every platform (including macOS).
app.on('window-all-closed', () => app.quit());

// Graceful shutdown: pause quit, stop Express, close the DB, then really quit.
app.on('before-quit', (event) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  event.preventDefault();
  shutdown().finally(() => app.exit(0));
});

async function shutdown() {
  try {
    await stopServer(httpServer);
  } catch (err) {
    console.error('Error stopping server:', err);
  }
  httpServer = null;

  try {
    await closeConnection(); // closes SQLite (raw + Knex) so the WAL is checkpointed cleanly
  } catch (err) {
    console.error('Error closing database:', err);
  }
}

function fatal(err) {
  console.error('Fatal startup error:', err);
  shutdown().finally(() => app.exit(1));
}
