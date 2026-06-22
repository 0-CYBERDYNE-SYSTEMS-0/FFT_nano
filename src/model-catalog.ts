import fs from 'fs';
import path from 'path';

type JsonObject = Record<string, any>;

export const OPENCODE_GO_PROVIDER = 'opencode-go';
export const OPENCODE_GO_DEFAULT_MODEL = 'deepseek-v4-pro';
export const OPENCODE_GO_COMPACTION_MODEL = 'deepseek-v4-flash';

export interface ModelCatalogEntry {
  /** Provider whose `/v1/models` probe does not surface this list. Seeded on
   *  top of live results so users see them in the picker; also used as the
   *  fallback when the probe fails. */
  curated: string[];
  /** Per-model `api` field (e.g. `openai-responses`, `anthropic-messages`).
   *  OpenCode Go/Zen serve different model families over different API
   *  surfaces, so each model needs its own `api` value. */
  perModelApi?: Record<string, string>;
  /** Full per-model metadata (cost, reasoning, contextWindow, etc.) for
   *  models the generic `managedProvider()` would clobber. The
   *  opencode-go DeepSeek entries are the canonical example. */
  enriched?: JsonObject[];
  /** Provider-level `apiKey` reference (e.g. `OPENCODE_GO_API_KEY`). Used
   *  by `ensureOpenCodeGoModels` to seed the env-var reference into a
   *  freshly written `models.json`. */
  apiKey?: string;
}

export interface ModelCatalog {
  version: number;
  updated_at: string;
  providers: Record<string, ModelCatalogEntry>;
}

let cachedCatalog: ModelCatalog | null = null;

function resolveDefaultCatalogPath(): string {
  // Catalog lives at config/model-catalog.json, relative to the repo root.
  // process.cwd() is the repo root when running via tsx/tsx dev; in the
  // packaged dist build, the file is co-located next to dist/.
  return path.resolve(process.cwd(), 'config', 'model-catalog.json');
}

export const MODEL_CATALOG_PATH = path.resolve(
  process.env.FFT_NANO_MODEL_CATALOG_PATH || resolveDefaultCatalogPath(),
);

function readCatalogFromDisk(): ModelCatalog {
  const fallback: ModelCatalog = { version: 1, updated_at: '', providers: {} };
  try {
    if (!fs.existsSync(MODEL_CATALOG_PATH)) return fallback;
    const raw = fs.readFileSync(MODEL_CATALOG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as ModelCatalog;
    if (!parsed || typeof parsed !== 'object' || !parsed.providers) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function getModelCatalog(): ModelCatalog {
  if (cachedCatalog) return cachedCatalog;
  cachedCatalog = readCatalogFromDisk();
  return cachedCatalog;
}

export function getCatalogEntry(providerId: string): ModelCatalogEntry {
  const catalog = getModelCatalog();
  const entry = catalog.providers[providerId];
  if (entry) return entry;
  return { curated: [] };
}

export function getCuratedModels(providerId: string): string[] {
  return getCatalogEntry(providerId).curated;
}

export function getPerModelApi(providerId: string): Record<string, string> {
  return getCatalogEntry(providerId).perModelApi ?? {};
}

export function getEnrichedModels(providerId: string): JsonObject[] {
  return getCatalogEntry(providerId).enriched ?? [];
}

export function getProviderApiKeyRef(providerId: string): string | undefined {
  return getCatalogEntry(providerId).apiKey;
}

/** Back-compat re-export for tests and consumers that import the
 *  opencode-go DeepSeek models by name. */
export const OPENCODE_GO_DEEPSEEK_MODELS = Object.freeze(
  getEnrichedModels(OPENCODE_GO_PROVIDER) as ReadonlyArray<JsonObject>,
);
