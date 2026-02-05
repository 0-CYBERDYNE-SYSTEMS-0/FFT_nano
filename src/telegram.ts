import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';
import { loadJson, saveJson } from './utils.js';

export const TELEGRAM_JID_PREFIX = 'telegram:';

export function isTelegramJid(jid: string): boolean {
  return jid.startsWith(TELEGRAM_JID_PREFIX);
}

export function parseTelegramChatId(jid: string): string | null {
  if (!isTelegramJid(jid)) return null;
  const chatId = jid.slice(TELEGRAM_JID_PREFIX.length);
  return chatId ? chatId : null;
}

export interface TelegramInboundMessage {
  id: string;
  chatJid: string;
  chatName: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
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
}

function getChatName(chat: TelegramMessage['chat']): string {
  if (chat.title) return chat.title;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (chat.username) return `@${chat.username}`;
  return String(chat.id);
}

function getSenderName(from?: TelegramMessage['from']): string {
  if (!from) return 'unknown';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
  if (name) return name;
  if (from.username) return `@${from.username}`;
  return String(from.id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface TelegramBotOptions {
  token: string;
  apiBaseUrl?: string;
}

export interface TelegramBot {
  startPolling: (onMessage: (m: TelegramInboundMessage) => Promise<void>) => void;
  sendMessage: (chatJid: string, text: string) => Promise<void>;
  setTyping: (chatJid: string, isTyping: boolean) => Promise<void>;
}

export function createTelegramBot(opts: TelegramBotOptions): TelegramBot {
  const apiBaseUrl = opts.apiBaseUrl || 'https://api.telegram.org';
  const base = `${apiBaseUrl}/bot${opts.token}`;

  const statePath = path.join(DATA_DIR, 'telegram_state.json');
  const state = loadJson<{ offset?: number }>(statePath, {});
  let offset = state.offset || 0;
  let lastPersistedOffset = offset;

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

  function startPolling(onMessage: (m: TelegramInboundMessage) => Promise<void>): void {
    const loop = async () => {
      while (true) {
        try {
          const updates = await apiGet<TelegramUpdate[]>('getUpdates', {
            timeout: '25',
            offset: String(offset),
            allowed_updates: JSON.stringify(['message', 'edited_message']),
          });

          for (const u of updates) {
            offset = Math.max(offset, u.update_id + 1);
            const msg = u.message || u.edited_message;
            if (!msg) continue;

            const content = msg.text || msg.caption || '';
            if (!content) continue;

            const chatId = String(msg.chat.id);
            const chatJid = `${TELEGRAM_JID_PREFIX}${chatId}`;
            const timestamp = new Date(msg.date * 1000).toISOString();
            const chatName = getChatName(msg.chat);
            const sender = msg.from ? `${TELEGRAM_JID_PREFIX}${msg.from.id}` : 'telegram:unknown';
            const senderName = getSenderName(msg.from);

            const inbound: TelegramInboundMessage = {
              id: `${chatJid}:${msg.message_id}`,
              chatJid,
              chatName,
              sender,
              senderName,
              content,
              timestamp,
            };

            await onMessage(inbound);
          }

          persistOffset();
        } catch (err) {
          logger.error({ err }, 'Telegram polling error');
          await sleep(2000);
        }
      }
    };

    loop().catch((err) => logger.error({ err }, 'Telegram poll loop crashed'));
  }

  async function sendMessage(chatJid: string, text: string): Promise<void> {
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) {
      throw new Error(`Invalid Telegram chat JID: ${chatJid}`);
    }

    await apiPost('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  }

  async function setTyping(chatJid: string, isTyping: boolean): Promise<void> {
    if (!isTyping) return;
    const chatId = parseTelegramChatId(chatJid);
    if (!chatId) return;
    await apiPost('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  return { startPolling, sendMessage, setTyping };
}

