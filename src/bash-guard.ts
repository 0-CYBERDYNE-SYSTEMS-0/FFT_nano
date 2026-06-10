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
  // WS1.4 new patterns
  {
    pattern: /\bfind\s+.*\s+-delete\b/i,
    description: 'find ... -delete',
  },
  {
    pattern: /\blaunchctl\s+(bootout|unload|remove)\b/i,
    description: 'launchctl bootout|unload|remove',
  },
  {
    pattern: /\bsqlite3\s+.*store\/messages\.db/i,
    description: 'sqlite3 targeting store/messages.db',
  },
  {
    pattern: /\b(curl|wget)\s+.*\s+\|\s*(sh|bash|zsh)\b/i,
    description: 'pipe-to-shell (curl|wget | sh|bash|zsh)',
  },
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
  // WS1.4 new patterns
  'find ... -delete',
  'launchctl bootout|unload|remove',
  'sqlite3 targeting store/messages.db',
  'pipe-to-shell (curl|wget | sh|bash|zsh)',
];

/**
 * Canonicalize a command before destructive-pattern matching so that shell
 * tricks that bypass a naive regex are neutralized: backslash escapes
 * (`\rm`, `r\m`), quote-splitting (`r"m"`, `'rm'`), line continuations, and
 * irregular whitespace. The canonical form is used only for detection, so
 * over-normalization can at most cause an extra confirmation — never a missed
 * destructive command.
 */
export function canonicalizeForDetection(cmd: string): string {
  return cmd
    .replace(/\0/g, '') // strip null bytes
    .replace(/\\\r?\n/g, ' ') // join line continuations
    .replace(/\\(.)/g, '$1') // collapse shell escapes: \r -> r, "\ " -> space
    .replace(/['"`]/g, '') // strip quotes used to split a command token
    .replace(/\s+/g, ' ') // normalize whitespace
    .trim();
}

export function isDestructiveCommand(cmd: string): {
  destructive: boolean;
  matched?: string;
} {
  const canonical = canonicalizeForDetection(cmd);
  if (!canonical) return { destructive: false };

  for (const entry of DESTRUCTIVE_PATTERNS) {
    if (entry.pattern.test(canonical)) {
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
