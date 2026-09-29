export interface OnboardingResumeStatus {
  apiKeyConfigured: boolean;
  telegramBotConfigured: boolean;
  configComplete: boolean;
}

export function isOnboardingHandoff(search: string): boolean {
  return new URLSearchParams(search).get('onboarding') === '1';
}

export function getOnboardingResumeStage(
  status: OnboardingResumeStatus,
): string {
  if (status.configComplete) return 'Ready';
  if (!status.apiKeyConfigured) return 'Provider setup';
  if (!status.telegramBotConfigured) return 'Channel setup';
  return 'Final review';
}
