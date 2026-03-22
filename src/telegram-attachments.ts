import fs from 'node:fs';
import path from 'node:path';

import type {
  TelegramAttachmentHint,
  TelegramAttachmentKind,
  TelegramResolvedAttachment,
} from './app-state.js';

const TELEGRAM_ATTACHMENT_HINT_RE = /\[Attachment\b([^\]]*)\]/gi;
const TELEGRAM_MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\n]+)\)/g;
const TELEGRAM_MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)\n]+)\)/g;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ANIMATION_EXTENSIONS = new Set(['.gif']);
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
]);
const VOICE_EXTENSIONS = new Set(['.ogg', '.oga', '.opus']);
const VOICE_HINT_RE = /\b(voice|voice[-_ ]?note|memo|recording|spoken|audio[-_ ]?note)\b/i;

export interface TelegramMediaStoragePaths {
  inboxDir: string;
  hostPath: string;
  promptPath: string;
}

export interface TelegramAttachmentResolveOptions {
  groupFolder: string;
  mainGroupFolder: string;
  mainWorkspaceDir: string;
  groupsDir: string;
  projectRoot: string;
  maxBytes: number;
  hints: TelegramAttachmentHint[];
}

export interface TelegramAttachmentSendOutcome {
  attachment: TelegramResolvedAttachment;
  deliveredKind?: TelegramAttachmentKind;
  usedFallback: boolean;
  error?: unknown;
}

interface TelegramAttachmentBot {
  sendPhoto: (chatJid: string, photo: string | Buffer, caption?: string) => Promise<void>;
  sendDocument: (
    chatJid: string,
    document: string | Buffer,
    fileName?: string,
    caption?: string,
  ) => Promise<void>;
  sendVideo: (
    chatJid: string,
    video: string | Buffer,
    fileName?: string,
    caption?: string,
  ) => Promise<void>;
  sendAudio: (
    chatJid: string,
    audio: string | Buffer,
    fileName?: string,
    caption?: string,
  ) => Promise<void>;
  sendVoice: (
    chatJid: string,
    voice: string | Buffer,
    fileName?: string,
    caption?: string,
  ) => Promise<void>;
  sendAnimation: (
    chatJid: string,
    animation: string | Buffer,
    fileName?: string,
    caption?: string,
  ) => Promise<void>;
}

function resolveGroupRoot(
  groupFolder: string,
  mainGroupFolder: string,
  mainWorkspaceDir: string,
  groupsDir: string,
): string {
  return groupFolder === mainGroupFolder
    ? path.resolve(mainWorkspaceDir)
    : path.resolve(groupsDir, groupFolder);
}

function truncateTelegramCaption(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 1024 ? trimmed.slice(0, 1024) : trimmed;
}

function extractAttachmentAttribute(rawAttrs: string, key: string): string | null {
  const pattern = new RegExp(`\\b${key}=(?:\"([^\"]+)\"|'([^']+)'|([^\\s\\]]+))`, 'i');
  const match = rawAttrs.match(pattern);
  if (!match) return null;
  const value = match[1] || match[2] || match[3] || '';
  const trimmed = value.trim().replace(/^`+|`+$/g, '');
  return trimmed || null;
}

function normalizeTelegramReplyText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function parseMarkdownLocalPath(rawTarget: string): string | null {
  const trimmed = rawTarget.trim();
  if (!trimmed) return null;
  let token = trimmed.match(/^\S+/)?.[0] || trimmed;
  token = token.replace(/^<|>$/g, '').replace(/^`+|`+$/g, '');
  if (!token) return null;
  if (token.startsWith('/workspace/')) return token;
  if (token.startsWith('/')) return token;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(token)) return null;
  return token;
}

function isPathWithinBase(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isClearlyVoiceOriented(fileName: string): boolean {
  return VOICE_HINT_RE.test(fileName);
}

export function normalizeTelegramAttachmentKind(value?: string | null): TelegramAttachmentKind | null {
  const normalized = (value || '').trim().toLowerCase();
  switch (normalized) {
    case 'photo':
    case 'document':
    case 'video':
    case 'audio':
    case 'voice':
    case 'animation':
      return normalized;
    default:
      return null;
  }
}

export function inferTelegramAttachmentKind(
  rawPath: string,
  explicitKind?: TelegramAttachmentKind,
): TelegramAttachmentKind {
  if (explicitKind) return explicitKind;

  const fileName = path.basename(rawPath).toLowerCase();
  const ext = path.extname(fileName).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) return 'photo';
  if (ANIMATION_EXTENSIONS.has(ext)) return 'animation';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (VOICE_EXTENSIONS.has(ext)) {
    return isClearlyVoiceOriented(fileName) ? 'voice' : 'audio';
  }
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'document';
}

