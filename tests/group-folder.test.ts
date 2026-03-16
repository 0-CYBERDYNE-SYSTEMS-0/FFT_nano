import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isValidGroupFolder,
  resolveGroupFolderPath,
  resolveGroupIpcPath,
} from '../src/group-folder.js';

test('isValidGroupFolder accepts normal names', () => {
  assert.equal(isValidGroupFolder('main'), true);
  assert.equal(isValidGroupFolder('family-chat'), true);
  assert.equal(isValidGroupFolder('Team_42'), true);
});

test('isValidGroupFolder rejects traversal and reserved names', () => {
  assert.equal(isValidGroupFolder('../../etc'), false);
  assert.equal(isValidGroupFolder('/tmp'), false);
  assert.equal(isValidGroupFolder('global'), false);
  assert.equal(isValidGroupFolder(''), false);
});

test('resolveGroupFolderPath and resolveGroupIpcPath keep paths in-bounds', () => {
  const groupPath = resolveGroupFolderPath('family-chat');
  const ipcPath = resolveGroupIpcPath('family-chat');

  assert.ok(groupPath.endsWith('/groups/family-chat'));
  assert.ok(ipcPath.endsWith('/data/ipc/family-chat'));

  assert.throws(() => resolveGroupFolderPath('../../etc'));
  assert.throws(() => resolveGroupIpcPath('/tmp'));
});
