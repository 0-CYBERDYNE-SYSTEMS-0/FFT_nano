export const MAIN_ONBOARDING_COMPLETION_TOKEN = 'ONBOARDING_COMPLETE';

export function extractOnboardingCompletion(text: string | null): {
  completed: boolean;
  text: string | null;
} {
  if (!text) return { completed: false, text };
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let lastNonEmpty = lines.length - 1;
  while (lastNonEmpty >= 0 && !lines[lastNonEmpty]?.trim()) {
    lastNonEmpty -= 1;
  }
  if (lastNonEmpty < 0) return { completed: false, text };
  if (lines[lastNonEmpty]?.trim() !== MAIN_ONBOARDING_COMPLETION_TOKEN) {
    return { completed: false, text };
  }

  const cleanedLines = lines.slice(0, lastNonEmpty);
  while (cleanedLines.length > 0 && !cleanedLines[cleanedLines.length - 1]?.trim()) {
    cleanedLines.pop();
  }
  const cleaned = cleanedLines.join('\n').trim();
  return { completed: true, text: cleaned || null };
}
