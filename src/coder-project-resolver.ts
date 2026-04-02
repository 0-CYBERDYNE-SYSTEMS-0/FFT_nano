import fs from 'fs';
import path from 'path';

export interface CoderProjectCandidate {
  projectLabel: string;
  workspaceRoot: string;
  source: 'catalog' | 'workspace' | 'main';
  isGitRepo: boolean;
  score: number;
}

export type ResolveCoderProjectTargetResult =
  | {
      status: 'resolved';
      workspaceRoot: string;
      projectLabel: string;
      isGitRepo: boolean;
      taskText: string;
      projectHint: string | null;
    }
  | {
      status: 'ambiguous';
      candidates: CoderProjectCandidate[];
      taskText: string;
      projectHint: string | null;
    }
  | {
      status: 'not_found';
      taskText: string;
      projectHint: string | null;
      suggestedSlug: string | null;
    };

const FALLBACK_EXCLUDED_DIRS = new Set([
  '.fft_nano',
  '.github',
  'backup',
  'config',
  'coder_runs',
  'data',
  'dist',
  'docs',
  'memory',
  'node_modules',
  'scripts',
  'skills',
  'src',
  'test',
  'tests',
  'tmp',
  'workspace',
]);

function normalizeLoose(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeTight(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function tokenize(value: string): string[] {
  return normalizeLoose(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let i = 1; i <= b.length; i += 1) {
    let previous = i - 1;
    rows[0] = i;
    for (let j = 1; j <= a.length; j += 1) {
      const current = rows[j]!;
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      rows[j] = Math.min(rows[j]! + 1, rows[j - 1]! + 1, previous + cost);
      previous = current;
    }
  }
  return rows[a.length]!;
}

function looksLikeProjectDir(dirName: string): boolean {
  if (!dirName || dirName.startsWith('.')) return false;
  const normalized = dirName.toLowerCase();
  if (FALLBACK_EXCLUDED_DIRS.has(normalized)) return false;
  if (normalized.startsWith('backup-')) return false;
  return true;
}

function isGitRepoDir(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, '.git'));
}

export function extractProjectOverride(taskText: string): {
  projectHint: string | null;
  cleanedTaskText: string;
} {
  const match = taskText.match(/\bproject:([A-Za-z0-9._-]+)\b/i);
  if (!match) {
    return { projectHint: null, cleanedTaskText: taskText.trim() };
  }
  const projectHint = match[1]?.trim() || null;
  const cleanedTaskText = taskText.replace(match[0], '').replace(/\s+/g, ' ').trim();
  return {
    projectHint,
    cleanedTaskText: cleanedTaskText || taskText.trim(),
  };
}

