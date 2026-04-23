import fs from 'fs';
import path from 'path';

export const KNOWLEDGE_ROOT_DIRNAME = 'knowledge';

const REQUIRED_DIRECTORY_PATHS = [
  KNOWLEDGE_ROOT_DIRNAME,
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'raw'),
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'wiki'),
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'schema'),
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'reports'),
] as const;

const REQUIRED_FILE_TEMPLATES: Record<string, string> = {
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'README.md')]: [
    '# Knowledge Wiki',
    '',
    'Purpose: maintain high-signal, schema-aligned operational knowledge.',
    '',
    'Directory contract:',
    '- `knowledge/schema/qualia-schema.md`: canonical schema and invariants.',
    '- `knowledge/wiki/index.md`: curated entry points and index.',
    '- `knowledge/wiki/progress.md`: rolling progress tracker.',
    '- `knowledge/wiki/log.md`: append-only maintenance log.',
    '- `knowledge/raw/`: raw captures before curation.',
    '- `knowledge/reports/`: lint and maintenance reports.',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'schema', 'qualia-schema.md')]: [
    '# Qualia Schema',
    '',
    'Core rules:',
    '- Preserve stable entity identifiers.',
    '- Separate observations from decisions.',
    '- Track source, timestamp, and confidence for non-obvious facts.',
    '- Keep operational procedures testable and reversible.',
    '',
    'Required sections for curated wiki docs:',
    '1. Scope',
    '2. Facts',
    '3. Decisions',
    '4. Open Questions',
    '5. Sources',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'wiki', 'index.md')]: [
    '# Wiki Index',
    '',
    '- [Progress](./progress.md)',
    '- [Maintenance Log](./log.md)',
    '',
    'Add domain pages here as they are curated from `../raw/` captures.',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'wiki', 'progress.md')]: [
    '# Progress Tracker',
    '',
    '| Date | Summary | Next Action |',
    '| --- | --- | --- |',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'wiki', 'log.md')]: [
    '# Maintenance Log (Append Only)',
    '',
    '- Initialized knowledge wiki scaffold.',
  ].join('\n'),
};

export interface KnowledgeWikiPaths {
  rootDir: string;
  rawDir: string;
  wikiDir: string;
  schemaDir: string;
  reportsDir: string;
  readmePath: string;
  schemaPath: string;
  indexPath: string;
  progressPath: string;
  logPath: string;
}

export interface EnsureKnowledgeWikiScaffoldResult {
  paths: KnowledgeWikiPaths;
  createdPaths: string[];
}

export interface KnowledgeWikiStatus {
  paths: KnowledgeWikiPaths;
  ready: boolean;
  missing: string[];
  rawCaptureCount: number;
  wikiDocCount: number;
  lastRawCaptureAt: string | null;
  lastProgressUpdateAt: string | null;
}

export interface KnowledgeRawCaptureResult {
  relativePath: string;
  absolutePath: string;
  capturedAt: string;
}

export interface KnowledgeLintReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  text: string;
  reportRelativePath: string;
  reportAbsolutePath: string;
}

function toRelativePath(workspaceDir: string, absolutePath: string): string {
  const rel = path.relative(workspaceDir, absolutePath);
  return rel || '.';
}

function writeFileIfMissing(filePath: string, body: string): boolean {
  if (fs.existsSync(filePath)) return false;
  fs.writeFileSync(filePath, `${body.trimEnd()}\n`, {
    encoding: 'utf-8',
    flag: 'wx',
  });
  return true;
}

function listMarkdownFiles(directoryPath: string): string[] {
  if (!fs.existsSync(directoryPath)) return [];
  try {
    return fs
      .readdirSync(directoryPath)
      .filter((entry) => entry.toLowerCase().endsWith('.md'))
      .map((entry) => path.join(directoryPath, entry));
  } catch {
    return [];
  }
}

function latestMtimeIso(filePaths: string[]): string | null {
  let latest = 0;
  for (const filePath of filePaths) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    } catch {
      // ignore unreadable paths
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : null;
}

function buildCaptureBaseName(now: Date, text: string): string {
  const stamp = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const firstWords = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join('-')
    .slice(0, 48);
  const slug = firstWords || 'note';
  return `${stamp}-${slug}`;
}

function makeUniqueFilePath(directoryPath: string, baseName: string): string {
  const primary = path.join(directoryPath, `${baseName}.md`);
  if (!fs.existsSync(primary)) return primary;
  let suffix = 2;
  while (suffix < 1000) {
    const candidate = path.join(directoryPath, `${baseName}-${suffix}.md`);
    if (!fs.existsSync(candidate)) return candidate;
    suffix += 1;
  }
  return path.join(directoryPath, `${baseName}-${Date.now()}.md`);
}

