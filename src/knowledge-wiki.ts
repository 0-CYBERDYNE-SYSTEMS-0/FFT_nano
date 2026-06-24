import fs from 'fs';
import path from 'path';

export const KNOWLEDGE_ROOT_DIRNAME = 'knowledge';

// Bump SCAFFOLD_VERSION whenever the *static* template files (README.md,
// schema/qualia-schema.md, wiki/index.md, wiki/progress.md, wiki/log.md)
// change. `upgradeKnowledgeWikiScaffold` will then offer to overlay the new
// templates on existing workspaces without touching `wiki/*.md` page bodies.
// Memory-shaped page triage and librarian reformat are separate concerns.
export const SCAFFOLD_VERSION = 2;

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
    'Purpose: a curated library of external sources the operator has given the',
    'agent (articles, papers, docs, repos, transcripts, datasets). The LLM',
    'owns `knowledge/wiki/`; the operator owns `knowledge/raw/`.',
    '',
    "This is a knowledge base, not a memory system. For the agent's own",
    'working memory, see `canonical/`, `MEMORY.md`, and `memory/`.',
    '',
    'Directory contract:',
    '- `knowledge/schema/qualia-schema.md`: wiki-page schema and invariants.',
    '- `knowledge/wiki/index.md`: curated entry points and cross-references.',
    '- `knowledge/wiki/progress.md`: rolling progress tracker (last-run summary).',
    '- `knowledge/wiki/log.md`: append-only maintenance log.',
    '- `knowledge/raw/`: operator-curated intake. Immutable source-of-truth.',
    '- `knowledge/reports/`: lint and maintenance reports.',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'schema', 'qualia-schema.md')]: [
    '# Wiki Schema',
    '',
    'This file governs pages in `knowledge/wiki/`. It is NOT a memory schema.',
    'Pages here describe external sources the operator has given the agent',
    '(articles, papers, docs, repos, transcripts, datasets). They are not a',
    "place for the agent's own working notes, decisions, or self-reflection",
    '— those live in `canonical/`, `MEMORY.md`, and `memory/YYYY-MM-DD.md`.',
    '',
    '## Core rules',
    '',
    '- Each page covers one entity, concept, comparison, or topic. Do not mix.',
    '- Stable, human-readable identifiers in the page filename (kebab-case).',
    '- Every non-obvious claim cites at least one source by relative path',
    '  under `knowledge/raw/` (the source-of-truth is immutable).',
    '- Contradictions with earlier wiki content are surfaced inline, never',
    '  silently overwritten. Add a `## Contradictions` section when relevant.',
    '- Cross-references use relative markdown links (`[Aragorn](./aragorn.md)`)',
    '  so the wiki graph stays navigable in any viewer.',
    '- Operational procedures must be testable and reversible.',
    '',
    '## Required frontmatter',
    '',
    'Every wiki page starts with a YAML frontmatter block:',
    '',
    '```yaml',
    '---',
    'type: entity | concept | comparison | procedure | topic',
    'sources: 3            # count of raw captures that informed this page',
    'updated: 2026-06-23   # ISO date of last meaningful revision',
    'confidence: high | medium | low',
    'tags: [pump-systems, irrigation]',
    '---',
    '```',
    '',
    '## Required sections (entity / concept / topic pages)',
    '',
    '1. **Summary** — 2-4 sentences. What is this thing?',
    '2. **Facts** — bulleted, each ending with a source citation in the form',
    '   `[raw/2026-04-22-pump-pressure.md]`. No uncited claims.',
    '3. **Cross-references** — relative links to other wiki pages.',
    '4. **Contradictions** — only if a newer source disagrees with an older one;',
    '   state both positions and the sources for each.',
    '5. **Open questions** — things this page would benefit from a source on,',
    '   but does not yet have.',
    '6. **Sources** — full relative-path list of every `raw/` file that',
    '   contributed to this page (auto-maintained by the librarian).',
    '',
    '## Required sections (comparison pages)',
    '',
    'Same as above, but section 2 is a markdown table with one row per option',
    'and one column per axis of comparison. Each cell cites its source.',
    '',
    '## Required sections (procedure pages)',
    '',
    '1. **Summary**',
    '2. **Prerequisites**',
    '3. **Steps** — numbered, each step verifiable.',
    '4. **Rollback** — what to do if a step fails or conditions change.',
    '5. **Cross-references**',
    '6. **Sources**',
    '',
    '## What is NOT a wiki page',
    '',
    '- Operator profile facts → `canonical/identity.md`',
    '- Standing hard rules → `canonical/constraints.md`',
    '- Active commitments → `canonical/commitments.md`',
    '- Long-lived project context → `canonical/projects.md`',
    '- Operator-curated long-term memory → `MEMORY.md`',
    '- Daily session notes and compaction summaries → `memory/YYYY-MM-DD.md`',
    '- High-priority memory that must be in every prompt → `canonical/_hot.md`',
    '',
    "If you find yourself wanting to write the agent's own working notes here,",
    'stop — that is what `memory/` and `canonical/` are for. The wiki is for',
    'what the agent has *read*, not what the agent has *thought*.',
  ].join('\n'),
  [path.join(KNOWLEDGE_ROOT_DIRNAME, 'wiki', 'index.md')]: [
    '# Wiki Index',
    '',
    'Curated pages live below. Each one covers one entity, concept, comparison,',
    'procedure, or topic, and cites the `raw/` captures that informed it.',
    '',
    '- [Progress](./progress.md)',
    '- [Maintenance Log](./log.md)',
    '',
    '---',
    '',
    '## Pages',
    '',
    '_Add curated pages here as they are integrated from `../raw/` captures._',
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

// Files `upgradeKnowledgeWikiScaffold` is allowed to overlay on an existing
// workspace. ONLY the static doctrine files belong here. `wiki/index.md`
// (curated page list), `wiki/progress.md` (rolling tracker), and `wiki/log.md`
// (append-only history) hold live operator/librarian content and must NEVER be
// overwritten by an upgrade — they are seeded once by ensureKnowledgeWikiScaffold
// and owned thereafter.
const STATIC_OVERLAY_FILES: string[] = [
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'README.md'),
  path.join(KNOWLEDGE_ROOT_DIRNAME, 'schema', 'qualia-schema.md'),
];

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
  scaffoldVersionPath: string;
  scaffoldBackupsDir: string;
}