export function listCoderProjectCandidates(
  mainWorkspaceDir: string,
): CoderProjectCandidate[] {
  const candidates: CoderProjectCandidate[] = [];
  const seenPaths = new Set<string>();

  if (fs.existsSync(mainWorkspaceDir) && fs.statSync(mainWorkspaceDir).isDirectory()) {
    const isGitRepo = isGitRepoDir(mainWorkspaceDir);
    candidates.push({
      projectLabel: path.basename(mainWorkspaceDir) || 'main-workspace',
      workspaceRoot: mainWorkspaceDir,
      source: 'main',
      isGitRepo,
      score: 0,
    });
    seenPaths.add(mainWorkspaceDir);
  }

  const catalogRoot = path.join(mainWorkspaceDir, 'workspace', 'projects');
  if (fs.existsSync(catalogRoot)) {
    for (const entry of fs.readdirSync(catalogRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspaceRoot = path.join(catalogRoot, entry.name);
      candidates.push({
        projectLabel: entry.name,
        workspaceRoot,
        source: 'catalog',
        isGitRepo: isGitRepoDir(workspaceRoot),
        score: 0,
      });
      seenPaths.add(workspaceRoot);
    }
  }

  if (fs.existsSync(mainWorkspaceDir)) {
    for (const entry of fs.readdirSync(mainWorkspaceDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!looksLikeProjectDir(entry.name)) continue;
      const workspaceRoot = path.join(mainWorkspaceDir, entry.name);
      if (seenPaths.has(workspaceRoot)) continue;
      const isGitRepo = isGitRepoDir(workspaceRoot);
      if (!isGitRepo) continue;
      candidates.push({
        projectLabel: entry.name,
        workspaceRoot,
        source: 'workspace',
        isGitRepo,
        score: 0,
      });
    }
  }

  return candidates;
}

function scoreCandidate(projectLabel: string, query: string): number {
  const queryLoose = normalizeLoose(query);
  const queryTight = normalizeTight(query);
  const labelLoose = normalizeLoose(projectLabel);
  const labelTight = normalizeTight(projectLabel);
  if (!queryLoose || !labelLoose) return 0;

  let score = 0;
  if (queryLoose.includes(labelLoose)) score += 100;
  else if (queryTight.includes(labelTight)) score += 90;
  else if (labelLoose.includes(queryLoose) && queryLoose.length >= 4) score += 85;
  else if (labelTight.includes(queryTight) && queryTight.length >= 4) score += 80;

  const queryTokens = tokenize(query);
  const labelTokens = tokenize(projectLabel);

  for (const token of labelTokens) {
    if (queryTokens.includes(token)) {
      score += 18;
      continue;
    }
    const distance = queryTokens.reduce((best, candidate) => {
      return Math.min(best, levenshtein(token, candidate));
    }, Number.POSITIVE_INFINITY);
    if (Number.isFinite(distance) && distance <= 2) {
      score += 12;
    }
  }

  return score;
}

function slugifyProjectName(value: string): string | null {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

export function resolveCoderProjectTarget(params: {
  mainWorkspaceDir: string;
  taskText: string;
}): ResolveCoderProjectTargetResult {
  const { projectHint, cleanedTaskText } = extractProjectOverride(params.taskText);
  const candidates = listCoderProjectCandidates(params.mainWorkspaceDir).map((candidate) => ({
    ...candidate,
    score: scoreCandidate(candidate.projectLabel, projectHint || cleanedTaskText),
  }));
  const ranked = [...candidates].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const sourceRank = (source: CoderProjectCandidate['source']): number => {
      switch (source) {
        case 'catalog':
          return 0;
        case 'main':
          return 1;
        default:
          return 2;
      }
    };
    if (a.source !== b.source) return sourceRank(a.source) - sourceRank(b.source);
    return a.projectLabel.localeCompare(b.projectLabel);
  });
  const top = ranked[0];
  const second = ranked[1];
  const mainWorkspaceCandidate = candidates.find((candidate) => candidate.source === 'main');

  const minimumScore = projectHint ? 12 : 18;
  const implicitProjectMinimumScore = 40;
  if (!projectHint && mainWorkspaceCandidate) {
    if (!top || top.source === 'main' || top.score < implicitProjectMinimumScore) {
      return {
        status: 'resolved',
        workspaceRoot: mainWorkspaceCandidate.workspaceRoot,
        projectLabel: mainWorkspaceCandidate.projectLabel,
        isGitRepo: mainWorkspaceCandidate.isGitRepo,
        taskText: cleanedTaskText,
        projectHint,
      };
    }
  }
  if (!top || top.score < minimumScore) {
    return {
      status: 'not_found',
      taskText: cleanedTaskText,
      projectHint,
      suggestedSlug: slugifyProjectName(projectHint || ''),
    };
  }

  const isAmbiguous =
    !!second &&
    second.score >= minimumScore &&
    top.score - second.score <= 12;
  if (isAmbiguous) {
    return {
      status: 'ambiguous',
      candidates: ranked.filter((candidate) => candidate.score >= minimumScore).slice(0, 3),
      taskText: cleanedTaskText,
      projectHint,
    };
  }

  return {
    status: 'resolved',
    workspaceRoot: top.workspaceRoot,
    projectLabel: top.projectLabel,
    isGitRepo: top.isGitRepo,
    taskText: cleanedTaskText,
    projectHint,
  };
}
