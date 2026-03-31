/**
 * FFT Nano Permission Gate Extension
 *
 * Real-time destructive command guard that runs inside pi's process.
 * Intercepts tool_call events BEFORE execution and blocks destructive commands.
 *
 * Two modes:
 * - Subagent mode (FFT_NANO_SUBAGENT=1): Hard-blocks immediately, no confirmation.
 * - Main agent mode: Prompts user via pi's extension UI protocol (confirm dialog).
 *
 * Also blocks write/edit operations targeting protected paths (.env, .git/, etc.).
 *
 * This is the primary enforcement layer. The host-side bash-guard.ts audit
 * in pi-runner.ts serves as a secondary log-only fallback.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExtensionAPI = any;

// Destructive bash command patterns (mirrors src/bash-guard.ts DESTRUCTIVE_PATTERNS)
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\brm\s+\S*-\S*r\S*/i, description: 'rm -r (recursive delete)' },
  { pattern: /\brm\s+\S*-\S*f\S*/i, description: 'rm -f (force delete)' },
  { pattern: /\brm\s+[^|;&\n]+/i, description: 'rm with path arguments' },
  { pattern: /\brmdir\b/i, description: 'rmdir' },
  { pattern: /\bdd\s+.*\bof=/i, description: 'dd writing to device/file' },
  { pattern: /\bmkfs\b/i, description: 'mkfs (format filesystem)' },
  {
    pattern: /\bchmod\s+\S*-\S*R\S*\s+777\b/i,
    description: 'chmod -R 777',
  },
  {
    pattern: /\bchmod\s+\S*-\S*R\S*\s+000\b/i,
    description: 'chmod -R 000',
  },
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
  { pattern: /\bgit\s+push\b.*(?:\s|^)-f(?:\s|$)/i, description: 'git push -f (force push)' },
  { pattern: /\btruncate\b/i, description: 'truncate (zero out file)' },
  { pattern: /\bshred\b/i, description: 'shred (secure delete)' },
];

// Paths that should never be written to by write/edit tools
const PROTECTED_PATHS = [
  '.env',
  '.env.',
  '.git/',
  'node_modules/',
];

function isDestructiveCommand(command: string): {
  destructive: boolean;
  matched?: string;
} {
  const trimmed = command.trim();
  if (!trimmed) return { destructive: false };

  for (const entry of DESTRUCTIVE_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return { destructive: true, matched: entry.description };
    }
  }
  return { destructive: false };
}

function isProtectedPath(filePath: string): boolean {
  // Normalize path separators
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_PATHS.some(
    (p) => normalized === p || normalized.includes('/' + p) || normalized.startsWith(p),
  );
}

export default function (pi: ExtensionAPI) {
  const isSubagent = process.env.FFT_NANO_SUBAGENT === '1';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on('tool_call', async (event: any, ctx: any) => {
    // --- Bash destructive command check ---
    if (event.toolName === 'bash') {
      const command = String(event.input.command ?? '');
      const result = isDestructiveCommand(command);

      if (result.destructive) {
        if (isSubagent || !ctx.hasUI) {
          // Subagent or non-interactive mode: hard-block immediately
          return {
            block: true,
            reason: `Destructive command blocked (${result.matched}). Subagents cannot execute destructive commands.`,
          };
        }

        // Main agent with UI: prompt user for confirmation
        const confirmed = await ctx.ui.confirm(
          'Destructive Command',
          `The agent wants to run:\n\n  ${command}\n\nMatched: ${result.matched}\n\nAllow this command?`,
          { timeout: 60_000 },
        );

        if (!confirmed) {
          return {
            block: true,
            reason: `Destructive command denied by user (${result.matched}).`,
          };
        }
      }
    }

    // --- Protected path check for write/edit ---
    if (event.toolName === 'write' || event.toolName === 'edit') {
      const filePath = String(event.input.path ?? '');
      const protected_ = isProtectedPath(filePath);

      if (protected_) {
        if (isSubagent || !ctx.hasUI) {
          return {
            block: true,
            reason: `Write to protected path blocked: ${filePath}. Subagents cannot modify protected files.`,
          };
        }

        const confirmed = await ctx.ui.confirm(
          'Protected Path',
          `The agent wants to ${event.toolName}:\n\n  ${filePath}\n\nThis is a protected path. Allow?`,
          { timeout: 60_000 },
        );

        if (!confirmed) {
          return {
            block: true,
            reason: `Write to protected path denied by user: ${filePath}`,
          };
        }
      }
    }

    // Allow the tool to proceed
    return undefined;
  });
}
