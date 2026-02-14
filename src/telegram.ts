import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { renderTelegramHtmlText, splitTelegramText as splitTelegramMarkdownText } from './telegram-format.js';
import { loadJson, saveJson } from './utils.js';

export const TELEGRAM_JID_PREFIX = 'telegram:';
const TELEGRAM_MAX_MESSAGE_LEN = 4096;
const TELEGRAM_SAFE_MESSAGE_LEN = 4000;
const TELEGRAM_PARSE_ERROR_RE = /can't parse entities|parse entities|find end of the entity/i;
const TELEGRAM_MESSAGE_TOO_LONG_RE = /message is too long/i;
const TELEGRAM_RETRYABLE_ERROR_RE =
  /timed out|timeout|temporarily unavailable|too many requests|retry after|internal server error|bad gateway|service unavailable/i;
const TELEGRAM_RETRY_ATTEMPTS = Math.max(
  1,
  Math.min(
    10,
    Number.parseInt(process.env.FFT_NANO_TELEGRAM_RETRY_ATTEMPTS || '4', 10) || 4,
  ),
);
const TELEGRAM_RETRY_MIN_DELAY_MS = Math.max(
  100,
  Number.parseInt(process.env.FFT_NANO_TELEGRAM_RETRY_MIN_MS || '300', 10) || 300,
);
const TELEGRAM_RETRY_MAX_DELAY_MS = Math.max(
  TELEGRAM_RETRY_MIN_DELAY_MS,
  Number.parseInt(process.env.FFT_NANO_TELEGRAM_RETRY_MAX_MS || '2500', 10) ||
    2500,
);
const TELEGRAM_TYPING_REFRESH_MS = Math.max(
  1000,
  Number.parseInt(process.env.FFT_NANO_TELEGRAM_TYPING_REFRESH_MS || '4000', 10) ||
    4000,
);

class TelegramApiError extends Error {
  method: string;
  statusCode?: number;
  retryAfterSeconds?: number;

  constructor(opts: {
    method: string;
    message: string;
    statusCode?: number;
    retryAfterSeconds?: number;
  }) {
    super(opts.message);
    this.name = 'TelegramApiError';
    this.method = opts.method;
    this.statusCode = opts.statusCode;
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

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
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
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
  return splitTelegramMarkdownText(text, maxLen);
}

export function splitTelegramTextForHtmlLimit(
  text: string,
  maxRenderedLen = TELEGRAM_MAX_MESSAGE_LEN,
): string[] {
  if (!text) return [''];

  const pending = [text];
  const output: string[] = [];

  while (pending.length > 0) {
    const chunk = pending.shift();
    if (chunk === undefined) break;
    const htmlText = renderTelegramHtmlText(chunk, { textMode: 'markdown' });
    if (htmlText.length <= maxRenderedLen || chunk.length <= 1) {
      output.push(chunk);
      continue;
    }

    const proportionalLimit = Math.floor((chunk.length * maxRenderedLen) / htmlText.length);
    const targetLimit = Math.max(1, Math.min(chunk.length - 1, proportionalLimit));
    let parts = splitTelegramText(chunk, targetLimit);
    if (parts.length <= 1 && chunk.length > 1) {
      const fallbackLimit = Math.max(1, Math.floor(chunk.length / 2));
      parts = splitTelegramText(chunk, fallbackLimit);
    }

    if (parts.length <= 1) {
      output.push(chunk);
      continue;
    }

    for (let i = parts.length - 1; i >= 0; i--) {
      pending.unshift(parts[i]);
    }
  }

  return output;
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
  interface TypingLoopState {
    interval: ReturnType<typeof setInterval>;
    inFlight: boolean;
  }
  const typingLoops = new Map<string, TypingLoopState>();

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
    let res: Response;
    try {
      res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TelegramApiError({
        method,
        message: `Telegram API request failed (${method}): ${msg}`,
      });
    }

    let body: TelegramApiResponse<T> | null = null;
    try {
      body = (await res.json()) as TelegramApiResponse<T>;
    } catch {
      body = null;
    }

    if (!res.ok || !body?.ok || body.result === undefined) {
      const description =
        body?.description || `Telegram API error calling ${method} (status ${res.status})`;
      const retryAfter =
        typeof body?.parameters?.retry_after === 'number'
          ? body.parameters.retry_after
          : undefined;
      throw new TelegramApiError({
        method,
        message: description,
        statusCode: body?.error_code || res.status || undefined,
        retryAfterSeconds: retryAfter,
      });
    }
    return body.result;
  }

