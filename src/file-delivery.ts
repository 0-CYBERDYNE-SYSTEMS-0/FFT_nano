import fs from 'fs';
import path from 'path';

import { logger } from './logger.js';
import type {
  FileDeliveryKind,
  FileDeliveryRequest,
  FileDeliveryResult,
  RegisteredGroup,
} from './types.js';

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.flv', '.wmv',
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma',
]);

export function resolveFileKind(filePath: string): FileDeliveryKind {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'photo';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  return 'document';
}

export function isAllowedDeliveryPath(
  filePath: string,
  groupWorkspaceDir: string,
): boolean {
  const resolved = path.resolve(filePath);
  const workspaceResolved = path.resolve(groupWorkspaceDir);
  const relative = path.relative(workspaceResolved, resolved);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export interface FileDeliveryDeps {
  telegramBot?: {
    sendPhoto: (
      chatJid: string,
      photo: string | Buffer,
      caption?: string,
    ) => Promise<void>;
    sendDocument: (
      chatJid: string,
      document: string | Buffer,
      fileName?: string,
      caption?: string,
    ) => Promise<void>;
    sendVideo: (
      chatJid: string,
      video: string | Buffer,
      caption?: string,
    ) => Promise<void>;
    sendAudio: (
      chatJid: string,
      audio: string | Buffer,
      caption?: string,
    ) => Promise<void>;
  };
  registeredGroups: Record<string, RegisteredGroup>;
  resolveGroupWorkspaceDir: (groupFolder: string) => string;
}

export async function processFileDeliveryRequest(
  request: FileDeliveryRequest,
  context: {
    sourceGroup: string;
    isMain: boolean;
    chatJid?: string;
  },
  deps: FileDeliveryDeps,
): Promise<FileDeliveryResult> {
  const executedAt = new Date().toISOString();
  const { filePath, caption, kind: kindHint, chatJid: targetChatJid } = request.params;

  try {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required and must be a string');
    }

    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    if (!fs.statSync(resolvedPath).isFile()) {
      throw new Error(`Path is not a file: ${filePath}`);
    }

    const workspaceDir = deps.resolveGroupWorkspaceDir(context.sourceGroup);
    if (!isAllowedDeliveryPath(resolvedPath, workspaceDir)) {
      throw new Error(
        `File path "${filePath}" is outside the group workspace; only files within ${workspaceDir} can be delivered`,
      );
    }

    const chatJid =
      targetChatJid ||
      context.chatJid ||
      deps.registeredGroups[context.sourceGroup]?.name;

    if (!chatJid) {
      throw new Error(`Could not resolve target chatJid for group: ${context.sourceGroup}`);
    }

    if (!deps.telegramBot) {
      throw new Error('Telegram bot is not available');
    }

    const kind = kindHint || resolveFileKind(filePath);
    const fileData = fs.readFileSync(resolvedPath);
    const sizeBytes = fileData.length;
    const fileName = path.basename(resolvedPath);

    switch (kind) {
      case 'photo':
        await deps.telegramBot.sendPhoto(chatJid, fileData, caption);
        break;
      case 'video':
        await deps.telegramBot.sendVideo(chatJid, fileData, caption);
        break;
      case 'audio':
        await deps.telegramBot.sendAudio(chatJid, fileData, caption);
        break;
      case 'document':
      default:
        await deps.telegramBot.sendDocument(chatJid, fileData, fileName, caption);
        break;
    }

    logger.info(
      { requestId: request.requestId, kind, filePath, chatJid, sizeBytes },
      'File delivered successfully',
    );

    return {
      requestId: request.requestId,
      status: 'success',
      result: {
        kind,
        sizeBytes,
        deliveredTo: chatJid,
      },
      executedAt,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn(
      { requestId: request.requestId, filePath, err },
      'File delivery failed',
    );

    return {
      requestId: request.requestId,
      status: 'error',
      error: errorMessage,
      executedAt,
    };
  }
}

export async function deliverFileToChat(
  deps: FileDeliveryDeps,
  params: {
    filePath: string;
    chatJid: string;
    caption?: string;
    kind?: FileDeliveryKind;
  },
): Promise<{ success: boolean; error?: string; kind?: FileDeliveryKind; sizeBytes?: number }> {
  const { filePath, chatJid, caption, kind: kindHint } = params;

  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }

    if (!deps.telegramBot) {
      return { success: false, error: 'Telegram bot is not available' };
    }

    const kind = kindHint || resolveFileKind(filePath);
    const fileData = fs.readFileSync(filePath);
    const sizeBytes = fileData.length;

    switch (kind) {
      case 'photo':
        await deps.telegramBot.sendPhoto(chatJid, fileData, caption);
        break;
      case 'video':
        await deps.telegramBot.sendVideo(chatJid, fileData, caption);
        break;
      case 'audio':
        await deps.telegramBot.sendAudio(chatJid, fileData, caption);
        break;
      case 'document':
      default:
        await deps.telegramBot.sendDocument(chatJid, fileData, path.basename(filePath), caption);
        break;
    }

    return { success: true, kind, sizeBytes };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
