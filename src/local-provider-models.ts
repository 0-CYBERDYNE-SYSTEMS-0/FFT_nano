import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { getCuratedModels, getPerModelApi } from './model-catalog.js';

type JsonObject = Record<string, any>;

const LOCAL_PROVIDER_MARKER = 'fft-nano-local-discovery';

// Curated model lists + per-model API maps live in `config/model-catalog.json`
// and are loaded at startup via `./model-catalog.js`. Update the JSON to
// surface a new model — no code change required. OpenCode Go/Zen serve
// different model families over different API surfaces, so each model needs
// its own `api` field. See https://opencode.ai/docs/go and /docs/zen for the
// full endpoint matrix.

const CURATED_OLLAMA = [
  'qwen3.5:4b',
  'qwen3.5:2b',
  'qwen3.5:0.8b',
  'llama3.2:1b',
  'llama3.2:3b',
  'deepseek-r1:1.5b',
  'deepseek-r1:8b',
  'granite3.1-dense:2b',
  'granite3.1-moe:latest',
  'granite3.1-moe:1b',
  'deepscaler:latest',
  'sam860/lucy:1.7b',
];

const CURATED_LM_STUDIO = [
  'qwen2.5-coder-7b-instruct',
  'qwen2.5-coder-14b-instruct',
  'qwen2.5-7b-instruct',
  'llama-3.1-8b-instruct',
  'mistral-nemo',
];

interface RemoteProviderConfig {
  providerId: string;
  baseUrlEnv: string;
  apiKeyEnv: string;
  defaultBaseUrl?: string;
  defaultApi?: string;
  perModelApi?: Record<string, string>;
  curated?: string[];
}

