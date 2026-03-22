import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { TelegramResolvedAttachment } from '../src/app-state.js';
import {
  buildTelegramMediaStoragePaths,
  extractTelegramAttachmentHints,
  resolveTelegramAttachments,
  sendResolvedTelegramAttachments,
} from '../src/telegram-attachments.js';

const thisFilePath = fileURLToPath(import.meta.url);

test('buildTelegramMediaStoragePaths uses main workspace for main chat uploads', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-telegram-main-'));
  const workspaceDir = path.join(root, 'nano');
  const groupsDir = path.join(root, 'groups');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(groupsDir, { recursive: true });

  try {
    const result = buildTelegramMediaStoragePaths({
      groupFolder: 'main',
      mainGroupFolder: 'main',
      mainWorkspaceDir: workspaceDir,
      groupsDir,
      fileName: '2026-03-21_1186_skill.zip',
    });

    assert.equal(result.inboxDir, path.join(workspaceDir, 'inbox', 'telegram'));
    assert.equal(
      result.hostPath,
      path.join(workspaceDir, 'inbox', 'telegram', '2026-03-21_1186_skill.zip'),
    );
    assert.equal(result.promptPath, 'inbox/telegram/2026-03-21_1186_skill.zip');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractTelegramAttachmentHints parses explicit kind and markdown image hints', () => {
  const result = extractTelegramAttachmentHints([
    'Before',
    '[Attachment path=inbox/telegram/demo.mp4 kind=video caption="Demo clip"]',
    '![Screenshot](/workspace/project/out/screen.png)',
    'After',
  ].join('\n'));

  assert.equal(result.cleanedText, 'Before\n\nAfter');
  assert.deepEqual(result.hints, [
    {
      rawPath: 'inbox/telegram/demo.mp4',
      kind: 'video',
      caption: 'Demo clip',
    },
    {
      rawPath: '/workspace/project/out/screen.png',
      kind: 'photo',
      caption: 'Screenshot',
    },
  ]);
});

