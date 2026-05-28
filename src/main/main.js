const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const setupIpcHandlers = require('./ipc-handlers');
const { autoUpdater } = require('electron-updater');
const supabase = require('./supabase-client');
const store = require('./store');

// Advanced debug logger to inspect deep link arguments in Windows environment
function logDebug(message) {
  try {
    const userDataPath = app.getPath('userData');
    const logDir = path.join(userDataPath, 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'deeplink-debug.log');
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, 'utf8');
  } catch (e) {
    console.error('Failed to write debug log:', e.message);
  }
}

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
    app.setAsDefaultProtocolClient('knovant', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('knovant');
}

let mainWindow;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    logDebug(`[second-instance] triggered. commandLine: ${JSON.stringify(commandLine)}`);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Parse deep link parameters from second instance command line arguments
    const deepLinkUrl = commandLine.find(arg => arg.includes('knovant://'));
    logDebug(`[second-instance] Parsed deepLinkUrl: ${deepLinkUrl}`);
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
      sandbox: true
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
  const startupUrl = process.argv.find(arg => arg.includes('knovant://'));
  logDebug(`[startup] process.argv: ${JSON.stringify(process.argv)}`);
  logDebug(`[startup] Parsed startupUrl: ${startupUrl}`);
  if (startupUrl) {
    setTimeout(() => {
      handleDeepLink(startupUrl);
    }, 1500);
  }
}

async function handleDeepLink(urlString) {
  logDebug(`[handleDeepLink] received raw: ${urlString}`);
  if (!urlString || !urlString.includes('knovant://')) {
    logDebug(`[handleDeepLink] invalid urlString, aborting`);
    return;
  }
  try {
    // 1. Trim and strip any wrapping quotes or trailing slashes from the end of the URL
    let cleanUrl = urlString.trim().replace(/^["']|["']$/g, '');
    if (cleanUrl.endsWith('/')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }
    
    // 2. Substring starting from the protocol handler 'knovant://'
    const protocolIndex = cleanUrl.indexOf('knovant://');
    if (protocolIndex !== -1) {
      cleanUrl = cleanUrl.substring(protocolIndex);
    }
    logDebug(`[handleDeepLink] cleaned URL: ${cleanUrl}`);
    
    // Extract access_token and refresh_token from hash or query parameters to be 100% robust
    let hash = '';
    if (cleanUrl.includes('#')) {
      hash = cleanUrl.substring(cleanUrl.indexOf('#'));
    } else if (cleanUrl.includes('?')) {
      hash = '#' + cleanUrl.substring(cleanUrl.indexOf('?') + 1);
    }
    logDebug(`[handleDeepLink] extracted hash segment: ${hash}`);
    
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const rawAccessToken = params.get('access_token');
      const rawRefreshToken = params.get('refresh_token');
      logDebug(`[handleDeepLink] rawAccessToken present: ${!!rawAccessToken}, rawRefreshToken present: ${!!rawRefreshToken}`);

      // DO NOT strip characters from the middle of the token to prevent corruption
      // Only trim whitespace and any leading/trailing quotes if they somehow slipped in
      const accessToken = rawAccessToken ? rawAccessToken.trim().replace(/^["']|["']$/g, '') : null;
      const refreshToken = rawRefreshToken ? rawRefreshToken.trim().replace(/^["']|["']$/g, '') : null;

      if (accessToken && refreshToken) {
        logDebug(`[handleDeepLink] Invoking supabase.auth.setSession...`);
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });

        if (error) {
          logDebug(`[handleDeepLink] supabase setSession failed: ${error.message}`);
          throw error;
        }

        // Persist session to store securely
        store.setSession(data.session);
        logDebug(`[handleDeepLink] Supabase session set successfully for: ${data.user.email}`);

        // Notify UI
        if (mainWindow) {
          mainWindow.webContents.send('auth:status-changed', {
            isAuthenticated: true,
            user: data.user
          });
          logDebug(`[handleDeepLink] sent auth:status-changed to mainWindow`);
        } else {
          logDebug(`[handleDeepLink] WARNING: mainWindow was null when trying to send status change`);
        }
      } else {
        logDebug(`[handleDeepLink] missing accessToken or refreshToken after extraction`);
        if (mainWindow) {
          mainWindow.webContents.send('auth:status-changed', {
            isAuthenticated: false,
            error: 'Missing secure session tokens in redirect URL.'
          });
        }
      }
    } else {
      logDebug(`[handleDeepLink] no hash or query segment found in URL`);
      if (mainWindow) {
        mainWindow.webContents.send('auth:status-changed', {
          isAuthenticated: false,
          error: 'No session parameters found in protocol redirect.'
        });
      }
    }
  } catch (e) {
    logDebug(`[handleDeepLink] EXCEPTION: ${e.message}`);
    console.error('[main] Deep link handling failed:', e.message);
    if (mainWindow) {
      mainWindow.webContents.send('auth:status-changed', {
        isAuthenticated: false,
        error: e.message
      });
    }
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
      message: `A new version (${info.version}) of Knovant Deep Research is ready to install. Restart now?`,
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
