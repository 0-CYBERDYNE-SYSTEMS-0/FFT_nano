import { RUNTIME_PROVIDER_DEFINITIONS } from './runtime-config.js';

const ALLOWED_PI_API_KEY_PROVIDERS = new Set(
  RUNTIME_PROVIDER_DEFINITIONS.map((definition) => definition.piApi),
);

interface ProviderAuthOverrideInput {
  provider?: string;
}

export function getPiApiKeyOverride(
  input: ProviderAuthOverrideInput,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const apiKey = env.PI_API_KEY?.trim();
  const opencodeApiKey = env.OPENCODE_API_KEY?.trim();
  const opencodeGoApiKey = env.OPENCODE_GO_API_KEY?.trim();

  const rawProvider = (input.provider || env.PI_API || '').trim().toLowerCase();
  const provider = ALLOWED_PI_API_KEY_PROVIDERS.has(rawProvider)
    ? rawProvider
    : '';
  const preset = (env.FFT_NANO_RUNTIME_PROVIDER_PRESET || '')
    .trim()
    .toLowerCase();

  if (!provider) {
    return !preset || preset === 'manual' ? apiKey : undefined;
  }

  if (provider === 'ollama') return apiKey;
  if (provider === 'opencode-go') {
    return opencodeGoApiKey || opencodeApiKey || apiKey;
  }
  if (provider === 'opencode-zen') {
    return opencodeApiKey || apiKey;
  }
  if (provider === 'openai') {
    return preset === 'lm-studio' || !preset || preset === 'manual'
      ? apiKey
      : undefined;
  }

  return !preset || preset === 'manual' ? apiKey : undefined;
}
