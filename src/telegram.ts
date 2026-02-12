import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { loadJson, saveJson } from './utils.js';

export const TELEGRAM_JID_PREFIX = 'telegram:';
const TELEGRAM_MAX_MESSAGE_LEN = 4096;
const TELEGRAM_SAFE_MESSAGE_LEN = 4000;

export function isTelegramJid(jid: string): boolean {
  return jid.startsWith(TELEGRAM_JID_PREFIX);
}

export function parseTelegramChatId(jid: string): string | null {
  if (!isTelegramJid(jid)) return null;
  const chatId = jid.slice(TELEGRAM_JID_PREFIX.length);
  return chatId ? chatId : null;
}

export interface TelegramEntity {
  type: string;
  offset: number;
  length: number;
}

export type TelegramMediaType =
  | 'photo'
  | 'video'
  | 'voice'
  | 'audio'
  | 'document'
  | 'sticker';

export interface TelegramInboundMedia {
  type: TelegramMediaType;
  fileId: string;
  fileSize?: number;
  fileName?: string;
  mimeType?: string;
  emoji?: string;
}

export type TelegramInboundMessageType =
  | 'text'
  | 'photo'
  | 'video'
  | 'voice'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'unknown';

export interface TelegramInboundMessage {
  kind: 'message';
  id: string;
  messageId: number;
  chatJid: string;
  chatName: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  messageType: TelegramInboundMessageType;
  media?: TelegramInboundMedia;
}

export interface TelegramInboundCallbackQuery {
  kind: 'callback_query';
  id: string;
  chatJid: string;
  chatName: string;
  sender: string;
  senderName: string;
  data: string;
  messageId: number;
  timestamp: string;
}

