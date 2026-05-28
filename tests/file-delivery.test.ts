import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeFileDeliveryRequest,
  processFileDeliveryRequest,
} from '../src/file-delivery.js';
import type { FileDeliveryRequest, RegisteredGroup } from '../src/types.js';

function makeRequest(filePath: string): FileDeliveryRequest {
  return {
    type: 'farm_action',
    action: 'deliver_file',
    requestId: `deliver-${Date.now().toString(36)}`,
    params: {
      filePath,
      chatJid: 'telegram:1',
      kind: 'document',
    },
  };
}

test('processFileDeliveryRequest resolves relative paths inside the source workspace', async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-delivery-'));
  t.after(() => fs.rmSync(workspaceDir, { recursive: true, force: true }));

  fs.writeFileSync(path.join(workspaceDir, 'trip.html'), '<html>ok</html>');
  const sentDocuments: Array<{ fileName?: string; text: string }> = [];
  const registeredGroups: Record<string, RegisteredGroup> = {
    'telegram:1': {
      name: 'main',
      folder: 'main',
      trigger: '@fft_nano',
      added_at: '2026-05-11T00:00:00.000Z',
    },
  };

  const result = await processFileDeliveryRequest(
    makeRequest('trip.html'),
    { sourceGroup: 'main', isMain: true, chatJid: 'telegram:1' },
    {
      registeredGroups,
      resolveGroupWorkspaceDir: () => workspaceDir,
      telegramBot: {
        sendPhoto: async () => {},
        sendVideo: async () => {},
        sendAudio: async () => {},
        sendDocument: async (_chatJid, document, fileName) => {
          sentDocuments.push({
            fileName,
            text: Buffer.isBuffer(document)
              ? document.toString('utf8')
              : String(document),
          });
        },
      },
    },
  );

  assert.equal(result.status, 'success');
  assert.deepEqual(sentDocuments, [
    { fileName: 'trip.html', text: '<html>ok</html>' },
  ]);
});

test('processFileDeliveryRequest rejects paths outside the source workspace', async (t) => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-delivery-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-outside-'));
  t.after(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  const outsidePath = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(outsidePath, 'nope');

  const result = await processFileDeliveryRequest(
    makeRequest(outsidePath),
    { sourceGroup: 'main', isMain: true, chatJid: 'telegram:1' },
    {
      registeredGroups: {},
      resolveGroupWorkspaceDir: () => workspaceDir,
      telegramBot: {
        sendPhoto: async () => {},
        sendVideo: async () => {},
        sendAudio: async () => {},
        sendDocument: async () => {
          throw new Error('should not send outside workspace file');
        },
      },
    },
  );

  assert.equal(result.status, 'error');
  assert.match(result.error || '', /outside the group workspace/);
  assert.match(
    result.error || '',
    new RegExp(workspaceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
});

test('normalizeFileDeliveryRequest accepts legacy deliver_file payloads', () => {
  const normalized = normalizeFileDeliveryRequest({
    type: 'deliver_file',
    action: 'deliver_file',
    requestId: 'legacy-video-1',
    params: {
      filePath: 'out.mp4',
      caption: 'ready',
      kind: 'video',
    },
  });

  assert.deepEqual(normalized, {
    type: 'farm_action',
    action: 'deliver_file',
    requestId: 'legacy-video-1',
    params: {
      filePath: 'out.mp4',
      caption: 'ready',
      kind: 'video',
      chatJid: undefined,
    },
  });
});

test('normalizeFileDeliveryRequest rejects poison payloads', () => {
  assert.throws(
    () =>
      normalizeFileDeliveryRequest({
        type: 'deliver_file',
        action: 'something_else',
        requestId: 'bad-1',
        params: {},
      }),
    /farm_action deliver_file or legacy deliver_file/,
  );
});
