import fs from 'fs';
import path from 'path';

export const OPENCODE_GO_PROVIDER = 'opencode-go';
export const OPENCODE_GO_DEFAULT_MODEL = 'deepseek-v4-pro';
export const OPENCODE_GO_COMPACTION_MODEL = 'deepseek-v4-flash';

type JsonObject = Record<string, any>;

export const OPENCODE_GO_DEEPSEEK_MODELS = [
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    api: 'openai-completions',
    reasoning: true,
    input: ['text'],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 1.74, output: 3.48, cacheRead: 0.01, cacheWrite: 0 },
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    api: 'openai-completions',
    reasoning: true,
    input: ['text'],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0.14, output: 0.28, cacheRead: 0.01, cacheWrite: 0 },
  },
] as const;

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
    if (!provider.apiKey) provider.apiKey = 'OPENCODE_API_KEY';

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