export type TelegramInboundEvent =
  | TelegramInboundMessage
  | TelegramInboundCallbackQuery;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramPhotoSize {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  chat: {
    id: number;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    type: string;
  };
  from?: {
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  photo?: TelegramPhotoSize[];
  video?: {
    file_id: string;
    file_size?: number;
    mime_type?: string;
  };
  voice?: {
    file_id: string;
    file_size?: number;
    mime_type?: string;
  };
  audio?: {
    file_id: string;
    file_size?: number;
    file_name?: string;
    mime_type?: string;
  };
  document?: {
    file_id: string;
    file_size?: number;
    file_name?: string;
    mime_type?: string;
  };
  sticker?: {
    file_id: string;
    file_size?: number;
    emoji?: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
  contact?: {
    phone_number: string;
    first_name?: string;
    last_name?: string;
  };
}

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  message?: TelegramMessage;
}

interface TelegramFileInfo {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callbackData: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export interface TelegramCommand {
  command: string;
  description: string;
}

export type TelegramCommandScope =
  | { type: 'default' }
  | { type: 'chat'; chatId: string };

export interface TelegramDownloadFileResult {
  filePath: string;
  fileSize?: number;
  data: Buffer;
}

function getChatName(chat: TelegramMessage['chat']): string {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (chat.username) return `@${chat.username}`;
  return String(chat.id);
}

function getSenderName(
  from?: TelegramMessage['from'] | TelegramCallbackQuery['from'],
): string {
  if (!from) return 'unknown';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (from.username) return `@${from.username}`;
  return String(from.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractMention(text: string, entity: TelegramEntity): string | null {
  if (entity.type !== 'mention') return null;
  if (entity.offset < 0 || entity.length <= 0) return null;
  return text.substring(entity.offset, entity.offset + entity.length);
}

function normalizeMentionTrigger(
  content: string,
  entities: TelegramEntity[] | undefined,
  botUsername: string | null,
  assistantName: string,
  triggerPattern?: RegExp,
): string {
  if (!botUsername) return content;
  if (!entities?.length) return content;
  if (content.startsWith('/')) return content;

  const mentionedBot = entities.some((entity) => {
    const mention = extractMention(content, entity)?.toLowerCase();
    return mention === `@${botUsername}`;
  });

  if (!mentionedBot) return content;

  const hasTrigger = triggerPattern
    ? triggerPattern.test(content)
    : new RegExp(`^@${assistantName}\\b`, 'i').test(content);
  if (hasTrigger) return content;

  return `@${assistantName} ${content}`;
}

function selectLargestPhoto(photo: TelegramPhotoSize[]): TelegramPhotoSize | null {
  if (photo.length === 0) return null;
  let best = photo[0];
  let bestScore = (best.file_size || 0) + best.width * best.height;
  for (const candidate of photo.slice(1)) {
    const score = (candidate.file_size || 0) + candidate.width * candidate.height;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function buildMessageMedia(msg: TelegramMessage): TelegramInboundMedia | undefined {
  if (msg.photo?.length) {
    const photo = selectLargestPhoto(msg.photo);
    if (photo) {
      return {
        type: 'photo',
        fileId: photo.file_id,
        fileSize: photo.file_size,
      };
    }
  }

  if (msg.video?.file_id) {
    return {
      type: 'video',
      fileId: msg.video.file_id,
      fileSize: msg.video.file_size,
      mimeType: msg.video.mime_type,
    };
  }

  if (msg.voice?.file_id) {
    return {
      type: 'voice',
      fileId: msg.voice.file_id,
      fileSize: msg.voice.file_size,
      mimeType: msg.voice.mime_type,
    };
  }

  if (msg.audio?.file_id) {
    return {
      type: 'audio',
      fileId: msg.audio.file_id,
      fileSize: msg.audio.file_size,
      fileName: msg.audio.file_name,
      mimeType: msg.audio.mime_type,
    };
  }

  if (msg.document?.file_id) {
    return {
      type: 'document',
      fileId: msg.document.file_id,
      fileSize: msg.document.file_size,
      fileName: msg.document.file_name,
      mimeType: msg.document.mime_type,
    };
  }

  if (msg.sticker?.file_id) {
    return {
      type: 'sticker',
      fileId: msg.sticker.file_id,
      fileSize: msg.sticker.file_size,
      emoji: msg.sticker.emoji,
    };
  }

  return undefined;
}

function buildMessageType(msg: TelegramMessage): TelegramInboundMessageType {
  if (msg.text) return 'text';
  if (msg.photo?.length) return 'photo';
  if (msg.video) return 'video';
  if (msg.voice) return 'voice';
  if (msg.audio) return 'audio';
  if (msg.document) return 'document';
  if (msg.sticker) return 'sticker';
  if (msg.location) return 'location';
  if (msg.contact) return 'contact';
  return 'unknown';
}

function buildMessageContent(
  msg: TelegramMessage,
  messageType: TelegramInboundMessageType,
): string {
  const caption = msg.caption ? ` ${msg.caption}` : '';
  switch (messageType) {
    case 'text':
      return msg.text || '';
    case 'photo':
      return `[Photo]${caption}`;
    case 'video':
      return `[Video]${caption}`;
    case 'voice':
      return `[Voice message]${caption}`;
    case 'audio':
      return `[Audio]${caption}`;
    case 'document': {
      const name = msg.document?.file_name || 'file';
      return `[Document: ${name}]${caption}`;
    }
    case 'sticker': {
      const emoji = msg.sticker?.emoji || '';
      return `[Sticker ${emoji}]${caption}`;
    }
    case 'location': {
      const loc = msg.location;
      if (!loc) return '[Location]';
      return `[Location ${loc.latitude}, ${loc.longitude}]`;
    }
    case 'contact': {
      const contact = msg.contact;
      if (!contact) return '[Contact]';
      const name = [contact.first_name, contact.last_name]
        .filter(Boolean)
        .join(' ');
      return name
        ? `[Contact ${name}: ${contact.phone_number}]`
        : `[Contact: ${contact.phone_number}]`;
    }
    default:
      return msg.caption || '';
  }
}

export function splitTelegramText(
  text: string,
  maxLen = TELEGRAM_SAFE_MESSAGE_LEN,
): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < Math.floor(maxLen * 0.5)) {
      splitAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitAt < Math.floor(maxLen * 0.5)) {
      splitAt = maxLen;
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) {
      parts.push(chunk);
    }
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts.length ? parts : [''];
}

export interface TelegramBotOptions {
  token: string;
  apiBaseUrl?: string;
  assistantName?: string;
  triggerPattern?: RegExp;
}

export interface TelegramBot {
  startPolling: (onEvent: (event: TelegramInboundEvent) => Promise<void>) => void;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  sendMessageWithKeyboard: (
    chatJid: string,
    text: string,
    keyboard: TelegramInlineKeyboard,
  ) => Promise<void>;
  setTyping: (chatJid: string, isTyping: boolean) => Promise<void>;
  setCommands: (
    commands: TelegramCommand[],
    scope?: TelegramCommandScope,
  ) => Promise<void>;
  deleteCommands: (scope?: TelegramCommandScope) => Promise<void>;
  setDescription: (description: string, shortDescription?: string) => Promise<void>;
  answerCallbackQuery: (callbackQueryId: string, text?: string) => Promise<void>;
  downloadFile: (fileId: string) => Promise<TelegramDownloadFileResult>;
}

function buildCommandScopePayload(
  scope: TelegramCommandScope | undefined,
): Record<string, unknown> | undefined {
  if (!scope || scope.type === 'default') return undefined;
  return {
    type: 'chat',
    chat_id: scope.chatId,
  };
}

function buildReplyMarkup(
  keyboard: TelegramInlineKeyboard,
): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const inlineKeyboard = keyboard.map((row) =>
    row.map((button) => {
      if (!button.text || !button.callbackData) {
        throw new Error('Inline keyboard buttons require text and callbackData');
      }
      if (Buffer.byteLength(button.callbackData, 'utf8') > 64) {
        throw new Error(
          `callback_data exceeds Telegram 64-byte limit: ${button.callbackData}`,
        );
      }
      return {
        text: button.text,
        callback_data: button.callbackData,
      };
    }),
  );
  return { inline_keyboard: inlineKeyboard };
}

export function createTelegramBot(opts: TelegramBotOptions): TelegramBot {
  const apiBaseUrl = opts.apiBaseUrl || 'https://api.telegram.org';
  const base = `${apiBaseUrl}/bot${opts.token}`;
  const fileBase = `${apiBaseUrl}/file/bot${opts.token}`;
  const assistantName = opts.assistantName || 'FarmFriend';

  const statePath = path.join(DATA_DIR, 'telegram_state.json');
  const state = loadJson<{ offset?: number }>(statePath, {});
  let offset = state.offset || 0;
  let lastPersistedOffset = offset;
  let botUsername: string | null = null;

  async function apiGet<T>(method: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${base}/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString());
    const body = (await res.json()) as TelegramApiResponse<T>;
    if (!body.ok || body.result === undefined) {
      throw new Error(body.description || `Telegram API error calling ${method}`);
    }
    return body.result;
  }

  async function apiPost<T>(method: string, payload: object): Promise<T> {
    const res = await fetch(`${base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as TelegramApiResponse<T>;
    if (!body.ok || body.result === undefined) {
      throw new Error(body.description || `Telegram API error calling ${method}`);
    }
    return body.result;
  }

  function persistOffset(): void {
    if (offset === lastPersistedOffset) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    saveJson(statePath, { offset });
    lastPersistedOffset = offset;
  }

  async function startPolling(
    onEvent: (event: TelegramInboundEvent) => Promise<void>,
  ): Promise<void> {
    try {
      const me = await apiGet<{ username?: string }>('getMe', {});
      botUsername = me.username?.toLowerCase() || null;
    } catch (err) {
      logger.debug({ err }, 'Failed to fetch Telegram bot username');
    }

    while (true) {
      try {
        const updates = await apiGet<TelegramUpdate[]>('getUpdates', {
          timeout: '25',
          offset: String(offset),
          allowed_updates: JSON.stringify([
            'message',
            'edited_message',
            'callback_query',
          ]),
        });

        for (const u of updates) {
          offset = Math.max(offset, u.update_id + 1);

          if (u.callback_query?.message) {
            const callback = u.callback_query;
            const msg = callback.message;
            if (!msg) continue;
            const chatId = String(msg.chat.id);
            const chatJid = `${TELEGRAM_JID_PREFIX}${chatId}`;
            const chatName = getChatName(msg.chat);
            const sender = callback.from
              ? `${TELEGRAM_JID_PREFIX}${callback.from.id}`
              : 'telegram:unknown';
            const senderName = getSenderName(callback.from);
            const timestamp = new Date(
              (msg.date ? msg.date : Date.now() / 1000) * 1000,
            ).toISOString();

            await onEvent({
              kind: 'callback_query',
              id: callback.id,
              chatJid,
              chatName,
              sender,
              senderName,
              data: callback.data || '',
              messageId: msg.message_id,
              timestamp,
            });
            continue;
          }

          const msg = u.message || u.edited_message;
          if (!msg) continue;

          const chatId = String(msg.chat.id);
          const chatJid = `${TELEGRAM_JID_PREFIX}${chatId}`;
          const timestamp = new Date(msg.date * 1000).toISOString();
          const chatName = getChatName(msg.chat);
          const sender = msg.from
            ? `${TELEGRAM_JID_PREFIX}${msg.from.id}`
            : 'telegram:unknown';
          const senderName = getSenderName(msg.from);
          const messageType = buildMessageType(msg);
          const media = buildMessageMedia(msg);

          let content = buildMessageContent(msg, messageType);
          if (messageType === 'text') {
            content = normalizeMentionTrigger(
              content,
              msg.entities,
              botUsername,
              assistantName,
              opts.triggerPattern,
            );
          } else if (!media && msg.caption) {
            content = normalizeMentionTrigger(
              content,
              msg.caption_entities,
              botUsername,
              assistantName,
              opts.triggerPattern,
            );
          }

          if (!content) continue;

          await onEvent({
            kind: 'message',
            id: `${chatJid}:${msg.message_id}`,
            messageId: msg.message_id,
            chatJid,
            chatName,
            sender,
            senderName,
            content,
            timestamp,
            messageType,
            media,
          });
        }

        persistOffset();
      } catch (err) {
        logger.error({ err }, 'Telegram polling error');
        await sleep(2000);
      }
    }
  }

  async function sendMessage(chatJid: string, text: string): Promise<void> {
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) {
      throw new Error(`Invalid Telegram chat JID: ${chatJid}`);
    }

    for (const chunk of splitTelegramText(text, TELEGRAM_SAFE_MESSAGE_LEN)) {
      if (chunk.length <= TELEGRAM_MAX_MESSAGE_LEN) {
        await apiPost('sendMessage', {
          chat_id: chatId,
          text: chunk,
          disable_web_page_preview: true,
        });
      }
    }
  }

  async function sendMessageWithKeyboard(
    chatJid: string,
    text: string,
    keyboard: TelegramInlineKeyboard,
  ): Promise<void> {
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) {
      throw new Error(`Invalid Telegram chat JID: ${chatJid}`);
    }

    await apiPost('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: buildReplyMarkup(keyboard),
    });
  }

  async function setTyping(chatJid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) return;
    await apiPost('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  async function setCommands(
    commands: TelegramCommand[],
    scope?: TelegramCommandScope,
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      commands: commands.map((command) => ({
        command: command.command,
        description: command.description,
      })),
    };
    const scopePayload = buildCommandScopePayload(scope);
    if (scopePayload) {
      payload.scope = scopePayload;
    }
    await apiPost('setMyCommands', payload);
  }

  async function deleteCommands(scope?: TelegramCommandScope): Promise<void> {
    const payload: Record<string, unknown> = {};
    const scopePayload = buildCommandScopePayload(scope);
    if (scopePayload) {
      payload.scope = scopePayload;
    }
    await apiPost('deleteMyCommands', payload);
  }

  async function setDescription(
    description: string,
    shortDescription?: string,
  ): Promise<void> {
    if (description.trim()) {
      await apiPost('setMyDescription', { description });
    }
    if (shortDescription && shortDescription.trim()) {
      await apiPost('setMyShortDescription', {
        short_description: shortDescription,
      });
    }
  }

  async function answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await apiPost('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  }

  async function downloadFile(fileId: string): Promise<TelegramDownloadFileResult> {
    const file = await apiGet<TelegramFileInfo>('getFile', { file_id: fileId });
    if (!file.file_path) {
      throw new Error(`Telegram getFile returned no file_path for ${fileId}`);
    }

    const url = `${fileBase}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed downloading Telegram file: ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      filePath: file.file_path,
      fileSize: file.file_size,
      data: Buffer.from(arrayBuffer),
    };
  }

  return {
    startPolling: (onEvent) => {
      startPolling(onEvent).catch((err) =>
        logger.error({ err }, 'Telegram poll loop crashed'),
      );
    },
    sendMessage,
    sendMessageWithKeyboard,
    setTyping,
    setCommands,
    deleteCommands,
    setDescription,
    answerCallbackQuery,
    downloadFile,
  };
}
