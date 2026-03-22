export type CodingHint =
  | 'none'
  | 'auto'
  | 'force_delegate_execute'
  | 'force_delegate_plan';

export type DelegationTrigger =
  | 'none'
  | 'coder'
  | 'coding'
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

const TELEGRAM_COMMAND_SUFFIX = '(?:@[A-Za-z0-9_]+)?';
const CODER_PLAN_PATTERN = new RegExp(`^/coder_plan${TELEGRAM_COMMAND_SUFFIX}\\b`, 'i');
const CODER_DASH_PLAN_PATTERN = new RegExp(`^/coder-plan${TELEGRAM_COMMAND_SUFFIX}\\b`, 'i');
const CODER_PATTERN = new RegExp(`^/coder${TELEGRAM_COMMAND_SUFFIX}\\b`, 'i');
const CODING_PATTERN = new RegExp(`^/coding${TELEGRAM_COMMAND_SUFFIX}\\b`, 'i');

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

  if (CODER_PLAN_PATTERN.test(trimmed)) {
    return {
      hint: 'force_delegate_plan',
      trigger: 'coder_plan',
      instruction: trimmed.replace(CODER_PLAN_PATTERN, '').trim() || null,
    };
  }

  if (CODER_DASH_PLAN_PATTERN.test(trimmed)) {
    return {
      hint: 'force_delegate_plan',
      trigger: 'coder-plan',
      instruction: trimmed.replace(CODER_DASH_PLAN_PATTERN, '').trim() || null,
    };
  }

  if (CODER_PATTERN.test(trimmed)) {
    return {
      hint: 'force_delegate_execute',
      trigger: 'coder',
      instruction: trimmed.replace(CODER_PATTERN, '').trim() || null,
    };
  }

  if (CODING_PATTERN.test(trimmed)) {
    return {
      hint: 'force_delegate_execute',
      trigger: 'coding',
      instruction: trimmed.replace(CODING_PATTERN, '').trim() || null,
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

const CODING_ACTION_PATTERNS = [
  /\b(build|create|make|implement|ship|write|add|generate|scaffold)\b/,
  /\b(fix|debug|patch|repair|refactor|rewrite|migrate|upgrade)\b/,
] as const;

const CODING_DOMAIN_PATTERNS = [
  /\b(app|api|backend|frontend|dashboard|component|route|endpoint|service)\b/,
  /\b(code|repo|typescript|javascript|node|react|sqlite|schema|migration)\b/,
  /\b(auth|database|test|tests|build failure|lint|bug|ci|deploy)\b/,
] as const;

const SUBSTANTIAL_SCOPE_PATTERNS = [
  /\b(full|whole|entire|from scratch|production|end[- ]to[- ]end|multi[- ]file)\b/,
  /\bwith auth\b/,
  /\bwith tests?\b/,
  /\bplan and implement\b/,
] as const;

export function isSubstantialCodingTask(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;

  const actionScore = CODING_ACTION_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
    0,
  );
  const domainScore = CODING_DOMAIN_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
    0,
  );
  const scopeScore = SUBSTANTIAL_SCOPE_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(normalized) ? 1 : 0),
    0,
  );

  if (actionScore === 0 || domainScore === 0) return false;
  if (scopeScore > 0) return true;
  if (normalized.length >= 100 && actionScore + domainScore >= 2) return true;
  return actionScore + domainScore >= 3;
}
