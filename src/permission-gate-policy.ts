import { isDestructiveCommand } from './bash-guard.js';

const PROTECTED_PATHS = ['.env', '.env.', '.git/', 'node_modules/'];

export type PermissionGateDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'confirm'; title: string; message: string };

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_PATHS.some(
    (segment) =>
      normalized === segment ||
      normalized.includes(`/${segment}`) ||
      normalized.startsWith(segment),
  );
}

export function evaluatePermissionGate(params: {
  toolName: string;
  input: Record<string, unknown>;
  isSubagent: boolean;
  hasUI: boolean;
}): PermissionGateDecision {
  if (params.toolName === 'bash') {
    const command = String(params.input.command ?? '');
    const result = isDestructiveCommand(command);
    if (!result.destructive) return { action: 'allow' };

    if (params.isSubagent || !params.hasUI) {
      return {
        action: 'block',
        reason: `Destructive command blocked (${result.matched}). ${
          params.isSubagent
            ? 'Subagents cannot execute destructive commands.'
            : 'No confirmation UI is available.'
        }`,
      };
    }

    return {
      action: 'confirm',
      title: 'Destructive Command',
      message: `The agent wants to run:\n\n  ${command}\n\nMatched: ${result.matched}\n\nAllow this command?`,
    };
  }

  if (params.toolName === 'write' || params.toolName === 'edit') {
    const filePath = String(params.input.path ?? '');
    if (!isProtectedPath(filePath)) return { action: 'allow' };

    if (params.isSubagent || !params.hasUI) {
      return {
        action: 'block',
        reason: `Write to protected path blocked: ${filePath}. ${
          params.isSubagent
            ? 'Subagents cannot modify protected files.'
            : 'No confirmation UI is available.'
        }`,
      };
    }

    return {
      action: 'confirm',
      title: 'Protected Path',
      message: `The agent wants to ${params.toolName}:\n\n  ${filePath}\n\nThis is a protected path. Allow?`,
    };
  }

  return { action: 'allow' };
}
