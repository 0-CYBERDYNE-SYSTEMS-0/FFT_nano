/**
 * FFT_nano Desktop App - Electron Main Process
 * 
 * This is the main process that:
 * - Creates and manages the BrowserWindow
 * - Resolves the FFT_nano host (env, git checkout, PATH, CLI, npm, bootstrap)
 * - Spawns `fft start --tui --no-open` as a child process
 * - Parses FFT_NANO_READY port=<N> from stdout
 * - Manages system tray with context menu
 * - Handles IPC via contextBridge
 * - Manages auto-updater
 */

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

// Keep a global reference of the window object
let mainWindow = null;
let tray = null;
let hostProcess = null;
let hostPort = null;
let isQuitting = false;

// Paths
const SOURCE_REPO_ROOT = process.env.SOURCE_REPO_ROOT || path.join(__dirname, '..', '..', '..');
const FFT_NANO_DESKTOP_ROOT = process.env.FFT_NANO_DESKTOP_ROOT;

// Development mode
const isDev = !app.isPackaged;

/**
 * Parse FFT_NANO_READY port=<N> from host stdout
 */
function parseReadyPort(stdout) {
  const match = stdout.match(/FFT_NANO_READY\s+port=(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Check if a path contains the bootstrap complete marker
 */
function hasBootstrapMarker(fftNanoPath) {
  return fs.existsSync(path.join(fftNanoPath, '.fft-nano-bootstrap-complete'));
}

/**
 * Get auth token from .env file in the FFT_nano host directory
 */
function getAuthTokenFromEnv(fftNanoPath) {
  const envPath = path.join(fftNanoPath, '.env');
  if (!fs.existsSync(envPath)) {
    return '';
  }
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed.length === 0) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      const value = trimmed.substring(eqIndex + 1).trim();
      // Remove quotes if present
      const cleanValue = value.replace(/^["']|["']$/g, '');
      if (key === 'FFT_NANO_TUI_AUTH_TOKEN') {
        return cleanValue;
      }
    }
  } catch {
    // Ignore errors
  }
  return '';
}

// Keep track of the current host path for token retrieval
let currentHostPath = null;

/**
 * Check if `fft` command is available on PATH
 */
function isFftOnPath() {
  try {
    execSync('which fft', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find FFT_nano host using the resolver order:
 * 1. FFT_NANO_DESKTOP_ROOT env override
 * 2. SOURCE_REPO_ROOT (dev mode)
 * 3. ACTIVE_FFT_NANO_ROOT git checkout with .fft-nano-bootstrap-complete marker
 * 4. fft on PATH (CLI-installed user)
 * 5. npm-installed fft-nano
 * 6. Bootstrap-needed sentinel
 */
function findFftNanoHost() {
  // 1. FFT_NANO_DESKTOP_ROOT env override
  if (FFT_NANO_DESKTOP_ROOT) {
    console.log('[FFT Desktop] Using FFT_NANO_DESKTOP_ROOT:', FFT_NANO_DESKTOP_ROOT);
    return { type: 'env', path: FFT_NANO_DESKTOP_ROOT };
  }

  // 2. SOURCE_REPO_ROOT (dev mode)
  if (isDev && fs.existsSync(SOURCE_REPO_ROOT)) {
    const pkgPath = path.join(SOURCE_REPO_ROOT, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.name === 'fft_nano') {
          console.log('[FFT Desktop] Using SOURCE_REPO_ROOT (dev mode):', SOURCE_REPO_ROOT);
          return { type: 'dev', path: SOURCE_REPO_ROOT };
        }
      } catch {
        // continue
      }
    }
  }

  // 3. Search for git checkouts with bootstrap marker
  const homeDir = os.homedir();
  const possiblePaths = [
    path.join(homeDir, 'FFT_nano'),
    path.join(homeDir, 'fft_nano'),
    path.join(homeDir, 'nano'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && hasBootstrapMarker(p)) {
      console.log('[FFT Desktop] Found bootstrap complete marker at:', p);
      return { type: 'git', path: p };
    }
  }

  // 4. fft on PATH
  if (isFftOnPath()) {
    try {
      const fftPath = execSync('which fft', { encoding: 'utf8' }).trim();
      // Find the npm package root
      const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      const fftNanoPath = path.join(npmRoot, 'fft_nano');
      if (fs.existsSync(fftNanoPath)) {
        console.log('[FFT Desktop] Found fft_nano via npm global:', fftNanoPath);
        return { type: 'npm', path: fftNanoPath };
      }
    } catch {
      // continue
    }
  }

  // 5. Check for local npm install
  try {
    const npmRoot = execSync('npm root', { encoding: 'utf8' }).trim();
    const fftNanoPath = path.join(npmRoot, 'fft_nano');
    if (fs.existsSync(fftNanoPath)) {
      console.log('[FFT Desktop] Found fft_nano via npm local:', fftNanoPath);
      return { type: 'npm', path: fftNanoPath };
    }
  } catch {
    // continue
  }

  // 6. Bootstrap needed
  console.log('[FFT Desktop] No FFT_nano host found, bootstrap required');
  return { type: 'bootstrap', path: null };
}

/**
 * Run bootstrap installer
 */
async function runBootstrap() {
  const bootstrapScript = process.platform === 'win32' 
    ? path.join(SOURCE_REPO_ROOT, 'scripts', 'install.ps1')
    : path.join(SOURCE_REPO_ROOT, 'scripts', 'install.sh');
  
  const bootstrapCmd = process.platform === 'win32' 
    ? `powershell -ExecutionPolicy Bypass -File "${bootstrapScript}"`
    : `bash "${bootstrapScript}"`;

  console.log('[FFT Desktop] Running bootstrap:', bootstrapCmd);
  
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? 'powershell' : 'bash';
    const shellArgs = process.platform === 'win32' 
      ? ['-ExecutionPolicy', 'Bypass', '-File', bootstrapScript]
      : ['-c', bootstrapScript];

    const child = spawn(shell, shellArgs, {
      cwd: SOURCE_REPO_ROOT,
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Bootstrap failed with code ${code}`));
      }
    });
  });
}

/**
 * Spawn the FFT_nano host process
 */
function spawnHost(fftNanoPath) {
  console.log('[FFT Desktop] Spawning FFT_nano host from:', fftNanoPath);
  
  const isWindows = process.platform === 'win32';
  
  // Use `fft start --tui --no-open` to ensure .env is loaded properly
  // This is the correct way to start the host as it handles env loading, signal handling, etc.
  const fftCmd = isWindows ? 'fft.exe' : 'fft';
  const fftArgs = ['start', '--tui', '--no-open'];
  
  const child = spawn(fftCmd, fftArgs, {
    cwd: fftNanoPath,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdoutData = '';

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    stdoutData += chunk;
    console.log('[FFT Host]', chunk.trim());
  });

  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    console.error('[FFT Host Error]', chunk.trim());
  });

  // Wait for FFT_NANO_READY
  return new Promise((resolve, reject) => {
    const timeoutMs = 30000;
    const startTime = Date.now();

    const checkReady = () => {
      const port = parseReadyPort(stdoutData);
      if (port) {
        hostPort = port;
        console.log('[FFT Desktop] Host ready on port:', port);
        resolve({ child, port });
        return true;
      }
      return false;
    };

    child.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Host exited with code ${code}`));
      } else if (signal) {
        reject(new Error(`Host was killed by signal ${signal}`));
      }
    });

    const interval = setInterval(() => {
      if (checkReady()) {
        clearInterval(interval);
        return;
      }
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        // Timeout - try to get port from environment or use default
        hostPort = parseInt(process.env.FFT_NANO_TUI_PORT || '28989', 10);
        console.log('[FFT Desktop] Host ready timeout, using default port:', hostPort);
        resolve({ child, port: hostPort });
      }
    }, 100);
  });
}

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'FFT_nano',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[FFT Desktop] Window ready and shown');
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[FFT Desktop] Window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create the system tray
 */
