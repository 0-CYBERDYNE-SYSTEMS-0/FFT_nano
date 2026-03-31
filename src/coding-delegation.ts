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
const CODER_PLAN_PATTERN = new RegExp(
  `^/coder_plan${TELEGRAM_COMMAND_SUFFIX}\\b`,
  'i',
);
const CODER_DASH_PLAN_PATTERN = new RegExp(
  `^/coder-plan${TELEGRAM_COMMAND_SUFFIX}\\b`,
  'i',
);
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
  /\b(automate|monitor|track|schedule|alert|notify|text|report)\b/,
] as const;

const CODING_DOMAIN_PATTERNS = [
  /\b(app|api|backend|frontend|dashboard|component|route|endpoint|service)\b/,
  /\b(code|repo|typescript|javascript|node|react|sqlite|schema|migration)\b/,
  /\b(auth|database|test|tests|build failure|lint|bug|ci|deploy)\b/,
  /\b(script|automation|workflow|reminder|report|sensor|greenhouse|irrigation|harvest|moisture|temperature|telegram)\b/,
] as const;

const SUBSTANTIAL_SCOPE_PATTERNS = [
  /\b(full|whole|entire|from scratch|production|end[- ]to[- ]end|multi[- ]file)\b/,
  /\bwith auth\b/,
  /\bwith tests?\b/,
  /\bplan and implement\b/,
  /\bruns? every\b/,
  /\bwhen .* drops below\b/,
  /\bwhen .* goes dry\b/,
] as const;

// Patterns that indicate the user is NOT asking for coding help
// These override auto-detection to prevent false positives
const EXCLUDED_PATTERNS = [
  /don't need to|doesn't need to|no need to|not asking you to/i,
  /just (talk|chat|discuss|think|respond|answer|tell me|share)/i,
  /self[- ]?(reflect|improvement|assessment|analysis|evaluation)/i,
  /about yourself|about you|you as a|who you are|who are you/i,
  /your (directives?|operating|skills?|abilities|capabilities|strengths?|superpower)/i,
] as const;

export function isSubstantialCodingTask(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;

  // Exclude meta/introspective messages that contain coding-related words but aren't asking for coding
  for (const pattern of EXCLUDED_PATTERNS) {
    if (pattern.test(normalized)) return false;
  }

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

const LIVE_IMPACT_PATTERNS = [
  /\b(automate|control|open|close|start|stop|set|change|adjust)\b.*\b(vent|vents|fan|fans|pump|pumps|valve|valves|heater|heaters|light|lights|irrigation|watering|relay|motor)\b/,
  /\b(restart|stop|start)\b.*\b(service|gateway|daemon|bot|host)\b/,
  /\b(schedule|reschedule|change)\b.*\b(irrigation|watering|production|cron|service)\b/,
  /\b(update|change|set|edit)\b.*\b(config|configuration|\.env|secret|token|api key)\b/,
] as const;

export function isLiveImpactCodingTask(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;

  for (const pattern of LIVE_IMPACT_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  return false;
}
