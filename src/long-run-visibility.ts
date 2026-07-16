import fs from 'fs';
import path from 'path';

export type WorkspaceFileMeta = {
  mtimeMs: number;
  size: number;
};

export type WorkspaceFileSnapshot = Map<string, WorkspaceFileMeta>;

export type WorkspaceFileChange = {
  relativePath: string;
  size: number;
  kind: 'created' | 'updated';
};

const SKIP_DIR_NAMES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.pi',
  'node_modules',
  'dist',
  'dist-web',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.DS_Store',
]);

const MAX_WALK_FILES = 4_000;
const MAX_WALK_DEPTH = 12;
const MAX_ANNOUNCE_FILES = 20;

export function summarizeLongRunTask(prompt: string, max = 72): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

export function formatLongRunStartNotice(runId: string, prompt: string): string {
  const task = summarizeLongRunTask(prompt);
  return [
    `Started long run ${runId}.`,
    `Task: ${task}`,
    `I'll post milestones and the result here (new messages, not silent edits).`,
    `Status: /run_status ${runId} · list: /runs · cancel: /cancel_run ${runId}`,
  ].join('\n');
}

export function isWeakFinalText(text: string | null | undefined): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed === 'Completed with no final text.') return true;
  if (trimmed.length < 40) return true;

  const lower = trimmed.toLowerCase();
  const looksLikePlanning =
    /^(now let me|let me |i'll |i will |i am going to|i'm going to|next[,:]?\s|starting to|about to)\b/.test(
      lower,
    ) ||
    /\b(now let me|let me build|i'll build|i will build|going to create|going for a)\b/.test(
      lower,
    );

  const hasConcretePath = /(?:^|[\s`"'(])(?:\/|~\/|\.\/)[\w./+-]+\.\w{1,8}\b/.test(
    trimmed,
  );
  const hasDeliverableCue =
    /\b(created|wrote|saved|delivered|open|preview|complete|done|here(?:'s| is))\b/i.test(
      trimmed,
    );

  if (looksLikePlanning && !hasConcretePath) return true;
  if (looksLikePlanning && trimmed.length < 600 && !hasDeliverableCue) {
    return true;
  }
  return false;
}

export function snapshotWorkspaceFiles(
  root: string,
  options?: { maxFiles?: number; maxDepth?: number },
): WorkspaceFileSnapshot {
  const out: WorkspaceFileSnapshot = new Map();
  const maxFiles = options?.maxFiles ?? MAX_WALK_FILES;
  const maxDepth = options?.maxDepth ?? MAX_WALK_DEPTH;
  const resolvedRoot = path.resolve(root);
  if (!fs.existsSync(resolvedRoot)) return out;

  const stack: Array<{ dir: string; depth: number }> = [
    { dir: resolvedRoot, depth: 0 },
  ];
  while (stack.length > 0 && out.size < maxFiles) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (out.size >= maxFiles) break;
      const name = entry.name;
      if (name === '.DS_Store') continue;
      const full = path.join(current.dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIR_NAMES.has(name)) continue;
        if (current.depth >= maxDepth) continue;
        stack.push({ dir: full, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = fs.statSync(full);
        const rel = path.relative(resolvedRoot, full);
        if (!rel || rel.startsWith('..')) continue;
        out.set(rel, { mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return out;
}

export function diffWorkspaceFiles(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot,
): WorkspaceFileChange[] {
  const changes: WorkspaceFileChange[] = [];
  for (const [relativePath, meta] of after) {
    const prior = before.get(relativePath);
    if (!prior) {
      changes.push({ relativePath, size: meta.size, kind: 'created' });
      continue;
    }
    if (meta.mtimeMs > prior.mtimeMs + 1 || meta.size !== prior.size) {
      changes.push({ relativePath, size: meta.size, kind: 'updated' });
    }
  }
  changes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return changes;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '?B';
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatFileChangeLine(change: WorkspaceFileChange): string {
  const verb = change.kind === 'created' ? 'Wrote' : 'Updated';
  return `${verb} \`${change.relativePath}\` (${formatBytes(change.size)})`;
}

export function formatFileInventory(
  changes: WorkspaceFileChange[],
  options?: { maxFiles?: number; workspaceRoot?: string },
): string {
  if (changes.length === 0) {
    return 'Workspace files: none new/updated detected under the run workspace.';
  }
  const maxFiles = options?.maxFiles ?? MAX_ANNOUNCE_FILES;
  const lines = changes.slice(0, maxFiles).map(formatFileChangeLine);
  if (changes.length > maxFiles) {
    lines.push(`…and ${changes.length - maxFiles} more file(s).`);
  }
  if (options?.workspaceRoot) {
    lines.push(`Workspace: ${options.workspaceRoot}`);
  }
  return lines.join('\n');
}

export function formatLongRunMilestone(params: {
  runId: string;
  elapsedText: string;
  phase?: string | null;
  detail?: string | null;
  note?: string;
}): string {
  const bits = [
    `Long run ${params.runId} still going`,
    `elapsed=${params.elapsedText}`,
  ];
  if (params.phase) bits.push(`phase=${params.phase}`);
  if (params.detail) bits.push(`detail=${params.detail}`);
  const head = bits.join(' · ');
  return params.note ? `${head}\n${params.note}` : head;
}

export function formatLongRunCompletionPacket(params: {
  runId: string;
  elapsedText: string;
  output: string;
  changes: WorkspaceFileChange[];
  workspaceRoot?: string;
}): string {
  const weak = isWeakFinalText(params.output);
  const inventory = formatFileInventory(params.changes, {
    workspaceRoot: params.workspaceRoot,
  });
  const header = `Run ${params.runId} complete (${params.elapsedText}).`;
  const sections = [header, '', inventory];

  if (weak) {
    sections.push(
      '',
      'Finished with a weak summary from the model; use the files above as the source of truth.',
    );
    const trimmed = params.output.trim();
    if (trimmed && trimmed !== 'Completed with no final text.') {
      sections.push('', `Model text: ${trimmed}`);
    }
  } else {
    sections.push('', params.output.trim());
  }

  return sections.join('\n');
}

export function formatTimeoutContinuationNotice(runId: string): string {
  return [
    `Continuing as long run ${runId}.`,
    `I'll post milestones and the result here.`,
    `Status: /run_status ${runId} · list: /runs · cancel: /cancel_run ${runId}`,
  ].join('\n');
}