test('resolveTelegramAttachments accepts relative paths, legacy workspace paths, and inferred kinds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-telegram-resolve-'));
  const workspaceDir = path.join(root, 'nano');
  const projectRoot = path.join(root, 'project');
  const groupsDir = path.join(root, 'groups');
  const globalDir = path.join(groupsDir, 'global');
  fs.mkdirSync(path.join(workspaceDir, 'inbox', 'telegram'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'out'), { recursive: true });
  fs.mkdirSync(path.join(globalDir, 'exports'), { recursive: true });

  const relativeFile = path.join(workspaceDir, 'inbox', 'telegram', 'clip.mp4');
  const legacyFile = path.join(workspaceDir, 'legacy.jpg');
  const globalFile = path.join(globalDir, 'exports', 'report.pdf');
  fs.writeFileSync(relativeFile, 'video');
  fs.writeFileSync(legacyFile, 'image');
  fs.writeFileSync(globalFile, 'pdf');

  try {
    const result = resolveTelegramAttachments({
      groupFolder: 'main',
      mainGroupFolder: 'main',
      mainWorkspaceDir: workspaceDir,
      groupsDir,
      projectRoot,
      maxBytes: 1024 * 1024,
      hints: [
        { rawPath: 'inbox/telegram/clip.mp4' },
        { rawPath: '/workspace/group/legacy.jpg' },
        { rawPath: '/workspace/global/exports/report.pdf' },
      ],
    });

    assert.deepEqual(
      result.attachments.map((attachment) => ({
        fileName: attachment.fileName,
        kind: attachment.kind,
      })),
      [
        { fileName: 'clip.mp4', kind: 'video' },
        { fileName: 'legacy.jpg', kind: 'photo' },
        { fileName: 'report.pdf', kind: 'document' },
      ],
    );
    assert.equal(result.skipped, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveTelegramAttachments preserves legacy main-chat /workspace/group paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-telegram-legacy-main-'));
  const workspaceDir = path.join(root, 'nano');
  const projectRoot = path.join(root, 'project');
  const groupsDir = path.join(root, 'groups');
  const legacyInboxDir = path.join(groupsDir, 'main', 'inbox', 'telegram');
  fs.mkdirSync(workspaceDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(legacyInboxDir, { recursive: true });

  const legacyFile = path.join(legacyInboxDir, 'historic.zip');
  fs.writeFileSync(legacyFile, 'zip');

  try {
    const result = resolveTelegramAttachments({
      groupFolder: 'main',
      mainGroupFolder: 'main',
      mainWorkspaceDir: workspaceDir,
      groupsDir,
      projectRoot,
      maxBytes: 1024 * 1024,
      hints: [{ rawPath: '/workspace/group/inbox/telegram/historic.zip' }],
    });

    assert.equal(result.skipped, 0);
    assert.equal(result.attachments.length, 1);
    assert.equal(result.attachments[0]?.hostPath, legacyFile);
    assert.equal(result.attachments[0]?.fileName, 'historic.zip');
    assert.equal(result.attachments[0]?.kind, 'document');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveTelegramAttachments only infers voice for explicit or voice-oriented files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-telegram-voice-'));
  const workspaceDir = path.join(root, 'nano');
  const groupsDir = path.join(root, 'groups');
  const inboxDir = path.join(workspaceDir, 'inbox', 'telegram');
  fs.mkdirSync(inboxDir, { recursive: true });
  fs.writeFileSync(path.join(inboxDir, 'track.ogg'), 'ogg');
  fs.writeFileSync(path.join(inboxDir, 'voice-note.ogg'), 'ogg');

  try {
    const result = resolveTelegramAttachments({
      groupFolder: 'main',
      mainGroupFolder: 'main',
      mainWorkspaceDir: workspaceDir,
      groupsDir,
      projectRoot: root,
      maxBytes: 1024 * 1024,
      hints: [
        { rawPath: 'inbox/telegram/track.ogg' },
        { rawPath: 'inbox/telegram/voice-note.ogg' },
        { rawPath: 'inbox/telegram/track.ogg', kind: 'voice' },
      ],
    });

    assert.deepEqual(
      result.attachments.map((attachment) => attachment.kind),
      ['audio', 'voice', 'voice'],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sendResolvedTelegramAttachments dispatches each supported kind', async () => {
  const calls: string[] = [];
  const attachmentKinds: TelegramResolvedAttachment['kind'][] = [
    'photo',
    'video',
    'audio',
    'voice',
    'animation',
    'document',
  ];
  const attachments = attachmentKinds.map((kind) => ({
    hostPath: thisFilePath,
    fileName: `${kind}.bin`,
    kind,
    caption: `${kind} caption`,
  })) satisfies TelegramResolvedAttachment[];

  await sendResolvedTelegramAttachments({
    bot: {
      sendPhoto: async () => {
        calls.push('photo');
      },
      sendVideo: async () => {
        calls.push('video');
      },
      sendAudio: async () => {
        calls.push('audio');
      },
      sendVoice: async () => {
        calls.push('voice');
      },
      sendAnimation: async () => {
        calls.push('animation');
      },
      sendDocument: async () => {
        calls.push('document');
      },
    },
    chatJid: 'telegram:1',
    attachments,
  });

  assert.deepEqual(calls, attachmentKinds);
});

test('sendResolvedTelegramAttachments retries failed specialized media as document', async () => {
  const calls: string[] = [];

  await sendResolvedTelegramAttachments({
    bot: {
      sendPhoto: async () => {
        throw new Error('unused');
      },
      sendVideo: async () => {
        calls.push('video');
        throw new Error('telegram rejected video');
      },
      sendAudio: async () => {
        throw new Error('unused');
      },
      sendVoice: async () => {
        throw new Error('unused');
      },
      sendAnimation: async () => {
        throw new Error('unused');
      },
      sendDocument: async () => {
        calls.push('document');
      },
    },
    chatJid: 'telegram:1',
    attachments: [
      {
        hostPath: thisFilePath,
        fileName: 'clip.mp4',
        kind: 'video',
        caption: 'demo',
      },
    ],
  });

  assert.deepEqual(calls, ['video', 'document']);
});
