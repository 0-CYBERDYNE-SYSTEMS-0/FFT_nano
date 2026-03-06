import fs from 'fs';
import path from 'path';

export type RuntimeProviderPreset =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'zai'
  | 'minimax'
  | 'kimi-coding';

export interface RuntimeProviderDefinition {
  id: RuntimeProviderPreset;
  label: string;
  piApi: string;
  defaultModel: string;
  apiKeyEnv: string;
  endpointEnv?: string;
}

export const RUNTIME_PROVIDER_DEFINITIONS: RuntimeProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    piApi: 'openai',
    defaultModel: 'gpt-4o-mini',
    apiKeyEnv: 'OPENAI_API_KEY',
    endpointEnv: 'OPENAI_BASE_URL',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    piApi: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-latest',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    piApi: 'gemini',
    defaultModel: 'gemini-2.0-flash',
    apiKeyEnv: 'GEMINI_API_KEY',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    piApi: 'openrouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    apiKeyEnv: 'OPENROUTER_API_KEY',
  },
  {
    id: 'zai',
    label: 'ZAI',
    piApi: 'zai',
    defaultModel: 'glm-4.7',
    apiKeyEnv: 'ZAI_API_KEY',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    piApi: 'minimax',
    defaultModel: 'MiniMax-M2.1',
    apiKeyEnv: 'MINIMAX_API_KEY',
  },
  {
    id: 'kimi-coding',
    label: 'Kimi Coding',
    piApi: 'kimi-coding',
    defaultModel: 'kimi-k2-thinking',
    apiKeyEnv: 'KIMI_API_KEY',
  },
];

export function getDefaultDotEnvPath(projectRoot = process.cwd()): string {
  return path.join(projectRoot, '.env');
}

export function loadDotEnvMap(envPath = getDefaultDotEnvPath()): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return out;
  const lines = fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n').split('\n');
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

export function upsertDotEnv(envPath: string, updates: Record<string, string | undefined>): void {
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

export function applyProcessEnvUpdates(updates: Record<string, string | undefined>): void {
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
  const found = RUNTIME_PROVIDER_DEFINITIONS.find((entry) => entry.id === preset);
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
    RUNTIME_PROVIDER_DEFINITIONS.find((entry) => entry.piApi === normalized) || null
  );
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
  const providerDef = getRuntimeProviderDefinitionByPiApi(provider);
  if (providerDef) {
    const endpointValue =
      providerDef.endpointEnv === 'OPENAI_BASE_URL'
        ? (source.OPENAI_BASE_URL || source.PI_BASE_URL || '').trim()
        : providerDef.endpointEnv
          ? (source[providerDef.endpointEnv] || '').trim()
          : '';
    return {
      providerPreset: providerDef.id,
      provider: provider || providerDef.piApi,
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