  function isParseEntityError(err: unknown): boolean {
    if (!(err instanceof TelegramApiError)) return false;
    return TELEGRAM_PARSE_ERROR_RE.test(err.message);
  }

  function isMessageTooLongError(err: unknown): boolean {
    if (err instanceof TelegramApiError) {
      return TELEGRAM_MESSAGE_TOO_LONG_RE.test(err.message);
    }
    if (err instanceof Error) {
      return TELEGRAM_MESSAGE_TOO_LONG_RE.test(err.message);
    }
    return false;
  }

  function isRetryableTelegramError(err: unknown): boolean {
    if (err instanceof TelegramApiError) {
      const statusCode = err.statusCode;
      if (statusCode === 429) return true;
      if (typeof statusCode === 'number' && statusCode >= 500) return true;
      if (statusCode === 408) return true;
      return TELEGRAM_RETRYABLE_ERROR_RE.test(err.message);
    }
    if (err instanceof Error) {
      return TELEGRAM_RETRYABLE_ERROR_RE.test(err.message);
    }
    return false;
  }

  function resolveRetryDelayMs(err: unknown, attempt: number): number {
    if (err instanceof TelegramApiError && typeof err.retryAfterSeconds === 'number') {
      const ms = err.retryAfterSeconds * 1000;
      return Math.min(TELEGRAM_RETRY_MAX_DELAY_MS, Math.max(TELEGRAM_RETRY_MIN_DELAY_MS, ms));
    }
    const exp = TELEGRAM_RETRY_MIN_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(TELEGRAM_RETRY_MAX_DELAY_MS, exp);
  }

  async function apiPostWithRetry<T>(method: string, payload: object): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;

    while (attempt < TELEGRAM_RETRY_ATTEMPTS) {
      attempt++;
      try {
        return await apiPost<T>(method, payload);
      } catch (err) {
        lastErr = err;
        if (!isRetryableTelegramError(err) || attempt >= TELEGRAM_RETRY_ATTEMPTS) {
          throw err;
        }
        const delayMs = resolveRetryDelayMs(err, attempt);
        logger.warn(
          { method, attempt, delayMs, err: err instanceof Error ? err.message : String(err) },
          'Telegram API call failed; retrying',
        );
        await sleep(delayMs);
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error(`Telegram API failed (${method})`);
  }

  async function sendMessageChunk(
    chatId: string,
    chunk: string,
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  ): Promise<void> {
    const pending: Array<{
      text: string;
      replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    }> = [{ text: chunk, replyMarkup }];

    while (pending.length > 0) {
      const current = pending.shift();
      if (!current) break;

      const boundedChunks = splitTelegramTextForHtmlLimit(
        current.text,
        TELEGRAM_MAX_MESSAGE_LEN,
      );
      if (boundedChunks.length > 1) {
        for (let i = boundedChunks.length - 1; i >= 0; i--) {
          pending.unshift({
            text: boundedChunks[i],
            replyMarkup: i === 0 ? current.replyMarkup : undefined,
          });
        }
        continue;
      }

      const textChunk = boundedChunks[0] ?? current.text;
      const htmlText = renderTelegramHtmlText(textChunk, { textMode: 'markdown' });

      try {
        await apiPostWithRetry('sendMessage', {
          chat_id: chatId,
          text: htmlText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(current.replyMarkup ? { reply_markup: current.replyMarkup } : {}),
        });
        continue;
      } catch (err) {
        if (isMessageTooLongError(err) && textChunk.length > 1) {
          const fallbackChunks = splitTelegramText(
            textChunk,
            Math.max(1, Math.floor(textChunk.length / 2)),
          );
          if (fallbackChunks.length > 1) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'Telegram payload still too long after HTML conversion; re-splitting chunk',
            );
            for (let i = fallbackChunks.length - 1; i >= 0; i--) {
              pending.unshift({
                text: fallbackChunks[i],
                replyMarkup: i === 0 ? current.replyMarkup : undefined,
              });
            }
            continue;
          }
        }
        if (!isParseEntityError(err)) throw err;
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'Telegram HTML parse error; falling back to plain text send',
        );
      }

