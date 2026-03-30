import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  resolvePromptInputLogPath,
  writePromptInputLogFile,
} from '../src/prompt-input-log.js';

test('writePromptInputLogFile writes prompt diagnostics with metadata and prompt body', () => {
  const groupFolder = 'promptlogtest';
  const requestId = `chat-${Date.now()}-prompt-log`;
  const outPath = resolvePromptInputLogPath(groupFolder, requestId);
  const groupDir = path.dirname(path.dirname(path.dirname(outPath)));

  fs.rmSync(outPath, { force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  try {
    writePromptInputLogFile({
      groupFolder,
      requestId,
      chatJid: 'telegram:test',
      queueMode: 'collect',
      selectedMessageCount: 1,
      recentContextCount: 1,
      noContinue: false,
      latestUserText: 'what did you just say about the news?',
      finalPrompt:
        '[RECENT CONVERSATION]\n[2026-03-29T18:03:48.000Z] FarmFriend: headline summary\n\n[NEW INBOUND MESSAGES]\n[2026-03-29T18:05:12.000Z] TD: what did you just say about the news?',
      createdAt: '2026-03-29T18:05:13.000Z',
    });

    const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8')) as {
      chatJid: string;
      queueMode: string;
      recentContextCount: number;
      finalPrompt: string;
    };

    assert.equal(parsed.chatJid, 'telegram:test');
    assert.equal(parsed.queueMode, 'collect');
    assert.equal(parsed.recentContextCount, 1);
    assert.match(parsed.finalPrompt, /\[RECENT CONVERSATION\]/);
    assert.match(parsed.finalPrompt, /what did you just say about the news\?/);
  } finally {
    fs.rmSync(groupDir, { recursive: true, force: true });
  }
});
