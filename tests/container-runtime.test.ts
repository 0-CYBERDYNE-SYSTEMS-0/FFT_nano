import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getContainerRuntime } from '../src/container-runtime.ts';

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

test('getContainerRuntime supports explicit docker mode', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: 'docker',
      FFT_NANO_ALLOW_HOST_RUNTIME: undefined,
    },
    () => {
      assert.equal(getContainerRuntime(), 'docker');
    },
  );
});

test('getContainerRuntime accepts explicit host mode without opt-in flags', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: 'host',
      FFT_NANO_ALLOW_HOST_RUNTIME: '0',
    },
    () => {
      assert.equal(getContainerRuntime(), 'host');
    },
  );
});

test('getContainerRuntime auto mode falls back to host when docker is absent', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: undefined,
      PATH: '',
      FFT_NANO_ALLOW_HOST_RUNTIME: undefined,
    },
    () => {
      assert.equal(getContainerRuntime(), 'host');
    },
  );
});

test('getContainerRuntime auto mode uses healthy docker', () => {
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
      FFT_NANO_ALLOW_HOST_RUNTIME: undefined,
    },
    () => {
      assert.equal(getContainerRuntime(), 'docker');
    },
  );
});

test('getContainerRuntime auto mode falls back to host when docker is unhealthy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-nano-docker-'));
  const dockerPath = path.join(dir, 'docker');
  fs.writeFileSync(
    dockerPath,
    '#!/bin/sh\nif [ "$1" = "info" ]; then exit 1; fi\nexit 0\n',
    'utf-8',
  );
  fs.chmodSync(dockerPath, 0o755);

  withEnv(
    {
      CONTAINER_RUNTIME: undefined,
      PATH: dir,
      FFT_NANO_ALLOW_HOST_RUNTIME: undefined,
    },
    () => {
      assert.equal(getContainerRuntime(), 'host');
    },
  );
});

test('getContainerRuntime rejects legacy apple mode', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: 'apple',
      FFT_NANO_ALLOW_HOST_RUNTIME: undefined,
    },
    () => {
      assert.throws(
        () => getContainerRuntime(),
        /expected "auto", "docker", or "host"/i,
      );
    },
  );
});