      await apiPostWithRetry('sendMessage', {
        chat_id: chatId,
        text: textChunk,
        disable_web_page_preview: true,
        ...(current.replyMarkup ? { reply_markup: current.replyMarkup } : {}),
      });
    }
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
      if (chunk && chunk.length <= TELEGRAM_MAX_MESSAGE_LEN) {
        await sendMessageChunk(chatId, chunk);
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

    const replyMarkup = buildReplyMarkup(keyboard);
    const chunks = splitTelegramText(text, TELEGRAM_SAFE_MESSAGE_LEN);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || chunk.length > TELEGRAM_MAX_MESSAGE_LEN) continue;
      await sendMessageChunk(chatId, chunk, i === 0 ? replyMarkup : undefined);
    }
  }

  async function setTyping(chatJid: string, isTyping: boolean): Promise<void> {
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) return;

    if (!isTyping) {
      const loop = typingLoops.get(chatId);
      if (loop) {
        clearInterval(loop.interval);
        typingLoops.delete(chatId);
      }
      return;
    }

    if (typingLoops.has(chatId)) return;

    const sendTypingAction = async (): Promise<void> => {
      await apiPostWithRetry('sendChatAction', { chat_id: chatId, action: 'typing' });
    };

    const state: TypingLoopState = {
      interval: setInterval(() => {
        const current = typingLoops.get(chatId);
        if (!current || current.inFlight) return;
        current.inFlight = true;
        void sendTypingAction()
          .catch((err) => {
            logger.debug(
              { chatJid, err: err instanceof Error ? err.message : String(err) },
              'Failed to refresh Telegram typing indicator',
            );
          })
          .finally(() => {
            const latest = typingLoops.get(chatId);
            if (latest) latest.inFlight = false;
          });
      }, TELEGRAM_TYPING_REFRESH_MS),
      inFlight: false,
    };
    typingLoops.set(chatId, state);

    if (!state.inFlight) {
      state.inFlight = true;
      void sendTypingAction()
        .catch((err) => {
          logger.warn(
            { chatJid, err: err instanceof Error ? err.message : String(err) },
            'Failed to start Telegram typing indicator',
          );
        })
        .finally(() => {
          const latest = typingLoops.get(chatId);
          if (latest) latest.inFlight = false;
        });
    }
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
    await apiPostWithRetry('setMyCommands', payload);
  }

  async function deleteCommands(scope?: TelegramCommandScope): Promise<void> {
    const payload: Record<string, unknown> = {};
    const scopePayload = buildCommandScopePayload(scope);
    if (scopePayload) {
      payload.scope = scopePayload;
    }
    await apiPostWithRetry('deleteMyCommands', payload);
  }

  async function setDescription(
    description: string,
    shortDescription?: string,
  ): Promise<void> {
    if (description.trim()) {
      await apiPostWithRetry('setMyDescription', { description });
    }
    if (shortDescription && shortDescription.trim()) {
      await apiPostWithRetry('setMyShortDescription', {
        short_description: shortDescription,
      });
    }
  }

  async function answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
  ): Promise<void> {
    await apiPostWithRetry('answerCallbackQuery', {
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
