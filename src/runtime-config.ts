import fs from 'fs';
import path from 'path';

export type RuntimeProviderPreset =
  | 'openai'
  | 'lm-studio'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'opencode-go'
  | 'opencode-zen'
  | 'zai'
  | 'minimax'
  | 'minimax-cn'
  | 'kimi-coding'
  | 'ollama'
  | 'stepfun';

export const RUNTIME_PROVIDER_PRESET_ENV = 'FFT_NANO_RUNTIME_PROVIDER_PRESET';

export type RuntimeProviderModelInputMode = 'picker' | 'typed';

export interface RuntimeProviderSetupUrls {
  signupUrl?: string;
  docsUrl?: string;
  localSetupUrl?: string;
  note?: string;
}

export interface RuntimeProviderDefinition {
  id: RuntimeProviderPreset;
  label: string;
  piApi: string;
  defaultModel: string;
  apiKeyEnv: string;
  endpointEnv?: string;
  defaultEndpointValue?: string;
  defaultApiKeyValue?: string;
  apiKeyRequired?: boolean;
  modelInputMode?: RuntimeProviderModelInputMode;
  setupUrls?: RuntimeProviderSetupUrls;
}

export const RUNTIME_PROVIDER_DEFINITIONS: RuntimeProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    piApi: 'openai',
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpointEnv: 'OPENAI_BASE_URL',
    setupUrls: {
      signupUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs',
    },
  },
  {
    id: 'lm-studio',
    label: 'LM Studio (local)',
    piApi: 'openai',
    defaultModel: 'qwen2.5-coder-7b-instruct',
    apiKeyEnv: 'PI_API_KEY',
    endpointEnv: 'OPENAI_BASE_URL',
    defaultEndpointValue: 'http://127.0.0.1:1234/v1',
    defaultApiKeyValue: 'lm-studio',
    apiKeyRequired: false,
    modelInputMode: 'typed',
    setupUrls: {
      localSetupUrl: 'https://lmstudio.ai/',
      note: 'Local OpenAI-compatible provider. Start the local server in LM Studio first.',
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    piApi: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    setupUrls: {
      signupUrl: 'https://console.anthropic.com/settings/keys',
      docsUrl: 'https://docs.anthropic.com/',
    },
  },
  {
    id: 'gemini',
    label: 'Gemini',
    piApi: 'gemini',
    defaultModel: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
    setupUrls: {
      signupUrl: 'https://aistudio.google.com/app/apikey',
      docsUrl: 'https://ai.google.dev/gemini-api/docs',
    },
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    piApi: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    setupUrls: {
      signupUrl: 'https://openrouter.ai/keys',
      docsUrl: 'https://openrouter.ai/docs',
      note: 'The `openrouter/free` model routes to a random free model per request. Some free models log your prompts for training — review before sharing sensitive data.',
    },
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    piApi: 'opencode-go',
    defaultModel: 'deepseek-v4-pro',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
    endpointEnv: 'OPENCODE_GO_BASE_URL',
    defaultEndpointValue: 'https://opencode.ai/zen/go/v1',
    setupUrls: {
      signupUrl: 'https://opencode.ai/go',
      docsUrl: 'https://opencode.ai/docs/go/',
      note: 'Subscription: $5 first month, $10/mo after. Same OpenCode account as OpenCode Zen.',
    },
  },
  {
    id: 'opencode-zen',
    label: 'OpenCode Zen',
    piApi: 'opencode-zen',
    defaultModel: 'gpt-5.4',
    apiKeyEnv: 'OPENCODE_API_KEY',
    endpointEnv: 'OPENCODE_ZEN_BASE_URL',
    defaultEndpointValue: 'https://opencode.ai/zen/v1',
    setupUrls: {
      signupUrl: 'https://opencode.ai/auth',
      docsUrl: 'https://opencode.ai/docs/zen/',
      note: 'Pay-as-you-go. Auto-reload $20 if balance < $5. Same OpenCode account works for Zen and Go.',
    },
  },
  {
    id: 'zai',
    label: 'ZAI',
    piApi: 'zai',
    defaultModel: 'glm-4.7',
    apiKeyEnv: 'ZAI_API_KEY',
    setupUrls: {
      signupUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docsUrl: 'https://docs.bigmodel.cn/',
    },
  },
  {
    id: 'minimax',
    label: 'MiniMax (global)',
    piApi: 'minimax',
    defaultModel: 'MiniMax-M3',
    apiKeyEnv: 'MINIMAX_API_KEY',
    endpointEnv: 'MINIMAX_BASE_URL',
    defaultEndpointValue: 'https://api.minimax.io/anthropic',
    setupUrls: {
      signupUrl:
        'https://platform.minimax.io/user-center/basic-information/interface-key',
      docsUrl: 'https://platform.minimax.io/docs',
      note: 'Global endpoint at https://api.minimax.io/anthropic. Same MiniMax account as MiniMax-CN.',
    },
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax (China)',
    piApi: 'minimax-cn',
    defaultModel: 'MiniMax-M3',
    apiKeyEnv: 'MINIMAX_CN_API_KEY',
    endpointEnv: 'MINIMAX_CN_BASE_URL',
    defaultEndpointValue: 'https://api.minimaxi.com/anthropic',
    setupUrls: {
      signupUrl:
        'https://platform.minimaxi.com/user-center/basic-information/interface-key',
      docsUrl: 'https://platform.minimaxi.com/document',
      note: 'Domestic China endpoint at https://api.minimaxi.com/anthropic. Get API key from the CN console.',
    },
  },
  {
    id: 'stepfun',
    label: 'StepFun Step Plan',
    piApi: 'stepfun',
    defaultModel: 'step-3.7-flash',
    apiKeyEnv: 'STEPFUN_API_KEY',
    endpointEnv: 'STEPFUN_BASE_URL',
    defaultEndpointValue: 'https://api.stepfun.ai/step_plan/v1',
    setupUrls: {
      signupUrl: 'https://platform.stepfun.ai/step-plan',
      docsUrl: 'https://platform.stepfun.ai/docs/en/step-plan/overview',
      note: 'Subscription ($6.99-$99/mo). Uses the dedicated /step_plan/v1 endpoint, NOT the standard /v1.',
    },
  },
  {
    id: 'kimi-coding',
    label: 'Kimi Coding',
    piApi: 'kimi-coding',
    defaultModel: 'kimi-for-coding',
    apiKeyEnv: 'KIMI_API_KEY',
    setupUrls: {
      signupUrl: 'https://platform.moonshot.ai/console/api-keys',
      docsUrl: 'https://platform.moonshot.ai/docs',
    },
  },
  {
    // Ollama uses OpenAI-compatible API at localhost:11434/v1 — no real API key needed.
    // Available models: qwen3.5:4b, qwen3.5:2b, qwen3.5:0.8b, sam860/lucy:1.7b,
    //   deepscaler:latest, granite3.1-dense:2b, granite3.1-moe:latest,
    //   granite3.1-moe:1b, llama3.2:1b, deepseek-r1:1.5b
    id: 'ollama',
    label: 'Ollama (local)',
    piApi: 'ollama',
    defaultModel: 'qwen3.5:4b',
    apiKeyEnv: 'PI_API_KEY',
    endpointEnv: 'OPENAI_BASE_URL',
    defaultEndpointValue: 'http://localhost:11434/v1',
    defaultApiKeyValue: 'ollama',
    apiKeyRequired: false,
    setupUrls: {
      localSetupUrl: 'https://ollama.com/download',
      note: 'Local provider. Install Ollama and pull a model; no hosted API key is required.',
    },
  },
];