export interface EnsureKnowledgeWikiScaffoldResult {
  paths: KnowledgeWikiPaths;
  createdPaths: string[];
}

export interface KnowledgeWikiUpgradeResult {
  upgraded: boolean;
  currentVersion: number;
  targetVersion: number;
  changed: string[];
  backupRelativeDir: string | null;
  reason: 'already-current' | 'no-scaffold' | 'applied';
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
    scaffoldVersionPath: path.join(rootDir, '.scaffold-version'),
    scaffoldBackupsDir: path.join(rootDir, '.scaffold-backups'),
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

  const readmeRelative = path.join(KNOWLEDGE_ROOT_DIRNAME, 'README.md');
  let createdReadme = false;
  for (const [relativePath, template] of Object.entries(
    REQUIRED_FILE_TEMPLATES,
  )) {
    const absolutePath = path.join(params.workspaceDir, relativePath);
    if (writeFileIfMissing(absolutePath, template)) {
      createdPaths.push(toRelativePath(params.workspaceDir, absolutePath));
      if (relativePath === readmeRelative) createdReadme = true;
    }
  }

  // Stamp the scaffold version only for a brand-new scaffold (the README, the
  // anchor template, was just created). An existing OLD scaffold creates no
  // files here, leaves the stamp absent (=> version 0), and is picked up by
  // `upgradeKnowledgeWikiScaffold`. This keeps fresh workspaces from being
  // false-flagged as behind by the lint.
  if (createdReadme && !fs.existsSync(paths.scaffoldVersionPath)) {
    writeScaffoldVersion(paths.scaffoldVersionPath, SCAFFOLD_VERSION);
  }

  return { paths, createdPaths };
}

