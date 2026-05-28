import type { PlatformAdapter, SendResult } from './platform-adapter.js';

interface WhatsAppSocket {
  sendMessage(
    jid: string,
    message: { text: string },
  ): Promise<{ key?: { id?: string } }>;
}

export function createWhatsAppAdapter(sock: WhatsAppSocket): PlatformAdapter {
  return {
    async send(chatId, content, _replyTo?) {
      try {
        const result = await sock.sendMessage(chatId, { text: content });
        const messageId = result?.key?.id || '';
        return { success: true, messageId };
      } catch (err) {
        return {
          success: false,
          messageId: '',
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async editMessage(_chatId, messageId, _content, _finalize?) {
      return {
        success: false,
        messageId,
        error: 'WhatsApp does not support message editing',
      };
    },

    async deleteMessage(_chatId, _messageId) {
      // WhatsApp message deletion not supported in streaming context
    },
  };
}
