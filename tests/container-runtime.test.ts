import assert from 'node:assert/strict';
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

test('getContainerRuntime requires explicit host opt-in', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: 'host',
      FFT_NANO_ALLOW_HOST_RUNTIME: '0',
    },
    () => {
      assert.throws(
        () => getContainerRuntime(),
        /requires FFT_NANO_ALLOW_HOST_RUNTIME=1/i,
      );
    },
  );
});

test('getContainerRuntime accepts host mode with allow flag', () => {
  withEnv(
    {
      CONTAINER_RUNTIME: 'host',
      FFT_NANO_ALLOW_HOST_RUNTIME: '1',
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