function createTray() {
  // Create a simple 16x16 icon programmatically
  const iconSize = 16;
  const icon = nativeImage.createEmpty();
  
  // Use a simple colored square as icon (in production, use actual icon file)
  const iconPath = isDev 
    ? path.join(__dirname, '..', '..', 'assets', 'icon.png')
    : path.join(process.resourcesPath, 'assets', 'icon.png');
  
  let trayIcon;
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize });
  } else {
    // Fallback: create a simple colored icon
    trayIcon = nativeImage.createFromBuffer(
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0xf3, 0xff, 0x61, 0x00, 0x00, 0x00,
        0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9, 0x00, 0x00,
        0x00, 0x44, 0x49, 0x44, 0x41, 0x54, 0x38, 0x8d, 0x63, 0xf8, 0xcf, 0xc0,
        0xf0, 0x1f, 0x06, 0x60, 0x4c, 0x4a, 0x4a, 0x00, 0x31, 0x00, 0xca, 0x10,
        0xc4, 0x40, 0x88, 0x04, 0x44, 0x2c, 0xa0, 0x62, 0x01, 0x16, 0x02, 0xb1,
        0x00, 0x58, 0x24, 0x00, 0x59, 0x03, 0xb2, 0x06, 0x64, 0x4d, 0x80, 0x2c,
        0x00, 0x59, 0x01, 0xb2, 0x02, 0x64, 0x0d, 0x80, 0x5c, 0x00, 0xb9, 0x00,
        0x72, 0x01, 0xe4, 0x02, 0xc8, 0x05, 0x90, 0x0b, 0x20, 0x17, 0x40, 0x2e,
        0x80, 0x5c, 0x00, 0xb9, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x28
      ])
    ).resize({ width: iconSize, height: iconSize });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('FFT_nano');

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

