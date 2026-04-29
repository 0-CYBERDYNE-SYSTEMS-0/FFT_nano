import { complete } from '@mariozechner/pi-ai';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { convertToLlm, serializeConversation } from '@mariozechner/pi-coding-agent';
import { logger } from '../logger.js';

const PROVIDER = 'opencode-go';
const MODEL = 'deepseek-v4-flash';

export default function deepseekV4FlashCompaction(pi: ExtensionAPI) {
  pi.on('session_before_compact', async (event, ctx) => {
    const model = ctx.modelRegistry.find(PROVIDER, MODEL);
    if (!model) return;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) return;

    const { preparation, customInstructions, signal } = event;
    const {
      messagesToSummarize,
      turnPrefixMessages,
      previousSummary,
      firstKeptEntryId,
      tokensBefore,
    } = preparation;
    const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
    if (allMessages.length === 0) return;

    const conversationText = serializeConversation(convertToLlm(allMessages));
    const previousContext = previousSummary
      ? `\n\nPrevious compaction summary:\n${previousSummary}`
      : '';
    const focus = customInstructions
      ? `\n\nAdditional summary focus:\n${customInstructions}`
      : '';

    try {
      const response = await complete(
        model,
        {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Summarize this coding-agent conversation for future continuation.${previousContext}${focus}

Preserve the user's goal, key decisions, files read or changed, current state, blockers, and next steps. Be concise but complete enough for another agent turn to continue accurately.

<conversation>
${conversationText}
</conversation>`,
                },
              ],
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          maxTokens: 8192,
          signal,
        },
      );

      const summary = response.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();

      if (!summary || signal.aborted) return;

      return {
        compaction: {
          summary,
          firstKeptEntryId,
          tokensBefore,
        },
      };
    } catch (err) {
      logger.debug(
        { err },
        'deepseek-v4-flash compaction override failed, falling back to default',
      );
      return;
    }
  });
}
