import type { TelegramBot } from '../telegram.js';
import type { PlatformAdapter, SendResult } from './platform-adapter.js';

export function createTelegramAdapter(bot: TelegramBot): PlatformAdapter {
  return {
    async send(chatId, content, _replyTo?) {
      try {
        const messageId = await bot.sendStreamMessage(chatId, content);
        return { success: true, messageId: String(messageId) };
      } catch (err) {
        return {
          success: false,
          messageId: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async editMessage(chatId, messageId, content, _finalize?) {
      try {
        await bot.editStreamMessage(chatId, Number(messageId), content);
        return { success: true, messageId };
      } catch (err) {
        return {
          success: false,
          messageId,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async deleteMessage(chatId, messageId) {
      await bot.deleteMessage(chatId, Number(messageId));
    },

    async setReaction(chatId, messageId, emoji) {
      await bot.setMessageReaction(chatId, Number(messageId), emoji);
    },

    async sendDraft(chatId, draftId, content) {
      try {
        await bot.sendMessageDraft(chatId, draftId, content);
        return { success: true, messageId: String(draftId) };
      } catch (err) {
        return {
          success: false,
          messageId: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    supportsDraftStreaming(_chatId) {
      return true;
    },
  };
}
