export interface DestructivePattern {
  pattern: RegExp;
  description: string;
}

export const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  { pattern: /\brm\s+\S*-\S*r\S*/i, description: 'rm -r (recursive delete)' },
  { pattern: /\brm\s+\S*-\S*f\S*/i, description: 'rm -f (force delete)' },
  { pattern: /\brm\s+[^|;&\n]+/i, description: 'rm with path arguments' },
  { pattern: /\brmdir\b/i, description: 'rmdir' },
  { pattern: /\bdd\s+.*\bof=/i, description: 'dd writing to device/file' },
  { pattern: /\bmkfs\b/i, description: 'mkfs (format filesystem)' },
  { pattern: /\bchmod\s+\S*-\S*R\S*\s+777\b/i, description: 'chmod -R 777' },
  { pattern: /\bchmod\s+\S*-\S*R\S*\s+000\b/i, description: 'chmod -R 000' },
  {
    pattern: /\bchown\s+\S*-\S*R/i,
    description: 'chown -R (recursive ownership change)',
  },
  {
    pattern: /\bgit\s+clean\s+\S*-\S*f/i,
    description: 'git clean -f (delete untracked files)',
  },
  { pattern: /\bgit\s+reset\s+--hard\b/i, description: 'git reset --hard' },
  { pattern: /\bgit\s+push\s+--force\b/i, description: 'git push --force' },
  { pattern: /\bgit\s+push\s+\S*-f\b/i, description: 'git push -f' },
  { pattern: /\btruncate\b/i, description: 'truncate (zero out file)' },
  { pattern: /\bshred\b/i, description: 'shred (secure delete)' },
];

export const DESTRUCTIVE_COMMAND_NAMES: string[] = [
  'rm (with any flags or paths)',
  'rmdir',
  'dd (to devices/files)',
  'mkfs',
  'chmod -R 777 / chmod -R 000',
  'chown -R',
  'git clean -f / -fd / -fdx',
  'git reset --hard',
  'git push --force / -f',
  'truncate',
  'shred',
];

export function isDestructiveCommand(cmd: string): {
  destructive: boolean;
  matched?: string;
} {
  const trimmed = cmd.trim();
  if (!trimmed) return { destructive: false };

  for (const entry of DESTRUCTIVE_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return { destructive: true, matched: entry.description };
    }
  }
  return { destructive: false };
}

export function auditToolExecution(
  toolName: string,
  args: string,
): { flagged: boolean; reason?: string } {
  if (toolName !== 'bash') return { flagged: false };
  const result = isDestructiveCommand(args);
  if (result.destructive) {
    return { flagged: true, reason: result.matched };
  }
  return { flagged: false };
}
