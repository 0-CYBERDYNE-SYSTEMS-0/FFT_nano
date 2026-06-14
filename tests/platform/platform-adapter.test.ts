import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { platform } from 'process';
import path from 'path';

describe('PlatformAdapter', () => {
  describe('DarwinAdapter (imported if on darwin)', () => {
    test('has correct name property', async () => {
      if (platform !== 'darwin') {
        // On non-darwin, import and verify interface only
        const { DarwinAdapter } = await import('../../src/platform/darwin.js');
        const adapter = new DarwinAdapter();
        assert.equal(adapter.name, 'darwin');
        assert.equal(adapter.supportsDocker, true);
        assert.equal(adapter.socketType, 'unix');
      } else {
        const { DarwinAdapter } = await import('../../src/platform/darwin.js');
        const adapter = new DarwinAdapter();
        assert.equal(adapter.name, 'darwin');
        assert.equal(adapter.supportsDocker, true);
        assert.equal(adapter.socketType, 'unix');
      }
    });

    test('normalizePath uses posix normalization', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const adapter = new DarwinAdapter();
      const result = adapter.normalizePath('/home/user/../user/file');
      assert.equal(result, '/home/user/file');
    });

    test('pathsEqual compares posix paths', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const adapter = new DarwinAdapter();
      assert.equal(adapter.pathsEqual('/home/user/file', '/home/user/file'), true);
      assert.equal(adapter.pathsEqual('/home/user/../user/file', '/home/user/file'), true);
      assert.equal(adapter.pathsEqual('/home/user/file', '/home/other/file'), false);
    });

    test('getServiceStatus returns one of valid states', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const adapter = new DarwinAdapter();
      // Just verify it returns a valid state (actual value depends on system)
      const status = await adapter.getServiceStatus();
      assert.ok(['running', 'stopped', 'not_installed'].includes(status));
    });
  });

  describe('LinuxAdapter', () => {
    test('has correct name property', async () => {
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const adapter = new LinuxAdapter();
      assert.equal(adapter.name, 'linux');
      assert.equal(adapter.supportsDocker, true);
      assert.equal(adapter.socketType, 'unix');
    });

    test('normalizePath uses posix normalization', async () => {
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const adapter = new LinuxAdapter();
      const result = adapter.normalizePath('/home/user/../user/file');
      assert.equal(result, '/home/user/file');
    });

    test('pathsEqual compares posix paths', async () => {
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const adapter = new LinuxAdapter();
      assert.equal(adapter.pathsEqual('/home/user/file', '/home/user/file'), true);
      assert.equal(adapter.pathsEqual('/home/user/../user/file', '/home/user/file'), true);
      assert.equal(adapter.pathsEqual('/home/user/file', '/home/other/file'), false);
    });

    test('getServiceStatus returns one of valid states', async () => {
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const adapter = new LinuxAdapter();
      const status = await adapter.getServiceStatus();
      assert.ok(['running', 'stopped', 'not_installed'].includes(status));
    });
  });

  describe('Win32Adapter', () => {
    test('has correct name property', async () => {
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const adapter = new Win32Adapter();
      assert.equal(adapter.name, 'win32');
      assert.equal(adapter.supportsDocker, true);
      assert.equal(adapter.socketType, 'named_pipe');
    });

    test('normalizePath uses win32 normalization', async () => {
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const adapter = new Win32Adapter();
      // Win32 normalize handles backslashes and ..
      const result = adapter.normalizePath('C:\\Users\\test\\..\\test\\file');
      assert.equal(result, 'C:\\Users\\test\\file');
    });

    test('pathsEqual compares case-insensitively on Windows', async () => {
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const adapter = new Win32Adapter();
      assert.equal(adapter.pathsEqual('C:\\Users\\Test', 'c:\\users\\test'), true);
      assert.equal(adapter.pathsEqual('C:\\Users\\Test', 'c:\\users\\other'), false);
    });

    test('getServiceStatus returns one of valid states', async () => {
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const adapter = new Win32Adapter();
      const status = await adapter.getServiceStatus();
      assert.ok(['running', 'stopped', 'not_installed'].includes(status));
    });
  });

  describe('AndroidAdapter', () => {
    test('has correct name property', async () => {
      const { AndroidAdapter } = await import('../../src/platform/android.js');
      const adapter = new AndroidAdapter();
      assert.equal(adapter.name, 'android');
      assert.equal(adapter.supportsDocker, false); // Android does NOT support Docker
      assert.equal(adapter.socketType, 'unix');
    });

    test('normalizePath uses posix normalization', async () => {
      const { AndroidAdapter } = await import('../../src/platform/android.js');
      const adapter = new AndroidAdapter();
      const result = adapter.normalizePath('/data/user/../user/file');
      assert.equal(result, '/data/user/file');
    });

    test('pathsEqual compares posix paths', async () => {
      const { AndroidAdapter } = await import('../../src/platform/android.js');
      const adapter = new AndroidAdapter();
      assert.equal(adapter.pathsEqual('/data/user/file', '/data/user/file'), true);
      assert.equal(adapter.pathsEqual('/data/user/../user/file', '/data/user/file'), true);
    });

    test('getServiceStatus returns one of valid states', async () => {
      const { AndroidAdapter } = await import('../../src/platform/android.js');
      const adapter = new AndroidAdapter();
      const status = await adapter.getServiceStatus();
      assert.ok(['running', 'stopped', 'not_installed'].includes(status));
    });
  });

  describe('getPlatformAdapter factory', () => {
    test('returns correct adapter for current platform', async () => {
      const { getPlatformAdapter } = await import('../../src/platform/index.js');
      const adapter = getPlatformAdapter();

      switch (platform) {
        case 'darwin':
          assert.equal(adapter.name, 'darwin');
          break;
        case 'linux':
          // Could be LinuxAdapter or AndroidAdapter depending on env
          assert.ok(['linux', 'android'].includes(adapter.name));
          break;
        case 'win32':
          assert.equal(adapter.name, 'win32');
          break;
      }
    });

    test('returns cached adapter on subsequent calls', async () => {
      const { getPlatformAdapter } = await import('../../src/platform/index.js');
      const adapter1 = getPlatformAdapter();
      const adapter2 = getPlatformAdapter();
      assert.strictEqual(adapter1, adapter2); // Same reference
    });

    test('adapter has all required methods', async () => {
      const { getPlatformAdapter } = await import('../../src/platform/index.js');
      const adapter = getPlatformAdapter();

      // Check all required methods exist
      assert.equal(typeof adapter.name, 'string');
      assert.equal(typeof adapter.installService, 'function');
      assert.equal(typeof adapter.uninstallService, 'function');
      assert.equal(typeof adapter.startService, 'function');
      assert.equal(typeof adapter.stopService, 'function');
      assert.equal(typeof adapter.restartService, 'function');
      assert.equal(typeof adapter.getServiceStatus, 'function');
      assert.equal(typeof adapter.getServiceLogs, 'function');
      assert.equal(typeof adapter.killProcessGroup, 'function');
      assert.equal(typeof adapter.spawnDetached, 'function');
      assert.equal(typeof adapter.showNotification, 'function');
      assert.equal(typeof adapter.getCredential, 'function');
      assert.equal(typeof adapter.setCredential, 'function');
      assert.equal(typeof adapter.deleteCredential, 'function');
      assert.equal(typeof adapter.createLocalSocket, 'function');
      assert.equal(typeof adapter.connectLocalSocket, 'function');
      assert.equal(typeof adapter.normalizePath, 'function');
      assert.equal(typeof adapter.pathsEqual, 'function');
      assert.equal(typeof adapter.supportsDocker, 'boolean');
      assert.equal(typeof adapter.socketType, 'string');
    });
  });

  describe('Platform capabilities', () => {
    test('Unix platforms use unix socket type', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const { AndroidAdapter } = await import('../../src/platform/android.js');

      const darwin = new DarwinAdapter();
      const linux = new LinuxAdapter();
      const android = new AndroidAdapter();

      assert.equal(darwin.socketType, 'unix');
      assert.equal(linux.socketType, 'unix');
      assert.equal(android.socketType, 'unix');
    });

    test('Win32 uses named_pipe socket type', async () => {
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const win = new Win32Adapter();
      assert.equal(win.socketType, 'named_pipe');
    });

    test('Only Android reports docker as false', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const { Win32Adapter } = await import('../../src/platform/win32.js');
      const { AndroidAdapter } = await import('../../src/platform/android.js');

      assert.equal(new DarwinAdapter().supportsDocker, true);
      assert.equal(new LinuxAdapter().supportsDocker, true);
      assert.equal(new Win32Adapter().supportsDocker, true);
      assert.equal(new AndroidAdapter().supportsDocker, false);
    });

    test('spawnDetached returns a ChildProcess-like object', async () => {
      const { getPlatformAdapter } = await import('../../src/platform/index.js');
      const adapter = getPlatformAdapter();
      // Just verify it returns an object with unref method (ChildProcess API)
      const child = adapter.spawnDetached('echo', ['test']);
      assert.equal(typeof child, 'object');
      assert.equal(typeof child.unref, 'function');
    });

    test('Unix spawnDetached preserves requested piped stdio', async () => {
      const { DarwinAdapter } = await import('../../src/platform/darwin.js');
      const { LinuxAdapter } = await import('../../src/platform/linux.js');
      const { AndroidAdapter } = await import('../../src/platform/android.js');

      for (const adapter of [
        new DarwinAdapter(),
        new LinuxAdapter(),
        new AndroidAdapter(),
      ]) {
        const child = adapter.spawnDetached(
          process.execPath,
          ['-e', 'process.stdout.write("ready")'],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );

        assert.ok(child.stdin, `${adapter.name} should preserve piped stdin`);
        assert.ok(child.stdout, `${adapter.name} should preserve piped stdout`);
        assert.ok(child.stderr, `${adapter.name} should preserve piped stderr`);

        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stdin.end();
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', () => resolve());
        });
        assert.equal(stdout, 'ready');
      }
    });
  });
});
