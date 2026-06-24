/**
 * fft-ask-user — Pi Extension
 *
 * Provides a single tool, `ask_user`, that the agent can call to ask the
 * user a structured question mid-run. The question is forwarded to the host
 * via the same `extension_ui_request` RPC channel the permission-gate uses,
 * so the host's existing Telegram keyboard plumbing is reused.
 *
 * 2-6 option labels become one inline-keyboard button per row in the
 * originating Telegram chat. The call resolves to the chosen option label
 * (string) or to the marker `"__timeout__"` if the user does not respond
 * before the timeout.
 *
 * Wiring note: pi's `ctx.ui.select(title, options, opts)` only forwards
 * `title`, `options`, and `timeout` through the RPC frame (see
 * `node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js`
 * and the `RpcExtensionUIRequest` union in
 * `node_modules/.../modes/rpc/rpc-types.d.ts`). There is no `message` or
 * `body` field on the wire for `method: "select"`. To get the question +
 * context + numbered options in front of the user, the extension therefore
 * embeds them in the `title` argument. The host's `handleAskUserRequest`
 * reads `request.title` and renders it as the prompt body.
 *
 * The host's `au:` callback format is `au:<requestId>:<index>` — a single
 * digit 0-5 — so option labels can be any length without exceeding
 * Telegram's 64-byte `callback_data` cap.
 */

import { Type } from 'typebox';

type ExtensionAPI = any;

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;
const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 min — long enough for a busy user, short enough to keep the run moving on timeout.

const AskUserParams = Type.Object({
  question: Type.String({
    description:
      'The question to put to the user. Keep it short (one sentence). The user is reading this on Telegram.',
    minLength: 1,
    maxLength: 500,
  }),
  options: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    description:
      '2 to 6 short option labels. Each becomes one inline-keyboard button. Order matters: the first option is the default/recommended choice when the request times out.',
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
  }),
  context: Type.Optional(
    Type.String({
      description:
        'Optional one-paragraph rationale the user sees above the buttons. Keep under 600 chars.',
      maxLength: 600,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({
      description:
        'How long to wait for a button press before timing out. Defaults to 5 minutes. Max 30 minutes.',
      minimum: 1_000,
      maximum: 30 * 60_000,
    }),
  ),
});

type AskUserArgs = {
  question: string;
  options: string[];
  context?: string;
  timeout_ms?: number;
};

function formatOptionsLine(options: string[]): string {
  return options.map((o, i) => `${i + 1}. ${o}`).join('\n');
}

function formatPromptBody(params: {
  question: string;
  options: string[];
  context?: string;
}): string {
  const head = `❓ ${params.question}`;
  if (!params.context) {
    return `${head}\n\n${formatOptionsLine(params.options)}`;
  }
  return `${head}\n\n${params.context}\n\n${formatOptionsLine(params.options)}`;
}

export default function fftAskUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'ask_user',
    label: 'Ask User',
    description:
      'Ask the user a multiple-choice question mid-run and pause until they pick an option. Use this when you cannot make progress without disambiguating intent, picking a value from a small set, or confirming a path. Pass 2-6 short options. The first option is treated as the default on timeout. The call resolves with the chosen option label (string), or "__timeout__" if the user did not respond in time.',
    promptSnippet:
      'Ask the user a 2-6 option multiple-choice question. Returns the chosen option label, or "__timeout__" if the user did not respond before the timeout.',
    promptGuidelines: [
      'Use ask_user only when you genuinely need a choice from the user to continue. Do not use it for progress updates — that is what streaming output is for.',
      'Keep the question short and the options mutually exclusive. Each option label should fit on one Telegram button row.',
      'Put the recommended option first; the host uses the first option as the timeout default.',
      'Do not use ask_user for permission/confirmation of destructive actions — the permission gate handles that and blocks regardless of timeout.',
    ],
    parameters: AskUserParams,

    async execute(
      _toolCallId: string,
      params: AskUserArgs,
      _signal: AbortSignal,
      _onUpdate: (data: unknown) => void,
      ctx: { ui: { select: (...args: unknown[]) => Promise<unknown> } },
    ) {
      if (
        !Array.isArray(params.options) ||
        params.options.length < MIN_OPTIONS
      ) {
        return {
          content: [
            {
              type: 'text',
              text: `ask_user requires at least ${MIN_OPTIONS} options.`,
            },
          ],
          details: {},
        };
      }
      if (params.options.length > MAX_OPTIONS) {
        return {
          content: [
            {
              type: 'text',
              text: `ask_user supports at most ${MAX_OPTIONS} options.`,
            },
          ],
          details: {},
        };
      }

      const timeoutMs = params.timeout_ms ?? DEFAULT_TIMEOUT_MS;
      // pi's `ctx.ui.select(title, options, opts)` only forwards title,
      // options, and timeout through the RPC frame. We pass the formatted
      // question + context + numbered options in the `title` slot so the
      // host can render them verbatim. The host sees this as
      // `request.title` (see ExtensionUIRequest in src/pi-runner.ts).
      const title = formatPromptBody({
        question: params.question,
        options: params.options,
        context: params.context,
      });

      let chosen: string | undefined;
      try {
        chosen = (await ctx.ui.select(title, params.options, {
          timeout: timeoutMs,
        })) as string | undefined;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text',
              text: `ask_user failed before reaching the user: ${reason}`,
            },
          ],
          details: { error: reason },
        };
      }

      if (chosen) {
        return {
          content: [
            {
              type: 'text',
              text: `User chose: ${chosen}`,
            },
          ],
          details: { chosen },
        };
      }

      // On cancel or timeout, surface a stable marker the model can
      // branch on ("__timeout__") rather than free-form text so the
      // model's response stays deterministic across runs.
      return {
        content: [
          {
            type: 'text',
            text:
              'User did not respond in time. The first option ("' +
              params.options[0] +
              '") is being used as the default. If you need a different choice, ask again.',
          },
        ],
        details: {
          chosen: '__timeout__',
          defaultOption: params.options[0],
        },
      };
    },
  });
}