export interface EnsureLocalProviderModelsResult {
  ok: boolean;
  path: string;
  changed: boolean;
  discovered: Record<string, string[]>;
  errors: string[];
  unconfiguredProviders: string[];
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
  /** True when discovery was skipped because env was missing baseUrl or apiKey.
   *  Curated fallbacks should NOT fire in this case — the user has not opted in. */
  unconfigured?: boolean;
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
      return {
        ok: false,
        provider: providerId,
        models: [],
        error: 'empty baseUrl',
      };
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
    return {
      ok: false,
      provider: providerId,
      models: [],
      error: 'missing baseUrl or apiKey',
      unconfigured: true,
    };
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
  defaultApi?: string;
  perModelApi?: Record<string, string>;
}): JsonObject {
  const defaultApi = params.defaultApi ?? 'openai-completions';
  const perModelApi = params.perModelApi ?? {};
  const omitProviderApi = Object.keys(perModelApi).length > 0;
  return {
    xFftNanoManaged: LOCAL_PROVIDER_MARKER,
    baseUrl: params.baseUrl,
    ...(omitProviderApi ? {} : { api: defaultApi }),
    apiKey: params.apiKey,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: params.supportsReasoningEffort ?? false,
    },
    models: params.models.map((id) => {
      const entry: JsonObject = {
        id,
        name: id,
        reasoning: false,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      const perModel = perModelApi[id] ?? perModelApi[id.toLowerCase()];
      if (perModel) {
        entry.api = perModel;
      } else if (omitProviderApi || defaultApi !== 'openai-completions') {
        entry.api = defaultApi;
      }
      return entry;
    }),
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
  const unconfiguredProviders: string[] = [];

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
          unconfiguredProviders: [],
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
      // Migrate the legacy Moonshot-AI-based kimi-coding entry to the
      // canonical api.kimi.com/coding baseUrl + anthropic-messages api,
      // while preserving its models. The kimi-coding remoteProviders
      // entry below will merge its curated list on top.
      legacyKimiProvider.baseUrl = 'https://api.kimi.com/coding';
      legacyKimiProvider.api = 'anthropic-messages';
      if (!('compat' in legacyKimiProvider)) {
        legacyKimiProvider.compat = {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        };
      }
    }

    const seedOllamaCurated = (): void => {
      const ollamaBase = normalizeOllamaBaseUrl(
        env.OLLAMA_BASE_URL || 'http://localhost:11434',
      );
      upsertProvider(
        providers,
        'ollama',
        managedProvider({
          baseUrl: `${ollamaBase}/v1`,
          apiKey: 'ollama',
          models: [...CURATED_OLLAMA],
        }),
      );
      unconfiguredProviders.push('ollama');
    };
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
      } else {
        // Daemon reachable but no models pulled yet — still offer the curated
        // list so the operator can pull a model via `ollama pull <model>`.
        seedOllamaCurated();
      }
    } catch {
      // Daemon not running or unreachable. Still offer Ollama as an option
      // with the curated list — a missing local daemon is not a hard error.
      seedOllamaCurated();
    }

    const seedLmStudioCurated = (): void => {
      const lmsBase = normalizeOpenAiBaseUrl(
        env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234/v1',
      );
      upsertProvider(
        providers,
        'lm-studio',
        managedProvider({
          baseUrl: lmsBase,
          apiKey: 'lm-studio',
          models: [...CURATED_LM_STUDIO],
        }),
      );
      unconfiguredProviders.push('lm-studio');
    };
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
      } else {
        // Server reachable but no model loaded — still offer the curated
        // list so the operator can load a model in the LM Studio UI.
        seedLmStudioCurated();
      }
    } catch {
      // Server not running. Still offer LM Studio as an option with the
      // curated list — a missing local server is not a hard error.
      seedLmStudioCurated();
    }

    // Discover remote OpenAI-compatible providers. opencode-go is intentionally
    // NOT here — its deepseek-specific metadata (cost, reasoning, contextWindow)
    // is managed by ensureOpenCodeGoModels and would be silently overwritten
    // by the generic merge in upsertProvider.
    const remoteProviders: Array<RemoteProviderConfig> = [
      {
        providerId: 'openai',
        baseUrlEnv: 'OPENAI_BASE_URL',
        apiKeyEnv: 'OPENAI_API_KEY',
        defaultBaseUrl: 'https://api.openai.com/v1',
        curated: getCuratedModels('openai'),
      },
      {
        providerId: 'moonshotai',
        baseUrlEnv: 'MOONSHOT_BASE_URL',
        apiKeyEnv: 'MOONSHOT_API_KEY',
        defaultBaseUrl: 'https://api.moonshot.ai/v1',
        curated: getCuratedModels('moonshotai'),
      },
      {
        providerId: 'anthropic',
        baseUrlEnv: 'ANTHROPIC_BASE_URL',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        defaultBaseUrl: 'https://api.anthropic.com',
        defaultApi: 'anthropic-messages',
        curated: getCuratedModels('anthropic'),
      },
      {
        providerId: 'gemini',
        baseUrlEnv: 'GEMINI_BASE_URL',
        apiKeyEnv: 'GEMINI_API_KEY',
        defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultApi: 'openai-completions',
        curated: getCuratedModels('gemini'),
      },
      {
        providerId: 'minimax',
        baseUrlEnv: 'MINIMAX_BASE_URL',
        apiKeyEnv: 'MINIMAX_API_KEY',
        defaultBaseUrl: 'https://api.minimax.io/anthropic',
        defaultApi: 'anthropic-messages',
        curated: getCuratedModels('minimax'),
      },
      {
        providerId: 'minimax-cn',
        baseUrlEnv: 'MINIMAX_CN_BASE_URL',
        apiKeyEnv: 'MINIMAX_CN_API_KEY',
        defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
        defaultApi: 'anthropic-messages',
        curated: getCuratedModels('minimax-cn'),
      },
      {
        providerId: 'stepfun',
        baseUrlEnv: 'STEPFUN_BASE_URL',
        apiKeyEnv: 'STEPFUN_API_KEY',
        defaultBaseUrl: 'https://api.stepfun.ai/step_plan/v1',
        defaultApi: 'openai-completions',
        curated: getCuratedModels('stepfun'),
      },
      {
        providerId: 'zai',
        baseUrlEnv: 'ZAI_BASE_URL',
        apiKeyEnv: 'ZAI_API_KEY',
        defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
        curated: getCuratedModels('zai'),
      },
      {
        providerId: 'kimi-coding',
        baseUrlEnv: 'KIMI_BASE_URL',
        apiKeyEnv: 'KIMI_API_KEY',
        defaultBaseUrl: 'https://api.kimi.com/coding',
        defaultApi: 'anthropic-messages',
        curated: getCuratedModels('kimi-coding'),
      },
      {
        providerId: 'opencode-zen',
        baseUrlEnv: 'OPENCODE_ZEN_BASE_URL',
        apiKeyEnv: 'OPENCODE_API_KEY',
        defaultBaseUrl: 'https://opencode.ai/zen/v1',
        perModelApi: getPerModelApi('opencode-zen'),
        curated: getCuratedModels('opencode-zen'),
      },
      {
        providerId: 'openrouter',
        baseUrlEnv: 'OPENROUTER_BASE_URL',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        curated: getCuratedModels('openrouter'),
      },
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
        let modelIds: string[] = [];
        if (result.ok && result.models.length > 0) {
          modelIds = result.models;
          if (rp.curated) {
            for (const curatedId of rp.curated) {
              if (!modelIds.includes(curatedId)) modelIds.push(curatedId);
            }
          }
        } else if (rp.curated) {
          // Always seed the curated list, even when no key is configured yet.
          // The provider stays available as an option in /setup and the web
          // control center; a missing key is a soft "needs configuration"
          // state, not a hard error. Live discovery failures (network, 4xx)
          // are still reported via the errors list.
          //
          // If the provider is already present on disk (managed by us),
          // merge the curated list with the existing models so we never
          // clobber operator-picked models.
          const existingOnDisk = providers[rp.providerId];
          const existingModelIds =
            isManagedLocalProvider(existingOnDisk) &&
            Array.isArray(existingOnDisk.models)
              ? (existingOnDisk.models as JsonObject[])
                  .map((m) => (isObject(m) && typeof m.id === 'string' ? m.id : ''))
                  .filter(Boolean)
              : [];
          modelIds = uniqueSorted([...rp.curated, ...existingModelIds]);
          if (result.unconfigured) {
            unconfiguredProviders.push(rp.providerId);
          } else if (!result.ok && result.error) {
            errors.push(`${rp.providerId}: ${result.error}`);
          }
        } else if (!result.ok && result.error && !result.unconfigured) {
          errors.push(`${rp.providerId}: ${result.error}`);
        }
        if (modelIds.length > 0) {
          discovered[rp.providerId] = modelIds;
          const baseUrl = env[rp.baseUrlEnv] || rp.defaultBaseUrl || '';
          // Always reference the per-provider env var so the operator can
          // fill it via /setup, the web control center, or .env. This
          // guarantees the provider appears in models.json regardless of
          // current key state.
          const apiKeyRef = `$${rp.apiKeyEnv}`;
          upsertProvider(
            providers,
            rp.providerId,
            managedProvider({
              baseUrl,
              apiKey: apiKeyRef,
              models: modelIds,
              defaultApi: rp.defaultApi,
              perModelApi: rp.perModelApi,
            }),
          );
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
      return {
        ok: true,
        path: modelsPath,
        changed: true,
        discovered,
        errors,
        unconfiguredProviders,
      };
    }

    return {
      ok: true,
      path: modelsPath,
      changed: false,
      discovered,
      errors,
      unconfiguredProviders,
    };
  } catch (err) {
    return {
      ok: false,
      path: modelsPath,
      changed: false,
      discovered,
      errors: [err instanceof Error ? err.message : String(err)],
      unconfiguredProviders: [],
    };
  }
}