export function buildTelegramMediaStoragePaths(params: {
  groupFolder: string;
  mainGroupFolder: string;
  mainWorkspaceDir: string;
  groupsDir: string;
  fileName: string;
}): TelegramMediaStoragePaths {
  const groupRoot = resolveGroupRoot(
    params.groupFolder,
    params.mainGroupFolder,
    params.mainWorkspaceDir,
    params.groupsDir,
  );
  const inboxDir = path.join(groupRoot, 'inbox', 'telegram');
  return {
    inboxDir,
    hostPath: path.join(inboxDir, params.fileName),
    promptPath: path.posix.join('inbox', 'telegram', params.fileName),
  };
}

export function extractTelegramAttachmentHints(
  text: string,
): { cleanedText: string; hints: TelegramAttachmentHint[] } {
  const hints: TelegramAttachmentHint[] = [];
  let cleaned = text;

  cleaned = cleaned.replace(TELEGRAM_ATTACHMENT_HINT_RE, (_full, attrs: string) => {
    const rawPath = extractAttachmentAttribute(attrs, 'path');
    if (rawPath) {
      hints.push({
        rawPath,
        kind: normalizeTelegramAttachmentKind(extractAttachmentAttribute(attrs, 'kind') || undefined) || undefined,
        caption: truncateTelegramCaption(extractAttachmentAttribute(attrs, 'caption')),
      });
    }
    return '';
  });

  cleaned = cleaned.replace(
    TELEGRAM_MARKDOWN_IMAGE_RE,
    (full: string, alt: string, target: string) => {
      const localPath = parseMarkdownLocalPath(target);
      if (!localPath) return full;
      hints.push({
        rawPath: localPath,
        kind: 'photo',
        caption: truncateTelegramCaption(alt),
      });
      return '';
    },
  );

  cleaned = cleaned.replace(TELEGRAM_MARKDOWN_LINK_RE, (full: string, target: string) => {
    const localPath = parseMarkdownLocalPath(target);
    if (!localPath) return full;
    hints.push({
      rawPath: localPath,
      kind: normalizeTelegramAttachmentKind(undefined) || undefined,
    });
    return '';
  });

  const deduped = new Map<string, TelegramAttachmentHint>();
  for (const hint of hints) {
    const existing = deduped.get(hint.rawPath);
    if (!existing) {
      deduped.set(hint.rawPath, hint);
      continue;
    }
    deduped.set(hint.rawPath, {
      rawPath: hint.rawPath,
      kind: existing.kind || hint.kind,
      caption: existing.caption || hint.caption,
    });
  }

  return {
    cleanedText: normalizeTelegramReplyText(cleaned),
    hints: Array.from(deduped.values()),
  };
}

export function resolveTelegramAttachmentHostPath(
  options: Omit<TelegramAttachmentResolveOptions, 'hints' | 'maxBytes'>,
  rawPath: string,
): string | null {
  const groupRoot = resolveGroupRoot(
    options.groupFolder,
    options.mainGroupFolder,
    options.mainWorkspaceDir,
    options.groupsDir,
  );
  const projectRoot = path.resolve(options.projectRoot);
  const globalRoot = path.resolve(path.join(options.groupsDir, 'global'));
  const legacyMainGroupRoot =
    options.groupFolder === options.mainGroupFolder
      ? path.resolve(options.groupsDir, options.mainGroupFolder)
      : null;
  const allowedRoots = [groupRoot];
  if (legacyMainGroupRoot && legacyMainGroupRoot !== groupRoot) {
    allowedRoots.push(legacyMainGroupRoot);
  }
  if (options.groupFolder === options.mainGroupFolder) {
    allowedRoots.push(projectRoot);
  }
  if (fs.existsSync(globalRoot)) {
    allowedRoots.push(globalRoot);
  }

  const trimmed = rawPath.trim();
  if (!trimmed) return null;

  const tryLegacyMainGroupPath = (relativePath: string): string | null => {
    if (!legacyMainGroupRoot) return null;
    const legacyResolved = path.resolve(legacyMainGroupRoot, relativePath);
    if (!isPathWithinBase(legacyMainGroupRoot, legacyResolved)) {
      return null;
    }
    return fs.existsSync(legacyResolved) ? legacyResolved : null;
  };

  let resolved: string;
  if (trimmed === '/workspace/group') {
    resolved = groupRoot;
  } else if (trimmed.startsWith('/workspace/group/')) {
    const relativePath = trimmed.slice('/workspace/group/'.length);
    resolved = path.resolve(groupRoot, relativePath);
    if (!fs.existsSync(resolved)) {
      const legacyResolved = tryLegacyMainGroupPath(relativePath);
      if (legacyResolved) {
        resolved = legacyResolved;
      }
    }
  } else if (trimmed === '/workspace/project') {
    resolved = projectRoot;
  } else if (trimmed.startsWith('/workspace/project/')) {
    resolved = path.resolve(projectRoot, trimmed.slice('/workspace/project/'.length));
  } else if (trimmed === '/workspace/global') {
    resolved = globalRoot;
  } else if (trimmed.startsWith('/workspace/global/')) {
    resolved = path.resolve(globalRoot, trimmed.slice('/workspace/global/'.length));
  } else if (path.isAbsolute(trimmed)) {
    resolved = path.resolve(trimmed);
  } else {
    resolved = path.resolve(groupRoot, trimmed);
  }

  if (!allowedRoots.some((root) => isPathWithinBase(root, resolved))) {
    return null;
  }
  return resolved;
}