export function resolveKnowledgeWikiPaths(
  workspaceDir: string,
): KnowledgeWikiPaths {
  const rootDir = path.join(workspaceDir, KNOWLEDGE_ROOT_DIRNAME);
  const rawDir = path.join(rootDir, 'raw');
  const wikiDir = path.join(rootDir, 'wiki');
  const schemaDir = path.join(rootDir, 'schema');
  const reportsDir = path.join(rootDir, 'reports');
  return {
    rootDir,
    rawDir,
    wikiDir,
    schemaDir,
    reportsDir,
    readmePath: path.join(rootDir, 'README.md'),
    schemaPath: path.join(schemaDir, 'qualia-schema.md'),
    indexPath: path.join(wikiDir, 'index.md'),
    progressPath: path.join(wikiDir, 'progress.md'),
    logPath: path.join(wikiDir, 'log.md'),
  };
}

export function ensureKnowledgeWikiScaffold(params: {
  workspaceDir: string;
}): EnsureKnowledgeWikiScaffoldResult {
  const paths = resolveKnowledgeWikiPaths(params.workspaceDir);
  const createdPaths: string[] = [];

  for (const relativeDir of REQUIRED_DIRECTORY_PATHS) {
    const absoluteDir = path.join(params.workspaceDir, relativeDir);
    if (!fs.existsSync(absoluteDir)) {
      fs.mkdirSync(absoluteDir, { recursive: true });
      createdPaths.push(toRelativePath(params.workspaceDir, absoluteDir));
    }
  }

  for (const [relativePath, template] of Object.entries(
    REQUIRED_FILE_TEMPLATES,
  )) {
    const absolutePath = path.join(params.workspaceDir, relativePath);
    if (writeFileIfMissing(absolutePath, template)) {
      createdPaths.push(toRelativePath(params.workspaceDir, absolutePath));
    }
  }

  return { paths, createdPaths };
}

export function readKnowledgeWikiStatus(params: {
  workspaceDir: string;
}): KnowledgeWikiStatus {
  const paths = resolveKnowledgeWikiPaths(params.workspaceDir);

  const requiredPathMap: Array<[string, string]> = [
    ['knowledge/', paths.rootDir],
    ['knowledge/raw/', paths.rawDir],
    ['knowledge/wiki/', paths.wikiDir],
    ['knowledge/schema/', paths.schemaDir],
    ['knowledge/reports/', paths.reportsDir],
    ['knowledge/README.md', paths.readmePath],
    ['knowledge/schema/qualia-schema.md', paths.schemaPath],
    ['knowledge/wiki/index.md', paths.indexPath],
    ['knowledge/wiki/progress.md', paths.progressPath],
    ['knowledge/wiki/log.md', paths.logPath],
  ];

  const missing = requiredPathMap
    .filter(([, absolutePath]) => !fs.existsSync(absolutePath))
    .map(([relativePath]) => relativePath);

  const rawEntries = listMarkdownFiles(paths.rawDir);
  const wikiEntries = listMarkdownFiles(paths.wikiDir);
  const lastProgressUpdateAt = fs.existsSync(paths.progressPath)
    ? latestMtimeIso([paths.progressPath])
    : null;

  return {
    paths,
    ready: missing.length === 0,
    missing,
    rawCaptureCount: rawEntries.length,
    wikiDocCount: wikiEntries.length,
    lastRawCaptureAt: latestMtimeIso(rawEntries),
    lastProgressUpdateAt,
  };
}

export function formatKnowledgeWikiStatusText(params: {
  status: KnowledgeWikiStatus;
  nightlyTaskStatus?: string;
  nightlyTaskNextRun?: string | null;
}): string {
  const { status } = params;
  const lines = [
    'Knowledge wiki status:',
    `- ready: ${status.ready ? 'yes' : 'no'}`,
    `- raw_captures: ${status.rawCaptureCount}`,
    `- wiki_docs: ${status.wikiDocCount}`,
    `- last_raw_capture: ${status.lastRawCaptureAt || 'n/a'}`,
    `- last_progress_update: ${status.lastProgressUpdateAt || 'n/a'}`,
    `- nightly_task: ${params.nightlyTaskStatus || 'missing'}`,
    `- nightly_next_run: ${params.nightlyTaskNextRun || 'n/a'}`,
  ];
  if (status.missing.length > 0) {
    lines.push(
      '',
      'Missing paths:',
      ...status.missing.map((entry) => `- ${entry}`),
    );
  }
  return lines.join('\n');
}