function readScaffoldVersion(versionPath: string): number {
  if (!fs.existsSync(versionPath)) return 0;
  try {
    const raw = fs.readFileSync(versionPath, 'utf-8').trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeScaffoldVersion(versionPath: string, version: number): void {
  fs.writeFileSync(versionPath, `${version}\n`, 'utf-8');
}

function normalizeTemplateForCompare(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\s+$/g, '');
}

function templateNeedsUpgrade(existing: string, template: string): boolean {
  return (
    normalizeTemplateForCompare(existing) !==
    normalizeTemplateForCompare(template)
  );
}

/**
 * Non-destructive overlay of static template files for an existing workspace.
 *
 * Behavior:
 *   - If the workspace has no scaffold at all, returns reason='no-scaffold' and
 *     makes no changes; the caller should run ensureKnowledgeWikiScaffold first.
 *   - If the workspace is already at SCAFFOLD_VERSION, returns reason='already-current'
 *     and makes no changes. Idempotent.
 *   - Otherwise: for each STATIC doctrine file (README.md and
 *     schema/qualia-schema.md — see STATIC_OVERLAY_FILES) whose current
 *     contents differ from the v2 template, the old file is copied into
 *     `knowledge/.scaffold-backups/<ts>/<relative-path>` and then overwritten
 *     with the template. The `knowledge/.scaffold-version` stamp is then
 *     updated. `wiki/index.md`, `wiki/progress.md`, and `wiki/log.md` hold live
 *     curated/appended content and are NEVER overwritten; `wiki/*.md` page
 *     bodies are never touched.
 *
 * Reformat of memory-shaped wiki pages to v2 schema is the librarian's job (W2).
 */
export function upgradeKnowledgeWikiScaffold(params: {
  workspaceDir: string;
  now?: Date;
}): KnowledgeWikiUpgradeResult {
  const now = params.now || new Date();
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const status = readKnowledgeWikiStatus({ workspaceDir: params.workspaceDir });

  if (!status.ready) {
    return {
      upgraded: false,
      currentVersion: 0,
      targetVersion: SCAFFOLD_VERSION,
      changed: [],
      backupRelativeDir: null,
      reason: 'no-scaffold',
    };
  }

  const currentVersion = readScaffoldVersion(paths.scaffoldVersionPath);
  if (currentVersion >= SCAFFOLD_VERSION) {
    return {
      upgraded: false,
      currentVersion,
      targetVersion: SCAFFOLD_VERSION,
      changed: [],
      backupRelativeDir: null,
      reason: 'already-current',
    };
  }

  const ts = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const backupDir = path.join(paths.scaffoldBackupsDir, ts);
  fs.mkdirSync(backupDir, { recursive: true });

  const changed: string[] = [];
  for (const relativePath of STATIC_OVERLAY_FILES) {
    const template = REQUIRED_FILE_TEMPLATES[relativePath];
    if (!template) continue;
    const absolutePath = path.join(params.workspaceDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      // Missing file: write template directly. This should not happen for a
      // ready scaffold, but is the safe fallback so we never delete content.
      fs.writeFileSync(absolutePath, `${template.trimEnd()}\n`, 'utf-8');
      changed.push(relativePath);
      continue;
    }
    let existing = '';
    try {
      existing = fs.readFileSync(absolutePath, 'utf-8');
    } catch {
      existing = '';
    }
    if (!templateNeedsUpgrade(existing, template)) {
      continue;
    }
    const backupPath = path.join(backupDir, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, existing, 'utf-8');
    fs.writeFileSync(absolutePath, `${template.trimEnd()}\n`, 'utf-8');
    changed.push(relativePath);
  }

  writeScaffoldVersion(paths.scaffoldVersionPath, SCAFFOLD_VERSION);

  try {
    appendKnowledgeWikiLog({
      workspaceDir: params.workspaceDir,
      now,
      entry: `[upgrade] v${currentVersion}->v${SCAFFOLD_VERSION} changed=${changed.length} backup=${path.relative(params.workspaceDir, backupDir)}`,
    });
  } catch {
    // best-effort
  }

  return {
    upgraded: true,
    currentVersion,
    targetVersion: SCAFFOLD_VERSION,
    changed,
    backupRelativeDir: path.relative(params.workspaceDir, backupDir),
    reason: 'applied',
  };
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

  // ---- W4: v2 conformance checks (warnings during migration, errors after) ---

  const currentScaffoldVersion = readScaffoldVersion(
    status.paths.scaffoldVersionPath,
  );
  if (currentScaffoldVersion < SCAFFOLD_VERSION) {
    errors.push(
      `Scaffold version is v${currentScaffoldVersion}, expected v${SCAFFOLD_VERSION}. Run upgradeKnowledgeWikiScaffold.`,
    );
  }

  const wikiPageFiles = listMarkdownFiles(status.paths.wikiDir).filter((p) => {
    const base = path.basename(p);
    return base !== 'index.md' && base !== 'progress.md' && base !== 'log.md';
  });
  const legacyPages: string[] = [];
  const nonConformingPages: string[] = [];
  for (const pageAbs of wikiPageFiles) {
    const pageName = path.basename(pageAbs);
    let body = '';
    try {
      body = fs.readFileSync(pageAbs, 'utf-8');
    } catch {
      continue;
    }
    const fmMatch = body.match(V2_FRONTMATTER_PATTERN);
    const fmText = fmMatch ? fmMatch[1] : '';
    const fieldsMissing = V2_FRONTMATTER_FIELDS.filter(
      (field) => !new RegExp(`^${field}\\s*:`, 'm').test(fmText),
    );
    const hasSourcesSection = SOURCES_SECTION_PATTERN.test(body);
    const hasRawCitations = RAW_CITATION_PATTERN.test(body);
    const memoryHeadingMatches = [
      ...body.matchAll(/^##\s+(Decisions|Open Questions)\s*$/gm),
    ].map((m) => m[1]);
    const issues: string[] = [];
    if (fieldsMissing.length > 0) {
      issues.push(`missing frontmatter: ${fieldsMissing.join(', ')}`);
    }
    if (!hasSourcesSection) {
      issues.push('missing ## Sources section');
    }
    if (!hasRawCitations) {
      issues.push('no [raw/...] citations');
    }
    if (memoryHeadingMatches.length > 0) {
      issues.push(`memory-style headings: ${memoryHeadingMatches.join(', ')}`);
    }
    if (issues.length > 0) {
      legacyPages.push(pageName);
      nonConformingPages.push(`${pageName} (${issues.join('; ')})`);
      // Spec: keep these as warnings during migration; promote to errors
      // once the triage manifest is acknowledged. The lint distinguishes
      // by an explicit `expectStrictV2` flag, but for the default
      // run-as-nightly the default is warnings.
      warnings.push(
        `Page \`${pageName}\` is not v2-conformant: ${issues.join('; ')}`,
      );
    }
  }
  if (legacyPages.length > 0) {
    warnings.push(
      `${legacyPages.length} of ${wikiPageFiles.length} wiki pages need v2 reformat.`,
    );
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
    `- scaffold_version: v${currentScaffoldVersion} (target: v${SCAFFOLD_VERSION})`,
    `- raw_captures: ${status.rawCaptureCount}`,
    `- wiki_docs: ${status.wikiDocCount}`,
    `- wiki_pages_non_conformant: ${nonConformingPages.length}`,
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

// ---- W3: raw intake reconnection -------------------------------------------

export interface ReingestArchivedCaptureResult {
  fileName: string;
  archivedRelativePath: string;
  activeRelativePath: string;
  status: 'moved' | 'not-found' | 'not-archived' | 'collision-backed-up';
  backupRelativePath: string | null;
}

/**
 * Promote an archived capture back to the active queue so the nightly
 * librarian re-curates it. The archived copy remains in place; the new
 * active copy gets a small `## Re-ingested` header so the curator can see
 * provenance. If a same-named active capture already exists, the existing
 * active copy is first backed up to `raw/_archived/<filename>.bak-<ts>` so
 * no information is lost.
 *
 * This is the "seed the loop" path the spec calls out: when the live `raw/`
 * is empty and the only captures are in `_archived/`, the operator (or
 * /librarian reingest) can promote a capture for re-curation without
 * losing the historical archive.
 */
export function reingestArchivedCapture(params: {
  workspaceDir: string;
  archivedFileName: string;
  now?: Date;
}): ReingestArchivedCaptureResult {
  const now = params.now || new Date();
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const archivedDir = path.join(paths.rawDir, '_archived');
  const archivedAbs = path.join(archivedDir, params.archivedFileName);

  if (!fs.existsSync(archivedAbs)) {
    return {
      fileName: params.archivedFileName,
      archivedRelativePath: path.relative(params.workspaceDir, archivedAbs),
      activeRelativePath: '',
      status: 'not-found',
      backupRelativePath: null,
    };
  }

  // Refuse to operate if the file is not actually in _archived/ (e.g. someone
  // passed a live capture). Spec: raw/ is immutable source-of-truth.
  const liveAbs = path.join(paths.rawDir, params.archivedFileName);
  if (
    fs.existsSync(liveAbs) &&
    path.resolve(liveAbs) === path.resolve(archivedAbs)
  ) {
    return {
      fileName: params.archivedFileName,
      archivedRelativePath: path.relative(params.workspaceDir, archivedAbs),
      activeRelativePath: path.relative(params.workspaceDir, liveAbs),
      status: 'not-archived',
      backupRelativePath: null,
    };
  }

  let status: ReingestArchivedCaptureResult['status'] = 'moved';
  let backupRelativePath: string | null = null;

  if (fs.existsSync(liveAbs)) {
    // Collision: back up the live capture to _archived/<filename>.bak-<ts>
    const ts = now
      .toISOString()
      .replace(/[:-]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const backupAbs = path.join(
      archivedDir,
      `${params.archivedFileName}.bak-${ts}`,
    );
    fs.copyFileSync(liveAbs, backupAbs);
    backupRelativePath = path.relative(params.workspaceDir, backupAbs);
    status = 'collision-backed-up';
  }

  let archivedBody = '';
  try {
    archivedBody = fs.readFileSync(archivedAbs, 'utf-8');
  } catch {
    archivedBody = '';
  }
  const reingestNote = [
    '',
    '<!-- re-ingested: promoted from _archived/ on ' +
      now.toISOString() +
      ' for re-curation; archive copy is the source of truth -->',
  ].join('\n');
  fs.writeFileSync(
    liveAbs,
    `${archivedBody.replace(/\s+$/, '')}${reingestNote}\n`,
    'utf-8',
  );

  try {
    appendKnowledgeWikiLog({
      workspaceDir: params.workspaceDir,
      now,
      entry: `[reingest] from=${path.relative(params.workspaceDir, archivedAbs)} to=${path.relative(params.workspaceDir, liveAbs)}${backupRelativePath ? ` backup=${backupRelativePath}` : ''}`,
    });
  } catch {
    // best-effort
  }

  return {
    fileName: params.archivedFileName,
    archivedRelativePath: path.relative(params.workspaceDir, archivedAbs),
    activeRelativePath: path.relative(params.workspaceDir, liveAbs),
    status,
    backupRelativePath,
  };
}

/**
 * List archived capture filenames (relative to raw/_archived/), newest first.
 * Used by the operator UI and by the nightly curator to discover the
 * re-curation backlog.
 */
export function listArchivedCaptures(params: {
  workspaceDir: string;
}): string[] {
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const archivedDir = path.join(paths.rawDir, '_archived');
  if (!fs.existsSync(archivedDir)) return [];
  return listMarkdownFiles(archivedDir)
    .map((abs) => path.relative(archivedDir, abs))
    .sort()
    .reverse();
}

// ---- W2: page triage routing ------------------------------------------------

export type WikiPageClassification =
  | 'source-derived'
  | 'memory-shaped'
  | 'ambiguous';

export interface WikiPageTriageEntry {
  fileName: string;
  relativePath: string;
  classification: WikiPageClassification;
  hasV2Frontmatter: boolean;
  hasSourcesSection: boolean;
  hasRawCitations: boolean;
  hasMemoryStyleHeadings: boolean;
  memoryHeadingMatches: string[];
  matchingRawCaptures: string[];
  sizeBytes: number;
  evidence: string;
  proposedDestination: string | null;
  proposedAction:
    | 'keep-and-flag-for-librarian-reformat'
    | 'relocate'
    | 'list-for-operator-decision';
}

export interface WikiPageTriageReport {
  generatedAt: string;
  workspaceDir: string;
  totalPages: number;
  counts: Record<WikiPageClassification, number>;
  entries: WikiPageTriageEntry[];
  manifestRelativePath: string;
  manifestAbsolutePath: string;
}

const V2_FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/;
const V2_FRONTMATTER_FIELDS = [
  'type',
  'sources',
  'updated',
  'confidence',
  'tags',
];
// Spec: only ## Decisions / ## Open Questions are flagged as memory-style
// vocabulary. ## Scope / ## Facts are pre-v2 wiki-schema headings (used by
// every page in the legacy corpus) and are NOT, by themselves, a memory signal.
const MEMORY_HEADING_PATTERN = /^##\s+(Decisions|Open Questions)\s*$/m;
const RAW_CITATION_PATTERN = /\[raw\/[^\]]+\]/;
const SOURCES_SECTION_PATTERN = /^##\s+Sources\s*$/m;
// Signals of agent self-reflection / operator-correction memory pages:
// incident chains, agent-reported outcomes, "TD correction" notes.
const REFLECTION_SIGNAL_PATTERN =
  /(incident chain|agent reported|td correction|operator correction|self-reflection|agent.{0,15}self.report|on \d{4}-\d{2}-\d{2}.{0,40}(reported|claimed|fabricated|updated))/i;
const SOURCES_LIKE_FILENAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)+$/;

function isV2Frontmatter(front: string | null): boolean {
  if (!front) return false;
  return V2_FRONTMATTER_FIELDS.every((field) =>
    new RegExp(`^${field}\\s*:`, 'm').test(front),
  );
}

function readPageBody(absolutePath: string): string {
  try {
    return fs.readFileSync(absolutePath, 'utf-8');
  } catch {
    return '';
  }
}

function classifyPage(
  fileName: string,
  body: string,
): {
  hasV2Frontmatter: boolean;
  hasSourcesSection: boolean;
  hasRawCitations: boolean;
  hasMemoryStyleHeadings: boolean;
  memoryHeadingMatches: string[];
} {
  const fmMatch = body.match(V2_FRONTMATTER_PATTERN);
  const hasV2Frontmatter = isV2Frontmatter(fmMatch ? fmMatch[1] : null);
  const hasSourcesSection = SOURCES_SECTION_PATTERN.test(body);
  const hasRawCitations = RAW_CITATION_PATTERN.test(body);
  const memoryMatches = [
    ...body.matchAll(/^##\s+(Decisions|Open Questions)\s*$/gm),
  ].map((m) => m[1]);
  const hasMemoryStyleHeadings = memoryMatches.length > 0;
  return {
    hasV2Frontmatter,
    hasSourcesSection,
    hasRawCitations,
    hasMemoryStyleHeadings,
    memoryHeadingMatches: memoryMatches,
  };
}

function stemTokenize(name: string): string[] {
  // Strip date prefix (YYYY-MM-DD_ or YYYYMMDDTHHMMSSZ) and split on - or _.
  // Drop tokens shorter than 4 chars or pure digits.
  let base = name.replace(/\.md$/i, '');
  base = base.replace(/^\d{4}-\d{2}-\d{2}_?/, '');
  base = base.replace(/^\d{8}T\d{6}Z[-_]?/, '');
  return base
    .split(/[-_]/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 4 && !/^\d+$/.test(token));
}

function findMatchingRawCaptures(
  rawDir: string,
  archivedDir: string,
  pageFileName: string,
): string[] {
  const pageTokens = new Set(stemTokenize(pageFileName));
  if (pageTokens.size === 0) return [];
  const candidateDirs = [rawDir, archivedDir].filter((dir) =>
    fs.existsSync(dir),
  );
  const matches: string[] = [];
  for (const dir of candidateDirs) {
    for (const entry of listMarkdownFiles(dir)) {
      const captureName = path.basename(entry);
      const captureTokens = new Set(stemTokenize(captureName));
      if (captureTokens.size === 0) continue;
      const overlap = [...pageTokens].filter((t) => captureTokens.has(t));
      const minRequired = Math.min(2, pageTokens.size);
      if (overlap.length >= minRequired) {
        matches.push(path.relative(path.dirname(dir), entry));
      }
    }
  }
  return Array.from(new Set(matches));
}

function fileSizeSafe(absolutePath: string): number {
  try {
    return fs.statSync(absolutePath).size;
  } catch {
    return 0;
  }
}

/**
 * Classify each non-bookkeeping page in `knowledge/wiki/` as one of:
 *   - 'source-derived'  : page already cites raw sources (## Sources + [raw/...]
 *                          citations). Keep, but flag for librarian reformat to
 *                          v2 frontmatter (W2 follow-up work).
 *   - 'memory-shaped'   : page uses old memory-style headings (## Decisions /
 *                          ## Open Questions) and lacks v2 frontmatter and
 *                          lacks [raw/...] citations. Surface for operator
 *                          decision; spec says do NOT move silently.
 *   - 'ambiguous'       : heuristics don't match either pattern. Surface for
 *                          operator decision.
 *
 * Returns entries with proposed actions + destinations but never moves files.
 * The operator must explicitly approve relocations; the spec is explicit that
 * ambiguous pages are surfaced, not moved.
 */
export function classifyWikiPages(params: {
  workspaceDir: string;
}): WikiPageTriageEntry[] {
  const { paths } = ensureKnowledgeWikiScaffold({
    workspaceDir: params.workspaceDir,
  });
  const bookkeeping = new Set(['index.md', 'progress.md', 'log.md']);
  const all = listMarkdownFiles(paths.wikiDir);
  const entries: WikiPageTriageEntry[] = [];
  const archivedDir = path.join(paths.rawDir, '_archived');

  for (const absolutePath of all) {
    const fileName = path.basename(absolutePath);
    if (bookkeeping.has(fileName)) continue;
    const body = readPageBody(absolutePath);
    const cls = classifyPage(fileName, body);
    const matchingCaptures = findMatchingRawCaptures(
      paths.rawDir,
      archivedDir,
      fileName,
    );

    let classification: WikiPageClassification;
    let proposedAction: WikiPageTriageEntry['proposedAction'];
    let proposedDestination: string | null = null;
    const evidenceParts: string[] = [];

    if (cls.hasSourcesSection && cls.hasRawCitations) {
      // Strongest signal of a source-derived page: it actually cites a raw
      // capture and has a Sources section. It may still be in the pre-v2
      // schema (Scope / Facts / Decisions / Open Questions) and need
      // librarian reformat, but the content is external-sourced.
      classification = 'source-derived';
      proposedAction = 'keep-and-flag-for-librarian-reformat';
      evidenceParts.push('## Sources section present');
      evidenceParts.push('has [raw/...] citations');
      if (!cls.hasV2Frontmatter) {
        evidenceParts.push('missing v2 frontmatter (librarian reformat)');
      }
      if (cls.hasMemoryStyleHeadings) {
        evidenceParts.push(
          `has legacy memory-style headings: ${cls.memoryHeadingMatches.join(', ')} (librarian reformat)`,
        );
      }
    } else if (matchingCaptures.length > 0) {
      // Strong heuristic: a page whose filename stem-matches a raw capture
      // (live or archived) is by definition a curated page of that source.
      // The pre-v2 schema didn't require [raw/...] citations, so we use
      // filename overlap as the bridge. Keep and flag for reformat.
      classification = 'source-derived';
      proposedAction = 'keep-and-flag-for-librarian-reformat';
      evidenceParts.push(
        `matched raw capture(s): ${matchingCaptures.slice(0, 3).join(', ')}${matchingCaptures.length > 3 ? ', ...' : ''}`,
      );
      if (!cls.hasV2Frontmatter) {
        evidenceParts.push('missing v2 frontmatter (librarian reformat)');
      }
      if (cls.hasMemoryStyleHeadings) {
        evidenceParts.push(
          `has legacy memory-style headings: ${cls.memoryHeadingMatches.join(', ')} (librarian reformat)`,
        );
      }
      if (!cls.hasSourcesSection && !cls.hasRawCitations) {
        evidenceParts.push('pre-v2 schema (no [raw/...] citations yet)');
      }
    } else if (
      cls.hasMemoryStyleHeadings &&
      !cls.hasSourcesSection &&
      !cls.hasRawCitations
    ) {
      classification = 'memory-shaped';
      proposedAction = 'list-for-operator-decision';
      evidenceParts.push(
        `memory-style headings: ${cls.memoryHeadingMatches.join(', ')}`,
      );
      evidenceParts.push('no ## Sources section; no [raw/...] citations');
      // Spec routing: operator/agent behavior protocols → canonical/constraints.md
      // campaign/deal/ops plans → canonical/projects.md
      // otherwise → memory/
      const lower = body.toLowerCase();
      const hasReflectionSignal = REFLECTION_SIGNAL_PATTERN.test(body);
      if (hasReflectionSignal) {
        evidenceParts.push('agent self-reflection / incident signal');
      }
      if (
        lower.includes('campaign') ||
        lower.includes('founder deal') ||
        lower.includes('positioning') ||
        lower.includes('leads')
      ) {
        proposedDestination = 'canonical/projects.md';
      } else if (
        lower.includes('protocol') ||
        lower.includes('discipline') ||
        lower.includes('anti-pattern') ||
        lower.includes('honesty')
      ) {
        proposedDestination = 'canonical/constraints.md';
      } else {
        proposedDestination = 'memory/';
      }
    } else {
      classification = 'ambiguous';
      proposedAction = 'list-for-operator-decision';
      const signals: string[] = [];
      if (cls.hasV2Frontmatter) signals.push('v2 frontmatter');
      else signals.push('no v2 frontmatter');
      if (cls.hasRawCitations) signals.push('has raw citations');
      else signals.push('no raw citations');
      if (cls.hasSourcesSection) signals.push('has ## Sources');
      else signals.push('no ## Sources');
      if (cls.hasMemoryStyleHeadings) {
        signals.push(`memory headings: ${cls.memoryHeadingMatches.join(', ')}`);
      }
      evidenceParts.push(signals.join('; '));
    }

    entries.push({
      fileName,
      relativePath: path.relative(params.workspaceDir, absolutePath),
      classification,
      hasV2Frontmatter: cls.hasV2Frontmatter,
      hasSourcesSection: cls.hasSourcesSection,
      hasRawCitations: cls.hasRawCitations,
      hasMemoryStyleHeadings: cls.hasMemoryStyleHeadings,
      memoryHeadingMatches: cls.memoryHeadingMatches,
      matchingRawCaptures: matchingCaptures,
      sizeBytes: fileSizeSafe(absolutePath),
      evidence: evidenceParts.join('; '),
      proposedDestination,
      proposedAction,
    });
  }

  entries.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return entries;
}

/**
 * Write a triage manifest under `knowledge/reports/triage-<ts>.md` covering all
 * non-bookkeeping wiki pages, with classifications, evidence, and proposed
 * destinations. Does NOT move files. Operator must review ambiguous/memory
 * entries before any relocation.
 */
export function writeWikiPageTriageManifest(params: {
  workspaceDir: string;
  now?: Date;
}): WikiPageTriageReport {
  const now = params.now || new Date();
  const entries = classifyWikiPages({ workspaceDir: params.workspaceDir });
  const counts: Record<WikiPageClassification, number> = {
    'source-derived': 0,
    'memory-shaped': 0,
    ambiguous: 0,
  };
  for (const entry of entries) counts[entry.classification] += 1;

  const ts = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const lines: string[] = [
    '# Wiki Page Triage Manifest',
    '',
    `- generated_at: ${now.toISOString()}`,
    `- workspace: ${params.workspaceDir}`,
    `- total_pages: ${entries.length}`,
    `- source-derived: ${counts['source-derived']}`,
    `- memory-shaped: ${counts['memory-shaped']}`,
    `- ambiguous: ${counts.ambiguous}`,
    '',
    'Heuristic (strongest signal first):',
    '- source-derived: page has ## Sources section AND has [raw/...] citations, OR page filename stem-matches an existing live/archived raw capture (pre-v2 schema allowed; librarian reformat later)',
    '- memory-shaped: page has ## Decisions or ## Open Questions headings, no ## Sources, no [raw/...] citations, and no matching raw capture (operator decision to relocate)',
    '- memory-shaped: page has old memory-style ## headings (Decisions / Open Questions / Scope / Facts) and lacks both v2 frontmatter and [raw/...] citations',
    '- ambiguous: anything else; surface for operator decision',
    '',
    'No files have been moved. Review each entry below and approve relocations explicitly.',
    '',
    '## Source-derived (keep, flag for librarian reformat)',
    '',
  ];

  const sourceDerived = entries.filter(
    (e) => e.classification === 'source-derived',
  );
  if (sourceDerived.length === 0) {
    lines.push('- _(none)_');
  } else {
    for (const entry of sourceDerived) {
      const captureNote =
        entry.matchingRawCaptures.length > 0
          ? ` [matched ${entry.matchingRawCaptures.length} raw capture(s)]`
          : '';
      lines.push(
        `- \`${entry.relativePath}\` — ${entry.evidence}${captureNote} (${entry.sizeBytes}B)`,
      );
    }
  }

  lines.push('', '## Memory-shaped (operator decision: relocate?)', '');
  const memoryShaped = entries.filter(
    (e) => e.classification === 'memory-shaped',
  );
  if (memoryShaped.length === 0) {
    lines.push('- _(none)_');
  } else {
    for (const entry of memoryShaped) {
      lines.push(
        `- \`${entry.relativePath}\` → proposed: \`${entry.proposedDestination}\` — ${entry.evidence}`,
      );
    }
  }

  lines.push('', '## Ambiguous (operator decision required)', '');
  const ambiguous = entries.filter((e) => e.classification === 'ambiguous');
  if (ambiguous.length === 0) {
    lines.push('- _(none)_');
  } else {
    for (const entry of ambiguous) {
      lines.push(
        `- \`${entry.relativePath}\` — ${entry.evidence} (${entry.sizeBytes}B)`,
      );
    }
  }

  lines.push('', '## Summary', '');
  lines.push(
    `- Relocations proposed but NOT executed: ${memoryShaped.length + ambiguous.length}`,
  );
  lines.push(`- Keep-in-place-and-flag-for-reformat: ${sourceDerived.length}`);

  const reportRelativePath = path.join(
    KNOWLEDGE_ROOT_DIRNAME,
    'reports',
    `triage-${ts}.md`,
  );
  const reportAbsolutePath = path.join(params.workspaceDir, reportRelativePath);
  fs.mkdirSync(path.dirname(reportAbsolutePath), { recursive: true });
  fs.writeFileSync(reportAbsolutePath, `${lines.join('\n')}\n`, 'utf-8');

  try {
    appendKnowledgeWikiLog({
      workspaceDir: params.workspaceDir,
      now,
      entry: `[triage] total=${entries.length} source-derived=${counts['source-derived']} memory-shaped=${counts['memory-shaped']} ambiguous=${counts.ambiguous} manifest=${reportRelativePath}`,
    });
  } catch {
    // best-effort
  }

  return {
    generatedAt: now.toISOString(),
    workspaceDir: params.workspaceDir,
    totalPages: entries.length,
    counts,
    entries,
    manifestRelativePath: reportRelativePath,
    manifestAbsolutePath: reportAbsolutePath,
  };
}
