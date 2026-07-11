type UserVisibleErrorInput =
  | {
      readonly kind: 'empty-output';
      readonly ref?: string;
    }
  | {
      readonly kind: 'runner-error';
      readonly detail?: string;
      readonly ref?: string;
    }
  | {
      readonly kind: 'timeout';
      readonly detail?: string;
      readonly timeoutMs?: number;
      readonly ref?: string;
    };

function assertNever(value: never): never {
  throw new Error(
    `Unexpected user-visible error kind: ${JSON.stringify(value)}`,
  );
}

function withRef(text: string, ref: string | undefined): string {
  return ref ? `${text} (ref: ${ref})` : text;
}

function isRateLimited(detail: string): boolean {
  return /\b429\b|rate[ -]?limit|too many requests|overloaded/i.test(detail);
}

function isAuthenticationFailure(detail: string): boolean {
  return /\b401\b|\b403\b|invalid api key|authentication|unauthorized|forbidden/i.test(
    detail,
  );
}

function isNetworkFailure(detail: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(detail);
}

export function toUserVisibleErrorText(input: UserVisibleErrorInput): string {
  switch (input.kind) {
    case 'empty-output':
      return withRef(
        'I hit a snag putting my reply together. Please send that again.',
        input.ref,
      );
    case 'timeout':
      return withRef(
        "That took longer than I'm allowed to spend, so I stopped. Try again, or break the request into smaller steps.",
        input.ref,
      );
    case 'runner-error': {
      const detail = input.detail || '';
      if (isRateLimited(detail)) {
        return withRef(
          "I'm getting a lot of requests right now. Give me a minute and try again.",
          input.ref,
        );
      }
      if (isAuthenticationFailure(detail)) {
        return withRef(
          "There's a setup problem with my AI provider — the owner should check the API key (run /setup or see the install summary).",
          input.ref,
        );
      }
      if (isNetworkFailure(detail)) {
        return withRef(
          "I'm having trouble reaching my AI provider. Check the internet connection on the machine running me, then try again.",
          input.ref,
        );
      }
      return withRef(
        'Something went wrong on my end. Please try again — if it keeps happening, the owner can check the logs.',
        input.ref,
      );
    }
    default:
      return assertNever(input);
  }
}