/**
 * Update the tray context menu
 */
function updateTrayMenu() {
  const hostStatus = hostProcess ? 'Running' : 'Stopped';
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Host: ${hostStatus}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open FFT_nano',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Start Host',
      enabled: !hostProcess,
      click: () => startHost(),
    },
    {
      label: 'Stop Host',
      enabled: !!hostProcess,
      click: () => stopHost(),
    },
    {
      label: 'Restart Host',
      enabled: !!hostProcess,
      click: () => restartHost(),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('fftDesktop:openSettings');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit FFT_nano',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Start the FFT_nano host
 */
async function startHost() {
  if (hostProcess) {
    console.log('[FFT Desktop] Host already running');
    return;
  }

  try {
    const hostInfo = findFftNanoHost();
    
    if (hostInfo.type === 'bootstrap') {
      console.log('[FFT Desktop] Running bootstrap first...');
      await runBootstrap();
      // Re-check after bootstrap
      const newHostInfo = findFftNanoHost();
      if (newHostInfo.type === 'bootstrap') {
        throw new Error('Bootstrap failed to install FFT_nano');
      }
      const { child, port } = await spawnHost(newHostInfo.path);
      hostProcess = child;
      hostPort = port;
      currentHostPath = newHostInfo.path;
    } else {
      const { child, port } = await spawnHost(hostInfo.path);
      hostProcess = child;
      hostPort = port;
      currentHostPath = hostInfo.path;
    }

    hostProcess.on('close', (code, signal) => {
      console.log('[FFT Desktop] Host process closed:', code, signal);
      hostProcess = null;
      hostPort = null;
      updateTrayMenu();
    });

    updateTrayMenu();
    
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('fftDesktop:hostStatus', { running: true, port: hostPort });
    }
  } catch (err) {
    console.error('[FFT Desktop] Failed to start host:', err);
    dialog.showErrorBox('Failed to Start FFT_nano', err.message);
  }
}

/**
 * Stop the FFT_nano host
 */
function stopHost() {
  if (!hostProcess) {
    console.log('[FFT Desktop] No host process to stop');
    return;
  }

  console.log('[FFT Desktop] Stopping host process...');
  hostProcess.kill('SIGTERM');
  
  // Force kill after 5 seconds if still alive
  setTimeout(() => {
    if (hostProcess) {
      console.log('[FFT Desktop] Force killing host process');
      hostProcess.kill('SIGKILL');
    }
  }, 5000);
}

