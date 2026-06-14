import type { PlatformAdapter } from './types.js';
import { DarwinAdapter } from './darwin.js';
import { LinuxAdapter } from './linux.js';
import { Win32Adapter } from './win32.js';
import { AndroidAdapter } from './android.js';

let cachedAdapter: PlatformAdapter | null = null;

/**
 * Returns the appropriate PlatformAdapter for the current platform.
 * Uses a cached instance to avoid repeated platform detection.
 */
export function getPlatformAdapter(): PlatformAdapter {
  if (cachedAdapter) return cachedAdapter;

  switch (process.platform) {
    case 'darwin':
      cachedAdapter = new DarwinAdapter();
      break;
    case 'linux':
      // Check if running in Termux on Android
      if (isAndroidTermux()) {
        cachedAdapter = new AndroidAdapter();
      } else {
        cachedAdapter = new LinuxAdapter();
      }
      break;
    case 'win32':
      cachedAdapter = new Win32Adapter();
      break;
    case 'android':
      cachedAdapter = new AndroidAdapter();
      break;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return cachedAdapter;
}

/**
 * Check if running in Termux on Android
 */
function isAndroidTermux(): boolean {
  // Termux sets PREFIX environment variable
  // and typically has /data/data/com.termux/files/usr as PREFIX
  return (
    process.platform === 'linux' &&
    !!process.env.PREFIX &&
    (process.env.PREFIX.includes('com.termux') ||
      process.env.PREFIX.includes('termux'))
  );
}

export type { PlatformAdapter } from './types.js';
