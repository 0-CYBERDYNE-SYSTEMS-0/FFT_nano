import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCoderProjectWorkspace } from '../src/coder-project-path.js';

test('resolveCoderProjectWorkspace rejects dot-only slugs', () => {
  assert.throws(
    () =>
      resolveCoderProjectWorkspace({
        mainWorkspaceDir: '/tmp/main',
        slug: '..',
      }),
    /dot-only/i,
  );
  assert.throws(
    () =>
      resolveCoderProjectWorkspace({
        mainWorkspaceDir: '/tmp/main',
        slug: '.',
      }),
    /dot-only/i,
  );
  assert.throws(
    () =>
      resolveCoderProjectWorkspace({
        mainWorkspaceDir: '/tmp/main',
        slug: '...',
      }),
    /dot-only/i,
  );
});

test('resolveCoderProjectWorkspace keeps valid slugs under workspace projects', () => {
  assert.equal(
    resolveCoderProjectWorkspace({
      mainWorkspaceDir: '/tmp/main',
      slug: 'orchard-os.v2',
    }),
    '/tmp/main/workspace/projects/orchard-os.v2',
  );
});
