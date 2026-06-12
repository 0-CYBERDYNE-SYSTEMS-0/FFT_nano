import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

type JsonObject = Record<string, any>;

const LOCAL_PROVIDER_MARKER = 'fft-nano-local-discovery';

export interface EnsureLocalProviderModelsResult {
  ok: boolean;
  path: string;
  changed: boolean;
  discovered: Record<string, string[]>;
  errors: string[];
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fetchJsonSync(url: string): unknown {
  const result = spawnSync('curl', ['-sf', '--max-time', '0.8', url], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = result.stderr.trim() || `curl exited ${result.status}`;
    throw new Error(message);
  }
  return JSON.parse(result.stdout);
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '');
}

function normalizeOpenAiBaseUrl(value: string): string {
  const trimmed = trimTrailingSlashes(value.trim());
  if (!trimmed) return '';
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function normalizeOllamaBaseUrl(value: string): string {
  const trimmed = trimTrailingSlashes(value.trim());
  if (!trimmed) return '';
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort(
    (a, b) => a.localeCompare(b),
  );
}

function isLikelyChatModelId(id: string): boolean {
  const normalized = id.toLowerCase();
  return ![
    'embed',
    'embedding',
    'ocr',
    'rerank',
    'bge-reranker',
    'nomic-embed',
  ].some((token) => normalized.includes(token));
}

export interface DiscoverOpenAiCompatibleModelsResult {
  ok: boolean;
  provider: string;
  models: string[];
  error?: string;
}

export function discoverOpenAiCompatibleModels(params: {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}): DiscoverOpenAiCompatibleModelsResult {
  const { providerId, baseUrl, apiKey } = params;
  try {
    const normalizedUrl = normalizeOpenAiBaseUrl(baseUrl);
    if (!normalizedUrl) {
      return { ok: false, provider: providerId, models: [], error: 'empty baseUrl' };
    }
    const result = spawnSync(
      'curl',
      [
        '-sS',
        '--max-time',
        '3',
        '-H',
        `Authorization: Bearer ${apiKey}`,
        '-w',
        '\n%{http_code}',
        `${normalizedUrl}/models`,
      ],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0) {
      const message = result.stderr.trim() || `curl exited ${result.status}`;
      return { ok: false, provider: providerId, models: [], error: message };
    }
    const output = result.stdout.trimEnd();
    const newlineIndex = output.lastIndexOf('\n');
    const bodyText = newlineIndex >= 0 ? output.slice(0, newlineIndex) : output;
    const statusText = newlineIndex >= 0 ? output.slice(newlineIndex + 1) : '';
    const status = Number(statusText);
    const body = JSON.parse(bodyText);
    if (status < 200 || status >= 300) {
      const message =
        isObject(body.error) && typeof body.error.message === 'string'
          ? body.error.message
          : typeof body.message === 'string'
            ? body.message
            : `HTTP ${Number.isFinite(status) ? status : 'unknown'}`;
      return {
        ok: false,
        provider: providerId,
        models: [],
        error: `HTTP ${Number.isFinite(status) ? status : 'unknown'}: ${message}`,
      };
    }
    const models = isObject(body) && Array.isArray(body.data) ? body.data : [];
    const modelIds = uniqueSorted(
      models
        .map((model) => (isObject(model) ? String(model.id || '') : ''))
        .filter((id) => id && isLikelyChatModelId(id)),
    );
    return { ok: true, provider: providerId, models: modelIds };
  } catch (err) {
    return {
      ok: false,
      provider: providerId,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function discoverRemoteProviderModels(params: {
  env: NodeJS.ProcessEnv;
  providerId: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  defaultBaseUrl?: string;
}): DiscoverOpenAiCompatibleModelsResult {
  const { env, providerId, baseUrlEnv, apiKeyEnv, defaultBaseUrl } = params;
  const baseUrl = env[baseUrlEnv] || defaultBaseUrl || '';
  const apiKey = env[apiKeyEnv] || env.PI_API_KEY || '';
  if (!baseUrl || !apiKey) {
    return { ok: false, provider: providerId, models: [], error: 'missing baseUrl or apiKey' };
  }
  return discoverOpenAiCompatibleModels({ providerId, baseUrl, apiKey });
}

function discoverOllamaModels(env: NodeJS.ProcessEnv): {
  baseUrl: string;
  models: string[];
} {
  const baseUrl = normalizeOllamaBaseUrl(
    env.OLLAMA_BASE_URL || 'http://localhost:11434',
  );
  const body = fetchJsonSync(`${baseUrl}/api/tags`);
  const models =
    isObject(body) && Array.isArray(body.models) ? body.models : [];
  return {
    baseUrl: `${baseUrl}/v1`,
    models: uniqueSorted(
      models
        .map((model) =>
          isObject(model) ? String(model.name || model.model || '') : '',
        )
        .filter((id) => id && isLikelyChatModelId(id)),
    ),
  };
}

function discoverLmStudioModels(env: NodeJS.ProcessEnv): {
  baseUrl: string;
  models: string[];
} {
  const baseUrl = normalizeOpenAiBaseUrl(
    env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
  );
  const body = fetchJsonSync(`${baseUrl}/models`);
  const models = isObject(body) && Array.isArray(body.data) ? body.data : [];
  return {
    baseUrl,
    models: uniqueSorted(
      models
        .map((model) => (isObject(model) ? String(model.id || '') : ''))
        .filter((id) => id && isLikelyChatModelId(id)),
    ),
  };
}

function managedProvider(params: {
  baseUrl: string;
  apiKey: string;
  models: string[];
  supportsReasoningEffort?: boolean;
}): JsonObject {
  return {
    xFftNanoManaged: LOCAL_PROVIDER_MARKER,
    baseUrl: params.baseUrl,
    api: 'openai-completions',
    apiKey: params.apiKey,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: params.supportsReasoningEffort ?? false,
    },
    models: params.models.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 16_384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  };
}

function isManagedLocalProvider(provider: unknown): boolean {
  return (
    isObject(provider) && provider.xFftNanoManaged === LOCAL_PROVIDER_MARKER
  );
}

function upsertProvider(
  providers: JsonObject,
  providerId: string,
  nextProvider: JsonObject,
): void {
  const existing = providers[providerId];
  if (!isObject(existing) || isManagedLocalProvider(existing)) {
    providers[providerId] = nextProvider;
    return;
  }

  const existingModels = Array.isArray(existing.models) ? existing.models : [];
  const byId = new Map<string, number>();
  for (let i = 0; i < existingModels.length; i += 1) {
    const id = isObject(existingModels[i]) ? existingModels[i].id : undefined;
    if (typeof id === 'string') byId.set(id, i);
  }

  for (const model of nextProvider.models as JsonObject[]) {
    const existingIndex = byId.get(model.id);
    if (existingIndex === undefined) existingModels.push(model);
    else
      existingModels[existingIndex] = {
        ...existingModels[existingIndex],
        ...model,
      };
  }
  existing.models = existingModels;
}

export function ensureLocalProviderModels(
  piAgentDir: string,
  env: NodeJS.ProcessEnv = process.env,
): EnsureLocalProviderModelsResult {
  const modelsPath = path.join(piAgentDir, 'models.json');
  const discovered: Record<string, string[]> = {};
  const errors: string[] = [];

  try {
    fs.mkdirSync(piAgentDir, { recursive: true });

    let config: JsonObject = { providers: {} };
    if (fs.existsSync(modelsPath)) {
      const raw = fs.readFileSync(modelsPath, 'utf-8');
      config = raw.trim() ? JSON.parse(raw) : config;
      if (!isObject(config)) {
        return {
          ok: false,
          path: modelsPath,
          changed: false,
          discovered,
          errors: ['models.json root must be an object'],
        };
      }
    }
    if (!isObject(config.providers)) config.providers = {};
    const providers = config.providers as JsonObject;

    const legacyKimiProvider = providers['kimi-coding'];
    if (
      isManagedLocalProvider(legacyKimiProvider) &&
      typeof legacyKimiProvider.baseUrl === 'string' &&
      legacyKimiProvider.baseUrl.includes('api.moonshot.')
    ) {
      delete providers['kimi-coding'];
    }

    try {
      const ollama = discoverOllamaModels(env);
      if (ollama.models.length > 0) {
        discovered.ollama = ollama.models;
        upsertProvider(
          providers,
          'ollama',
          managedProvider({
            baseUrl: ollama.baseUrl,
            apiKey: 'ollama',
            models: ollama.models,
          }),
        );
      }
    } catch (err) {
      errors.push(
        `ollama: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isManagedLocalProvider(providers.ollama)) delete providers.ollama;
    }

    try {
      const lmStudio = discoverLmStudioModels(env);
      if (lmStudio.models.length > 0) {
        discovered['lm-studio'] = lmStudio.models;
        upsertProvider(
          providers,
          'lm-studio',
          managedProvider({
            baseUrl: lmStudio.baseUrl,
            apiKey: 'lm-studio',
            models: lmStudio.models,
          }),
        );
      }
    } catch (err) {
      errors.push(
        `lm-studio: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isManagedLocalProvider(providers['lm-studio'])) {
        delete providers['lm-studio'];
      }
    }

    // Discover remote OpenAI-compatible providers
    const remoteProviders = [
      { providerId: 'openai', baseUrlEnv: 'OPENAI_BASE_URL', apiKeyEnv: 'OPENAI_API_KEY' },
      { providerId: 'moonshotai', baseUrlEnv: 'MOONSHOT_BASE_URL', apiKeyEnv: 'MOONSHOT_API_KEY', defaultBaseUrl: 'https://api.moonshot.ai/v1' },
      { providerId: 'minimax', baseUrlEnv: 'MINIMAX_BASE_URL', apiKeyEnv: 'MINIMAX_API_KEY', defaultBaseUrl: 'https://api.minimax.io/v1' },
      { providerId: 'openrouter', baseUrlEnv: 'OPENROUTER_BASE_URL', apiKeyEnv: 'OPENROUTER_API_KEY', defaultBaseUrl: 'https://openrouter.ai/api/v1' },
    ];

    for (const rp of remoteProviders) {
      try {
        const result = discoverRemoteProviderModels({
          env,
          providerId: rp.providerId,
          baseUrlEnv: rp.baseUrlEnv,
          apiKeyEnv: rp.apiKeyEnv,
          defaultBaseUrl: rp.defaultBaseUrl,
        });
        if (result.ok && result.models.length > 0) {
          discovered[rp.providerId] = result.models;
          const baseUrl = env[rp.baseUrlEnv] || rp.defaultBaseUrl || '';
          const apiKeyRef = env[rp.apiKeyEnv]
            ? `$${rp.apiKeyEnv}`
            : '$PI_API_KEY';
          upsertProvider(
            providers,
            rp.providerId,
            managedProvider({
              baseUrl,
              apiKey: apiKeyRef,
              models: result.models,
            }),
          );
        } else if (!result.ok && result.error) {
          errors.push(`${rp.providerId}: ${result.error}`);
        }
      } catch (err) {
        errors.push(
          `${rp.providerId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const nextBody = stableJson(config);
    const prevBody = fs.existsSync(modelsPath)
      ? fs.readFileSync(modelsPath, 'utf-8')
      : '';
    if (prevBody !== nextBody) {
      fs.writeFileSync(modelsPath, nextBody, 'utf-8');
      return { ok: true, path: modelsPath, changed: true, discovered, errors };
    }

    return { ok: true, path: modelsPath, changed: false, discovered, errors };
  } catch (err) {
    return {
      ok: false,
      path: modelsPath,
      changed: false,
      discovered,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
