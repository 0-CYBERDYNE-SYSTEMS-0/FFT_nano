export interface SendResult {
  success: boolean;
  messageId: string;
  error?: string;
}

export interface PlatformAdapter {
  send(chatId: string, content: string, replyTo?: string): Promise<SendResult>;

  editMessage(
    chatId: string,
    messageId: string,
    content: string,
    finalize?: boolean,
  ): Promise<SendResult>;

  deleteMessage(chatId: string, messageId: string): Promise<void>;

  setReaction?(
    chatId: string,
    messageId: string,
    emoji: string | null,
  ): Promise<void>;

  sendDraft?(
    chatId: string,
    draftId: number,
    content: string,
  ): Promise<SendResult>;

  supportsDraftStreaming?(chatId: string): boolean;
}