export function appendKnowledgeWikiLog(params: {
  workspaceDir: string;
  entry: string;
  now?: Date;
}): void {
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const timestamp = (params.now || new Date()).toISOString();
  const line = `- ${timestamp} ${params.entry.trim()}\n`;
  fs.appendFileSync(paths.logPath, line, 'utf-8');
}

export function captureKnowledgeRawNote(params: {
  workspaceDir: string;
  text: string;
  source?: string;
  now?: Date;
}): KnowledgeRawCaptureResult {
  const text = params.text.trim();
  if (!text) {
    throw new Error('Cannot capture an empty knowledge note');
  }
  const now = params.now || new Date();
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const baseName = buildCaptureBaseName(now, text);
  const absolutePath = makeUniqueFilePath(paths.rawDir, baseName);
  const relativePath = toRelativePath(params.workspaceDir, absolutePath);
  const capturedAt = now.toISOString();

  const body = [
    '# Raw Capture',
    '',
    `- captured_at: ${capturedAt}`,
    `- source: ${params.source || 'manual'}`,
    '',
    '## Note',
    text,
  ].join('\n');
  fs.writeFileSync(absolutePath, `${body}\n`, 'utf-8');

  appendKnowledgeWikiLog({
    workspaceDir: params.workspaceDir,
    now,
    entry: `[capture] source=${params.source || 'manual'} path=${relativePath}`,
  });

  return {
    relativePath,
    absolutePath,
    capturedAt,
  };
}

export function runKnowledgeWikiLint(params: {
  workspaceDir: string;
  now?: Date;
}): KnowledgeLintReport {
  const now = params.now || new Date();
  const status = readKnowledgeWikiStatus({ workspaceDir: params.workspaceDir });
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!status.ready) {
    errors.push(`Missing required knowledge paths (${status.missing.length}).`);
  }
  if (status.wikiDocCount < 3) {
    warnings.push(
      'Wiki has fewer than 3 markdown docs. Add curated pages under knowledge/wiki/.',
    );
  }
  if (status.rawCaptureCount === 0) {
    warnings.push('No raw captures found in knowledge/raw/.');
  }
  if (!status.lastProgressUpdateAt) {
    warnings.push('Progress tracker has never been updated.');
  } else {
    const ageMs = now.getTime() - Date.parse(status.lastProgressUpdateAt);
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    if (ageDays > 14) {
      warnings.push(`Progress tracker is stale (${ageDays} days old).`);
    }
  }

  const reportLines = [
    '# Knowledge Wiki Lint Report',
    '',
    `- generated_at: ${now.toISOString()}`,
    `- ok: ${errors.length === 0 ? 'yes' : 'no'}`,
    `- errors: ${errors.length}`,
    `- warnings: ${warnings.length}`,
    '',
    '## Status Snapshot',
    `- ready: ${status.ready ? 'yes' : 'no'}`,
    `- raw_captures: ${status.rawCaptureCount}`,
    `- wiki_docs: ${status.wikiDocCount}`,
    `- last_raw_capture: ${status.lastRawCaptureAt || 'n/a'}`,
    `- last_progress_update: ${status.lastProgressUpdateAt || 'n/a'}`,
    '',
    '## Errors',
    ...(errors.length > 0 ? errors.map((entry) => `- ${entry}`) : ['- none']),
    '',
    '## Warnings',
    ...(warnings.length > 0
      ? warnings.map((entry) => `- ${entry}`)
      : ['- none']),
  ];

  const reportName = `lint-${now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')}.md`;
  const reportRelativePath = path.join(
    KNOWLEDGE_ROOT_DIRNAME,
    'reports',
    reportName,
  );
  const reportAbsolutePath = path.join(params.workspaceDir, reportRelativePath);
  fs.mkdirSync(path.dirname(reportAbsolutePath), { recursive: true });
  fs.writeFileSync(reportAbsolutePath, `${reportLines.join('\n')}\n`, 'utf-8');

  if (fs.existsSync(status.paths.logPath)) {
    const lintEntry = `[lint] ok=${errors.length === 0 ? 'yes' : 'no'} warnings=${warnings.length} errors=${errors.length} report=${reportRelativePath}`;
    fs.appendFileSync(
      status.paths.logPath,
      `- ${now.toISOString()} ${lintEntry}\n`,
      'utf-8',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    text: reportLines.join('\n'),
    reportRelativePath,
    reportAbsolutePath,
  };
}