/**
 * Restart the FFT_nano host
 */
async function restartHost() {
  console.log('[FFT Desktop] Restarting host...');
  stopHost();
  
  // Wait a moment for process to clean up
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await startHost();
}

/**
 * Setup IPC handlers
 */
function setupIpcHandlers() {
  ipcMain.handle('fftDesktop:getHostStatus', () => {
    return {
      running: !!hostProcess,
      port: hostPort,
    };
  });

  ipcMain.handle('fftDesktop:getAuthToken', () => {
    // Get auth token from .env file in the host directory
    if (currentHostPath) {
      return getAuthTokenFromEnv(currentHostPath);
    }
    // Fallback: try to find host and get token from there
    const hostInfo = findFftNanoHost();
    if (hostInfo.path) {
      return getAuthTokenFromEnv(hostInfo.path);
    }
    return '';
  });

  ipcMain.handle('fftDesktop:startHost', async () => {
    await startHost();
    return { success: true, port: hostPort };
  });

  ipcMain.handle('fftDesktop:stopHost', () => {
    stopHost();
    return { success: true };
  });

  ipcMain.handle('fftDesktop:restartHost', async () => {
    await restartHost();
    return { success: true, port: hostPort };
  });

  ipcMain.handle('fftDesktop:getSettings', () => {
    // Load settings from disk
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      }
    } catch {
      // Ignore
    }
    return {
      theme: 'system',
      notifications: true,
      startOnBoot: false,
      minimizeToTray: true,
    };
  });

  ipcMain.handle('fftDesktop:setSettings', (event, settings) => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true };
  });

  ipcMain.handle('fftDesktop:openExternal', (event, url) => {
    shell.openExternal(url);
    return { success: true };
  });

  ipcMain.handle('fftDesktop:showNotification', (event, title, body) => {
    const { Notification } = require('electron');
    new Notification({ title, body }).show();
    return { success: true };
  });

  ipcMain.handle('fftDesktop:minimizeToTray', () => {
    if (mainWindow) {
      mainWindow.hide();
    }
    return { success: true };
  });

  ipcMain.handle('fftDesktop:getTheme', () => {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  });

  ipcMain.handle('fftDesktop:checkForUpdates', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { success: true, updateAvailable: !!result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

/**
 * Setup auto-updater
 */
function setupAutoUpdater() {
  autoUpdater.logger = console;
  
  autoUpdater.on('update-available', (info) => {
    console.log('[FFT Desktop] Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('fftDesktop:updateAvailable', info);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[FFT Desktop] Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('fftDesktop:updateDownloaded', info);
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[FFT Desktop] Auto-updater error:', err);
  });

  // Check for updates after startup
  if (!isDev) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[FFT Desktop] Update check failed:', err);
      });
    }, 5000);
  }
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('[FFT Desktop] App ready, initializing...');

  createWindow();
  createTray();
  setupIpcHandlers();
  setupAutoUpdater();

  // Try to find and connect to existing host or start a new one
  const hostInfo = findFftNanoHost();
  if (hostInfo.type !== 'bootstrap') {
    // Check if host is already running
    const lockFile = path.join(hostInfo.path, 'data', 'fft_nano.lock');
    try {
      if (fs.existsSync(lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (lockData.pid) {
          // Check if process is actually running
          try {
            process.kill(lockData.pid, 0);
            console.log('[FFT Desktop] Found running host with PID:', lockData.pid);
            hostPort = lockData.port || 28989;
            // Don't spawn new host, just connect to existing
          } catch {
            console.log('[FFT Desktop] Stale lock file, host not running');
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (hostProcess) {
    console.log('[FFT Desktop] Stopping host before quit...');
    hostProcess.kill('SIGTERM');
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[FFT Desktop] Uncaught exception:', error);
  dialog.showErrorBox('FFT_nano Error', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FFT Desktop] Unhandled rejection:', reason);
});

console.log('[FFT Desktop] Main process module loaded');
