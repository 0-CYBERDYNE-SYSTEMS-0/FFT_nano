export type OnboardingRuntime = 'docker' | 'host';

export interface OnboardingBootstrap {
  device: { hostname: string; platform: string; runtime: OnboardingRuntime };
  web: {
    accessMode: 'localhost' | 'lan' | 'remote';
    authRequired: boolean;
    phoneHandoff: 'local_only' | 'protected_network';
  };
  channels: {
    telegram: { configured: boolean; claimReady: boolean; nextStep: string };
    whatsapp: { enabled: boolean; linked: boolean; nextStep: string };
  };
  networkDiscovery: {
    intrusiveScanRun: false;
    cachedHomeAssistantInventory: boolean;
  };
  homeAssistant: {
    credentialsConfigured: boolean;
    validation: 'missing' | 'pending' | 'pass' | 'fail';
    cachedEntityCount: number;
    proposal: {
      state: 'needs_setup' | 'ready_for_approval';
      requiresExplicitApproval: true;
      suggestedViews: Array<{ id: string; title: string; entityCount: number }>;
    };
  };
}

export interface OnboardingBootstrapInput {
  env: Record<string, string | undefined>;
  hostname: string;
  platform: string;
  runtime: OnboardingRuntime;
  accessMode: 'localhost' | 'lan' | 'remote';
  authRequired: boolean;
  whatsappAuthStatus?: string;
  farmProfile?: unknown;
  cachedDiscovery?: unknown;
}

function hasValue(value: string | undefined): boolean {
  const normalized = value?.trim() || '';
  return normalized.length > 0 && normalized !== 'replace-me' && normalized !== '...';
}

function isEnabled(value: string | undefined, fallback = true): boolean {
  if (!value?.trim()) return fallback;
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase());
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readValidation(profile: unknown): 'missing' | 'pending' | 'pass' | 'fail' {
  const status = object(object(profile).validation).status;
  if (status === 'pass' || status === 'fail' || status === 'pending') return status;
  return 'missing';
}

function buildSuggestedViews(discovery: unknown): Array<{
  id: string;
  title: string;
  entityCount: number;
}> {
  const domains = object(object(discovery).domains);
  const labels: Record<string, string> = {
    binary_sensor: 'Alerts',
    climate: 'Climate',
    cover: 'Covers',
    light: 'Lighting',
    sensor: 'Sensors',
    switch: 'Controls',
  };
  return Object.entries(domains)
    .filter(([, count]) => Number.isInteger(count) && Number(count) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 6)
    .map(([id, count]) => ({
      id,
      title: labels[id] || id.replace(/_/g, ' '),
      entityCount: Number(count),
    }));
}

/**
 * Creates a local-only onboarding report. It deliberately performs no network
 * requests or filesystem writes; callers may supply previously collected HA
 * inventory and validation state.
 */
export function buildOnboardingBootstrap(
  input: OnboardingBootstrapInput,
): OnboardingBootstrap {
  const telegramConfigured = hasValue(input.env.TELEGRAM_BOT_TOKEN);
  const telegramClaimReady = telegramConfigured && hasValue(input.env.TELEGRAM_ADMIN_SECRET);
  const whatsappEnabled = isEnabled(input.env.WHATSAPP_ENABLED);
  const whatsappLinked = ['authenticated', 'already_authenticated'].includes(
    (input.whatsappAuthStatus || '').trim(),
  );
  const validation = readValidation(input.farmProfile);
  const cachedEntityCount = Number(object(input.cachedDiscovery).entityCount);
  const entityCount = Number.isInteger(cachedEntityCount) && cachedEntityCount > 0
    ? cachedEntityCount
    : 0;
  const suggestedViews = buildSuggestedViews(input.cachedDiscovery);
  const credentialsConfigured = hasValue(input.env.HA_TOKEN);
  const dashboardReady = credentialsConfigured && validation === 'pass' && entityCount > 0;

  return {
    device: { hostname: input.hostname, platform: input.platform, runtime: input.runtime },
    web: {
      accessMode: input.accessMode,
      authRequired: input.authRequired,
      phoneHandoff: input.accessMode === 'localhost' ? 'local_only' : 'protected_network',
    },
    channels: {
      telegram: {
        configured: telegramConfigured,
        claimReady: telegramClaimReady,
        nextStep: telegramConfigured
          ? (telegramClaimReady ? 'Claim this bot from Telegram with the one-time admin secret.' : 'Save the bot token to create the one-time claim secret.')
          : 'Add a Telegram bot token before a Telegram handoff can be offered.',
      },
      whatsapp: {
        enabled: whatsappEnabled,
        linked: whatsappLinked,
        nextStep: !whatsappEnabled
          ? 'WhatsApp is disabled.'
          : whatsappLinked
            ? 'WhatsApp is linked on this device.'
            : 'Link WhatsApp locally with npm run auth; it displays a phone-scanned QR.',
      },
    },
    networkDiscovery: {
      intrusiveScanRun: false,
      cachedHomeAssistantInventory: entityCount > 0,
    },
    homeAssistant: {
      credentialsConfigured,
      validation,
      cachedEntityCount: entityCount,
      proposal: {
        state: dashboardReady ? 'ready_for_approval' : 'needs_setup',
        requiresExplicitApproval: true,
        suggestedViews,
      },
    },
  };
}
