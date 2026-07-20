import { isTelegramFloodControlError, type TelegramBot } from '../telegram.js';
import type { PlatformAdapter, SendResult } from './platform-adapter.js';

export function createTelegramAdapter(bot: TelegramBot): PlatformAdapter {
  return {
    async send(chatId, content, _replyTo?, finalize?) {
      try {
        const messageId = await bot.sendStreamMessage(
          chatId,
          content,
          finalize ? { rich: true } : {},
        );
        return { success: true, messageId: String(messageId) };
      } catch (err) {
        return {
          success: false,
          messageId: '',
          error: err instanceof Error ? err.message : String(err),
          floodControl: isTelegramFloodControlError(err),
        };
      }
    },

    async editMessage(chatId, messageId, content, finalize?) {
      try {
        await bot.editStreamMessage(
          chatId,
          Number(messageId),
          content,
          finalize ? { rich: true } : {},
        );
        return { success: true, messageId };
      } catch (err) {
        if (finalize) {
          // Formatted finalize failed (e.g. HTML render rejected); a plain
          // edit keeps the content correct even without formatting.
          try {
            await bot.editStreamMessage(chatId, Number(messageId), content);
            return { success: true, messageId };
          } catch {
            // fall through to the failure result below
          }
        }
        return {
          success: false,
          messageId,
          error: err instanceof Error ? err.message : String(err),
          floodControl: isTelegramFloodControlError(err),
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
          floodControl: isTelegramFloodControlError(err),
        };
      }
    },

    supportsDraftStreaming(_chatId) {
      return true;
    },
  };
}
