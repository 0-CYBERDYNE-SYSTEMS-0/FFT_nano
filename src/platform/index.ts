import type { PlatformAdapter } from './types.js';
import { DarwinAdapter } from './darwin.js';
import { LinuxAdapter } from './linux.js';
import { Win32Adapter } from './win32.js';
import { AndroidAdapter } from './android.js';

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

/**
 * Returns the appropriate PlatformAdapter for the current platform.
 *
 * NOT cached: tests (and some runtime code paths) mutate process.env.PREFIX
 * to simulate Termux/Android, and a module-level cache would lock in the
 * first detection forever, breaking subsequent platform checks. The
 * adapter constructors are pure (no IO), so the cost is negligible.
 */
export function getPlatformAdapter(): PlatformAdapter {
  switch (process.platform) {
    case 'darwin':
      return new DarwinAdapter();
    case 'linux':
      // Check if running in Termux on Android
      if (isAndroidTermux()) {
        return new AndroidAdapter();
      }
      return new LinuxAdapter();
    case 'win32':
      return new Win32Adapter();
    case 'android':
      return new AndroidAdapter();
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

export type { PlatformAdapter } from './types.js';
