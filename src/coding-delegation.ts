export type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

export type DelegationTrigger =
  | 'none'
  | 'coder'
  | 'coder-plan'
  | 'coder_plan'
  | 'alias';

interface DelegationParseResult {
  hint: CodingHint;
  trigger: DelegationTrigger;
  instruction: string | null;
}

const EXACT_ALIAS_PHRASES = new Set([
  'use coding agent',
  'use your coding agent skill',
]);

export function normalizeDelegationAlias(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/g, '')
    .trim();
}

export function parseDelegationTrigger(text: string): DelegationParseResult {
  const trimmed = text.trimStart();

  if (/^\/coder_plan\b/i.test(trimmed)) {
    return {
      hint: 'force_delegate_plan',
      trigger: 'coder_plan',
      instruction: trimmed.replace(/^\/coder_plan\b/i, '').trim() || null,
    };
  }

  if (/^\/coder-plan\b/i.test(trimmed)) {
    return {
      hint: 'force_delegate_plan',
      trigger: 'coder-plan',
      instruction: trimmed.replace(/^\/coder-plan\b/i, '').trim() || null,
    };
  }

  if (/^\/coder\b/i.test(trimmed)) {
    return {
      hint: 'force_delegate_execute',
      trigger: 'coder',
      instruction: trimmed.replace(/^\/coder\b/i, '').trim() || null,
    };
  }

  const normalized = normalizeDelegationAlias(trimmed);
  if (EXACT_ALIAS_PHRASES.has(normalized)) {
    return {
      hint: 'force_delegate_execute',
      trigger: 'alias',
      instruction: null,
    };
  }

  return { hint: 'none', trigger: 'none', instruction: null };
}