export function getDefaultDotEnvPath(projectRoot = process.cwd()): string {
  return path.join(projectRoot, '.env');
}

export function loadDotEnvMap(
  envPath = getDefaultDotEnvPath(),
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  const lines = fs
    .readFileSync(envPath, 'utf-8')
    .replace(/\r\n/g, '\n')
    .split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value.replace(/^['"]|['"]$/g, '');
  }
  return out;
}

export function upsertDotEnv(
  envPath: string,
  updates: Record<string, string | undefined>,
): void {
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n').split('\n')
    : [];
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const updated = new Set<string>();
  const lines: string[] = [];
  for (const line of existing) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      lines.push(line);
      continue;
    }
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    if (!keys.includes(key)) {
      lines.push(line);
      continue;
    }
    updated.add(key);
    const value = updates[key];
    if (value !== undefined) {
      lines.push(`${key}=${value}`);
    }
  }

  for (const key of keys) {
    if (updated.has(key)) continue;
    const value = updates[key];
    if (value === undefined) continue;
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(`${envPath}`, `${lines.join('\n')}\n`, 'utf-8');
}

export function applyProcessEnvUpdates(
  updates: Record<string, string | undefined>,
): void {
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export function hasMeaningfulSecret(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim();
  if (!value) return false;
  return value !== 'replace-me' && value !== '...';
}

export function getRuntimeProviderDefinitionByPreset(
  preset: RuntimeProviderPreset,
): RuntimeProviderDefinition {
  const found = RUNTIME_PROVIDER_DEFINITIONS.find(
    (entry) => entry.id === preset,
  );
  if (!found) {
    throw new Error(`Unknown runtime provider preset: ${preset}`);
  }
  return found;
}

export function getRuntimeProviderDefinitionByPiApi(
  piApi: string | undefined,
): RuntimeProviderDefinition | null {
  const normalized = (piApi || '').trim().toLowerCase();
  if (!normalized) return null;
  return (
    RUNTIME_PROVIDER_DEFINITIONS.find((entry) => entry.piApi === normalized) ||
    null
  );
}

export function isRuntimeProviderPreset(
  value: string | undefined,
): value is RuntimeProviderPreset {
  if (!value) return false;
  return RUNTIME_PROVIDER_DEFINITIONS.some((entry) => entry.id === value);
}

function getRuntimeProviderDefinitionBySource(
  source: Record<string, string | undefined>,
): RuntimeProviderDefinition | null {
  const provider = (source.PI_API || '').trim().toLowerCase();
  const preset = (source[RUNTIME_PROVIDER_PRESET_ENV] || '')
    .trim()
    .toLowerCase();
  if (isRuntimeProviderPreset(preset)) {
    const presetDef = getRuntimeProviderDefinitionByPreset(preset);
    if (!provider || presetDef.piApi === provider) {
      return presetDef;
    }
  }
  return getRuntimeProviderDefinitionByPiApi(provider);
}

export interface RuntimeConfigSnapshot {
  providerPreset: RuntimeProviderPreset | 'manual';
  provider: string;
  model: string;
  endpointEnv?: string;
  endpointValue?: string;
  apiKeyEnv: string;
  apiKeyConfigured: boolean;
}

export function resolveRuntimeConfigSnapshot(
  source: Record<string, string | undefined>,
): RuntimeConfigSnapshot {
  const provider = (source.PI_API || '').trim();
  const model = (source.PI_MODEL || '').trim();
  const providerDef = getRuntimeProviderDefinitionBySource(source);
  if (providerDef) {
    const endpointValue =
      providerDef.endpointEnv === 'OPENAI_BASE_URL'
        ? (source.OPENAI_BASE_URL || source.PI_BASE_URL || '').trim()
        : providerDef.endpointEnv
          ? (source[providerDef.endpointEnv] || '').trim()
          : '';
    return {
      providerPreset: providerDef.id,
      provider: providerDef.id,
      model: model || providerDef.defaultModel,
      endpointEnv: providerDef.endpointEnv,
      endpointValue: endpointValue || undefined,
      apiKeyEnv: providerDef.apiKeyEnv,
      apiKeyConfigured: hasMeaningfulSecret(
        source[providerDef.apiKeyEnv] || source.PI_API_KEY,
      ),
    };
  }

  return {
    providerPreset: 'manual',
    provider: provider || '(unset)',
    model: model || '(unset)',
    endpointEnv: 'PI_BASE_URL',
    endpointValue: (source.PI_BASE_URL || '').trim() || undefined,
    apiKeyEnv: 'PI_API_KEY',
    apiKeyConfigured: hasMeaningfulSecret(source.PI_API_KEY),
  };
}

export function buildRuntimeProviderPresetUpdates(params: {
  preset: RuntimeProviderPreset;
  model?: string;
  source?: Record<string, string | undefined>;
  applyLocalDefaults?: boolean;
}): Record<string, string | undefined> {
  const { preset, model, source = {}, applyLocalDefaults = false } = params;
  const provider = getRuntimeProviderDefinitionByPreset(preset);
  const updates: Record<string, string | undefined> = {
    [RUNTIME_PROVIDER_PRESET_ENV]: preset,
    PI_API: provider.piApi,
    PI_MODEL: model || provider.defaultModel,
  };

  if (applyLocalDefaults && provider.defaultEndpointValue) {
    const endpointEnvKey = provider.endpointEnv || 'OPENAI_BASE_URL';
    updates[endpointEnvKey] = provider.defaultEndpointValue;
    if (endpointEnvKey === 'OPENAI_BASE_URL') {
      updates.PI_BASE_URL = provider.defaultEndpointValue;
    }
  }

  if (
    applyLocalDefaults &&
    provider.defaultApiKeyValue &&
    !hasMeaningfulSecret(source[provider.apiKeyEnv])
  ) {
    updates[provider.apiKeyEnv] = provider.defaultApiKeyValue;
  }

  return updates;
}
