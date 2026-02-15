import fs from 'fs';
import path from 'path';

type Sources = 'memory' | 'sessions' | 'all';

interface ParsedArgs {
  mode: 'search' | 'get';
  query?: string;
  topK?: number;
  sources?: Sources;
  groupFolder?: string;
  filePath?: string;
}

const ACTIONS_DIR = '/workspace/ipc/actions';
const RESULTS_DIR = '/workspace/ipc/action_results';

function parseArgs(argv: string[]): ParsedArgs {
  const [modeRaw, ...rest] = argv;
  if (modeRaw !== 'search' && modeRaw !== 'get') {
    throw new Error('Usage: memory-tool <search|get> [flags]');
  }

  const parsed: ParsedArgs = { mode: modeRaw };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    const next = rest[i + 1];
    switch (token) {
      case '--query':
        parsed.query = next;
        i += 1;
        break;
      case '--top-k':
        parsed.topK = Number.parseInt(next || '', 10);
        i += 1;
        break;
      case '--sources':
        if (next !== 'memory' && next !== 'sessions' && next !== 'all') {
          throw new Error('Invalid --sources value. Use memory|sessions|all');
        }
        parsed.sources = next;
        i += 1;
        break;
      case '--group':
        parsed.groupFolder = next;
        i += 1;
        break;
      case '--path':
        parsed.filePath = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (parsed.mode === 'search' && !parsed.query?.trim()) {
    throw new Error('search mode requires --query');
  }
  if (parsed.mode === 'get' && !parsed.filePath?.trim()) {
    parsed.filePath = 'MEMORY.md';
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(ACTIONS_DIR, { recursive: true });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const requestId = `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload =
    args.mode === 'search'
      ? {
          type: 'memory_action',
          action: 'memory_search',
          requestId,
          params: {
            query: args.query,
            topK: Number.isFinite(args.topK) ? args.topK : undefined,
            sources: args.sources || 'all',
            groupFolder: args.groupFolder,
          },
        }
      : {
          type: 'memory_action',
          action: 'memory_get',
          requestId,
          params: {
            path: args.filePath || 'MEMORY.md',
            groupFolder: args.groupFolder,
          },
        };

  const tmpPath = path.join(ACTIONS_DIR, `.tmp_${requestId}.json`);
  const actionPath = path.join(ACTIONS_DIR, `${requestId}.json`);
  fs.writeFileSync(tmpPath, JSON.stringify(payload));
  fs.renameSync(tmpPath, actionPath);

  const resultPath = path.join(RESULTS_DIR, `${requestId}.json`);
  const timeoutMs = 20000;
  const start = Date.now();
  while (!fs.existsSync(resultPath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for memory action result (${requestId})`);
    }
    await sleep(200);
  }

  const raw = fs.readFileSync(resultPath, 'utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } finally {
    fs.unlinkSync(resultPath);
  }

  if (parsed?.status !== 'success') {
    throw new Error(parsed?.error || 'memory action failed');
  }
  console.log(JSON.stringify(parsed?.result || {}, null, 2));
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exit(1);
});
