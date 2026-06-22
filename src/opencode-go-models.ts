import fs from 'fs';
import path from 'path';

import {
  OPENCODE_GO_PROVIDER,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_GO_COMPACTION_MODEL,
  OPENCODE_GO_DEEPSEEK_MODELS,
  getCuratedModels,
  getPerModelApi,
  getProviderApiKeyRef,
} from './model-catalog.js';

type JsonObject = Record<string, any>;

// Back-compat re-exports for tests and external consumers. The actual data
// lives in `config/model-catalog.json` under `providers["opencode-go"].enriched`.
export {
  OPENCODE_GO_PROVIDER,
  OPENCODE_GO_DEFAULT_MODEL,
  OPENCODE_GO_COMPACTION_MODEL,
  OPENCODE_GO_DEEPSEEK_MODELS,
};

export interface EnsureOpenCodeGoModelsResult {
  ok: boolean;
  path: string;
  changed: boolean;
  error?: string;
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function ensureOpenCodeGoModels(
  piAgentDir: string,
): EnsureOpenCodeGoModelsResult {
  const modelsPath = path.join(piAgentDir, 'models.json');
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
          error: 'models.json root must be an object',
        };
      }
    }

    if (!isObject(config.providers)) config.providers = {};
    const providers = config.providers as JsonObject;
    if (!isObject(providers[OPENCODE_GO_PROVIDER])) {
      providers[OPENCODE_GO_PROVIDER] = {};
    }
    const provider = providers[OPENCODE_GO_PROVIDER] as JsonObject;
    // apiKey is sourced from the catalog; legacy `OPENCODE_API_KEY` references
    // are self-healed to the dedicated opencode-go env var on the next seed.
    const defaultApiKeyRef =
      getProviderApiKeyRef(OPENCODE_GO_PROVIDER) || 'OPENCODE_GO_API_KEY';
    if (!provider.apiKey || provider.apiKey === 'OPENCODE_API_KEY') {
      provider.apiKey = defaultApiKeyRef;
    }

    const models = Array.isArray(provider.models) ? [...provider.models] : [];
    const byId = new Map<string, number>();
    for (let i = 0; i < models.length; i += 1) {
      const id = isObject(models[i]) ? models[i].id : undefined;
      if (typeof id === 'string') byId.set(id, i);
    }

    for (const model of OPENCODE_GO_DEEPSEEK_MODELS) {
      const existingIndex = byId.get(model.id);
      const next = { ...model };
      if (existingIndex === undefined) {
        models.push(next);
      } else {
        models[existingIndex] = {
          ...(isObject(models[existingIndex]) ? models[existingIndex] : {}),
          ...next,
        };
      }
    }

    const seededModelIds = new Set(
      models.flatMap((model) => {
        const id = isObject(model) ? model.id : undefined;
        return typeof id === 'string' ? [id] : [];
      }),
    );
    const perModelApi = getPerModelApi(OPENCODE_GO_PROVIDER);

    // Seed all other curated models so they appear in the Telegram model panel.
    for (const modelId of getCuratedModels(OPENCODE_GO_PROVIDER)) {
      if (seededModelIds.has(modelId)) continue;
      const api = perModelApi[modelId] || 'openai-completions';
      models.push({
        id: modelId,
        name: modelId,
        api,
        reasoning: false,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 16_384,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      });
    }
    provider.models = models;

    const nextBody = stableJson(config);
    const prevBody = fs.existsSync(modelsPath)
      ? fs.readFileSync(modelsPath, 'utf-8')
      : '';
    if (prevBody !== nextBody) {
      fs.writeFileSync(modelsPath, nextBody, 'utf-8');
      return { ok: true, path: modelsPath, changed: true };
    }
    return { ok: true, path: modelsPath, changed: false };
  } catch (err) {
    return {
      ok: false,
      path: modelsPath,
      changed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
