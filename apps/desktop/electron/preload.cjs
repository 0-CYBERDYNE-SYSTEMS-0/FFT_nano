/**
 * FFT_nano Desktop App - Preload Script
 * 
 * This script runs in a sandboxed renderer process and exposes
 * a safe API (fftDesktop.*) to the React frontend via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('fftDesktop', {
  /**
   * Get the current host status
   * @returns {{ running: boolean, port: number | null }}
   */
  getHostStatus: () => {
    return ipcRenderer.invoke('fftDesktop:getHostStatus');
  },

  /**
   * Start the FFT_nano host
   * @returns {{ success: boolean, port?: number }}
   */
  startHost: () => {
    return ipcRenderer.invoke('fftDesktop:startHost');
  },

  /**
   * Stop the FFT_nano host
   * @returns {{ success: boolean }}
   */
  stopHost: () => {
    return ipcRenderer.invoke('fftDesktop:stopHost');
  },

  /**
   * Restart the FFT_nano host
   * @returns {{ success: boolean, port?: number }}
   */
  restartHost: () => {
    return ipcRenderer.invoke('fftDesktop:restartHost');
  },

  /**
   * Get application settings
   * @returns {Object} Settings object
   */
  getSettings: () => {
    return ipcRenderer.invoke('fftDesktop:getSettings');
  },

  /**
   * Save application settings
   * @param {Object} settings - Settings to save
   * @returns {{ success: boolean }}
   */
  setSettings: (settings) => {
    return ipcRenderer.invoke('fftDesktop:setSettings', settings);
  },

  /**
   * Open a URL in the default browser
   * @param {string} url - URL to open
   * @returns {{ success: boolean }}
   */
  openExternal: (url) => {
    return ipcRenderer.invoke('fftDesktop:openExternal', url);
  },

  /**
   * Show a system notification
   * @param {string} title - Notification title
   * @param {string} body - Notification body
   * @returns {{ success: boolean }}
   */
  showNotification: (title, body) => {
    return ipcRenderer.invoke('fftDesktop:showNotification', title, body);
  },

  /**
   * Minimize the window to the system tray
   * @returns {{ success: boolean }}
   */
  minimizeToTray: () => {
    return ipcRenderer.invoke('fftDesktop:minimizeToTray');
  },

  /**
   * Get the system theme
   * @returns {'light' | 'dark'}
   */
  getTheme: () => {
    return ipcRenderer.invoke('fftDesktop:getTheme');
  },

  /**
   * Check for application updates
   * @returns {{ success: boolean, updateAvailable?: boolean, error?: string }}
   */
  checkForUpdates: () => {
    return ipcRenderer.invoke('fftDesktop:checkForUpdates');
  },

  // Event listeners

  /**
   * Listen for host status changes
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onHostStatus: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('fftDesktop:hostStatus', handler);
    return () => {
      ipcRenderer.removeListener('fftDesktop:hostStatus', handler);
    };
  },

  /**
   * Listen for settings panel open request
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('fftDesktop:openSettings', handler);
    return () => {
      ipcRenderer.removeListener('fftDesktop:openSettings', handler);
    };
  },

  /**
   * Listen for update available events
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onUpdateAvailable: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('fftDesktop:updateAvailable', handler);
    return () => {
      ipcRenderer.removeListener('fftDesktop:updateAvailable', handler);
    };
  },

  /**
   * Listen for update downloaded events
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  onUpdateDownloaded: (callback) => {
    const handler = (event, info) => callback(info);
    ipcRenderer.on('fftDesktop:updateDownloaded', handler);
    return () => {
      ipcRenderer.removeListener('fftDesktop:updateDownloaded', handler);
    };
  },
});

console.log('[FFT Desktop] Preload script loaded, fftDesktop API exposed');
