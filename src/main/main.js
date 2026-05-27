const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const setupIpcHandlers = require('./ipc-handlers');
const { autoUpdater } = require('electron-updater');
const supabase = require('./supabase-client');
const store = require('./store');

// Global crash prevention — prevent unhandled errors from killing the app
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error.message);
  console.error(error.stack);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[WARN] Unhandled Promise Rejection:', reason);
});

// Register deep link protocol client
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('galaxy', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('galaxy');
}

let mainWindow;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Parse deep link parameters from second instance command line arguments
    const deepLinkUrl = commandLine.find(arg => arg.startsWith('galaxy://'));
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: false, // frameless window
    backgroundColor: '#030712',
    icon: path.join(__dirname, '../renderer/assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev') || !app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle deep link on startup if the app was launched by clicking the protocol link
  const startupUrl = process.argv.find(arg => arg.startsWith('galaxy://'));
  if (startupUrl) {
    setTimeout(() => {
      handleDeepLink(startupUrl);
    }, 1500);
  }
}

async function handleDeepLink(urlString) {
  if (!urlString || !urlString.startsWith('galaxy://')) return;
  try {
    console.log('[main] Deep link received:', urlString);
    // Replace custom protocol with https temporarily to use URL parser safely
    const normalizedUrl = urlString.replace('galaxy://auth-callback', 'https://galaxy-auth');
    const parsedUrl = new URL(normalizedUrl);
    const hash = parsedUrl.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (error) throw error;

        // Persist session to store
        store.set('supabaseSession', data.session);
        console.log('[main] Supabase session set successfully via deep link for:', data.user.email);

        // Notify UI
        if (mainWindow) {
          mainWindow.webContents.send('auth:status-changed', {
            isAuthenticated: true,
            user: data.user
          });
        }
      }
    }
  } catch (e) {
    console.error('[main] Deep link handling failed:', e.message);
  }
}

// Background auto updater configuration
function setupAutoUpdater() {
  if (!app.isPackaged) return;

  // Suppress unhandled update errors — repo may have no releases yet
  autoUpdater.logger = null;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.warn('[updater] Update check failed (non-fatal):', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] Update downloaded. Prompting install...');
    if (!mainWindow) return;
    dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'App Update Available',
      message: `A new version (${info.version}) of Galaxy Deep Research is ready to install. Restart now?`,
      buttons: ['Restart & Install', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  // Delay initial check to let the window fully load first
  setTimeout(() => {
    try {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch (e) {
      console.warn('[updater] Initial update check error:', e.message);
    }
  }, 5000);

  // Check every 30 minutes (less aggressive)
  setInterval(() => {
    try {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch (e) {
      // Silent fail
    }
  }, 30 * 60 * 1000);
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