export function resolveTelegramAttachments(
  options: TelegramAttachmentResolveOptions,
): { attachments: TelegramResolvedAttachment[]; skipped: number } {
  const attachments: TelegramResolvedAttachment[] = [];
  let skipped = 0;

  for (const hint of options.hints) {
    const hostPath = resolveTelegramAttachmentHostPath(options, hint.rawPath);
    if (!hostPath) {
      skipped += 1;
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(hostPath);
    } catch {
      skipped += 1;
      continue;
    }

    if (!stat.isFile() || stat.size > options.maxBytes) {
      skipped += 1;
      continue;
    }

    attachments.push({
      hostPath,
      fileName: path.basename(hostPath),
      kind: inferTelegramAttachmentKind(hostPath, hint.kind),
      caption: truncateTelegramCaption(hint.caption),
    });
  }

  return { attachments, skipped };
}

async function sendAttachmentAsKind(
  bot: TelegramAttachmentBot,
  chatJid: string,
  attachment: TelegramResolvedAttachment,
): Promise<TelegramAttachmentKind> {
  const data = fs.readFileSync(attachment.hostPath);
  switch (attachment.kind) {
    case 'photo':
      await bot.sendPhoto(chatJid, data, attachment.caption);
      return 'photo';
    case 'video':
      await bot.sendVideo(chatJid, data, attachment.fileName, attachment.caption);
      return 'video';
    case 'audio':
      await bot.sendAudio(chatJid, data, attachment.fileName, attachment.caption);
      return 'audio';
    case 'voice':
      await bot.sendVoice(chatJid, data, attachment.fileName, attachment.caption);
      return 'voice';
    case 'animation':
      await bot.sendAnimation(chatJid, data, attachment.fileName, attachment.caption);
      return 'animation';
    case 'document':
    default:
      await bot.sendDocument(chatJid, data, attachment.fileName, attachment.caption);
      return 'document';
  }
}

export async function sendResolvedTelegramAttachments(params: {
  bot: TelegramAttachmentBot;
  chatJid: string;
  attachments: TelegramResolvedAttachment[];
}): Promise<TelegramAttachmentSendOutcome[]> {
  const outcomes: TelegramAttachmentSendOutcome[] = [];

  for (const attachment of params.attachments) {
    try {
      const deliveredKind = await sendAttachmentAsKind(params.bot, params.chatJid, attachment);
      outcomes.push({
        attachment,
        deliveredKind,
        usedFallback: false,
      });
      continue;
    } catch (error) {
      if (
        attachment.kind === 'video' ||
        attachment.kind === 'audio' ||
        attachment.kind === 'voice' ||
        attachment.kind === 'animation'
      ) {
        try {
          const data = fs.readFileSync(attachment.hostPath);
          await params.bot.sendDocument(
            params.chatJid,
            data,
            attachment.fileName,
            attachment.caption,
          );
          outcomes.push({
            attachment,
            deliveredKind: 'document',
            usedFallback: true,
          });
          continue;
        } catch (fallbackError) {
          outcomes.push({
            attachment,
            usedFallback: true,
            error: fallbackError,
          });
          continue;
        }
      }

      outcomes.push({
        attachment,
        usedFallback: false,
        error,
      });
    }
  }

  return outcomes;
}
