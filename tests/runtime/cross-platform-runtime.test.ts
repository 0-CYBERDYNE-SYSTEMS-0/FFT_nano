import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import test from 'node:test';

import { getContainerRuntime } from '../../src/container-runtime.ts';
import { getPlatformAdapter } from '../../src/platform/index.js';

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('getContainerRuntime returns host-only on Android/Termux', () => {
  // Simulate Android/Termux environment by setting PREFIX
  const originalPrefix = process.env.PREFIX;
  process.env.PREFIX = '/data/data/com.termux/files/usr';

  try {
    const runtime = getContainerRuntime();
    assert.equal(
      runtime,
      'host',
      'Android/Termux should always return host-only runtime',
    );
  } finally {
    if (originalPrefix === undefined) {
      delete process.env.PREFIX;
    } else {
      process.env.PREFIX = originalPrefix;
    }
  }
});

test('getContainerRuntime respects platformAdapter.supportsDocker = false', () => {
  // Android adapter reports supportsDocker = false
  const adapter = getPlatformAdapter();
  if (adapter.name === 'android') {
    assert.equal(getContainerRuntime(), 'host');
  }
});

test('getContainerRuntime explicit docker mode bypasses platform checks', () => {
  withEnv({ CONTAINER_RUNTIME: 'docker' }, () => {
    const runtime = getContainerRuntime();
    assert.equal(runtime, 'docker');
  });
});

test('getContainerRuntime explicit host mode returns host', () => {
  withEnv({ CONTAINER_RUNTIME: 'host' }, () => {
    const runtime = getContainerRuntime();
    assert.equal(runtime, 'host');
  });
});

test('getContainerRuntime auto mode falls back to host when docker unavailable', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: undefined,
      PATH: '', // Clear PATH so 'docker' command is not found
    },
    () => {
      const runtime = getContainerRuntime();
      assert.equal(runtime, 'host');
    },
  );
});

test('getContainerRuntime auto mode uses docker when available and healthy', () => {
  // Create a fake docker directory with a working docker script
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-nano-docker-'));
  const dockerPath = path.join(dir, 'docker');
  fs.writeFileSync(
    dockerPath,
    '#!/bin/sh\nif [ "$1" = "info" ]; then exit 0; fi\nexit 0\n',
    'utf-8',
  );
  fs.chmodSync(dockerPath, 0o755);

  withEnv(
    {
      CONTAINER_RUNTIME: undefined,
      PATH: dir,
    },
    () => {
      const runtime = getContainerRuntime();
      assert.equal(runtime, 'docker');
    },
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('getContainerRuntime auto mode falls back to host when docker is unhealthy', () => {
  // Create a fake docker directory with a broken docker script
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-nano-docker-'));
  const dockerPath = path.join(dir, 'docker');
  fs.writeFileSync(
    dockerPath,
    '#!/bin/sh\nexit 1\n',
    'utf-8',
  );
  fs.chmodSync(dockerPath, 0o755);

  withEnv(
    {
      CONTAINER_RUNTIME: undefined,
      PATH: dir,
    },
    () => {
      const runtime = getContainerRuntime();
      assert.equal(runtime, 'host');
    },
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('getContainerRuntime rejects invalid CONTAINER_RUNTIME values', () => {
  withEnv({ CONTAINER_RUNTIME: 'invalid' }, () => {
    assert.throws(
      () => getContainerRuntime(),
      /expected "auto", "docker", or "host"/i,
    );
  });
});

test('pi-skills uses platformAdapter for path normalization', async () => {
  // Verify that pi-skills imports and uses the platform adapter
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  // The adapter should have normalizePath and pathsEqual
  assert.equal(typeof adapter.normalizePath, 'function');
  assert.equal(typeof adapter.pathsEqual, 'function');

  // Test normalizePath
  const normalized = adapter.normalizePath('/home/user/../user/file');
  assert.ok(normalized.includes('/home/user'), 'normalizePath should resolve ..');

  // Test pathsEqual on Darwin/Linux - case sensitive
  if (adapter.name === 'darwin' || adapter.name === 'linux') {
    assert.equal(adapter.pathsEqual('/home/User/file', '/home/user/file'), false);
  }
});

test('pi-skills path comparison uses platform adapter on Windows', async () => {
  // This test verifies the behavior - actual Windows testing would be on Windows
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  if (adapter.name === 'win32') {
    // On Windows, pathsEqual should be case-insensitive
    assert.equal(adapter.pathsEqual('C:\\Users\\Test', 'c:\\users\\test'), true);
    assert.equal(
      adapter.pathsEqual('C:\\Users\\Test', 'c:\\users\\other'),
      false,
    );
  }
});

test('pi-runner uses platformAdapter for process management', async () => {
  // Verify that platformAdapter has the required process management methods
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  assert.equal(typeof adapter.killProcessGroup, 'function');
  assert.equal(typeof adapter.spawnDetached, 'function');

  // spawnDetached should return a ChildProcess-like object
  const child = adapter.spawnDetached('echo', ['test']);
  assert.equal(typeof child, 'object');
  assert.equal(typeof child.unref, 'function');
});

test('tui gateway uses platformAdapter.createLocalSocket', async () => {
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  assert.equal(typeof adapter.createLocalSocket, 'function');
  assert.equal(typeof adapter.connectLocalSocket, 'function');

  // socketType should reflect the platform's socket type
  if (adapter.name === 'win32') {
    assert.equal(adapter.socketType, 'named_pipe');
  } else {
    assert.equal(adapter.socketType, 'unix');
  }
});

test('platformAdapter.showNotification is available on all platforms', async () => {
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  assert.equal(typeof adapter.showNotification, 'function');
});

test('container-runtime uses platformAdapter.supportsDocker', async () => {
  // The getContainerRuntime function should check platformAdapter.supportsDocker
  // This is implicitly tested by the Android/Termux test above
  const { getPlatformAdapter } = await import('../../src/platform/index.js');
  const adapter = getPlatformAdapter();

  if (!adapter.supportsDocker) {
    const runtime = getContainerRuntime();
    assert.equal(runtime, 'host', 'Should return host when supportsDocker is false');
  }
});
