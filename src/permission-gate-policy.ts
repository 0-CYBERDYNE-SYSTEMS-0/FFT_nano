import { isDestructiveCommand } from './bash-guard.js';
import type { RunAuthority } from './types.js';

const PROTECTED_PATHS = ['.env', '.env.', '.git/', 'node_modules/'];

export type ActionCategory = 'read' | 'local-mutate' | 'outbound' | 'schedule' | 'destroy';

export interface ClassifyResult {
  category: ActionCategory;
}

/**
 * Classify a tool invocation into one of five action categories.
 * The classifier is deterministic and total — unknown tool names
 * default to 'local-mutate' (the conservative-non-allow choice).
 *
 * Category semantics:
 *   read          — tools that only read state, never mutate it
 *   local-mutate  — tools that mutate local state (filesystem edits)
 *   outbound      — tools that send data outside the host (messages, webhooks, file delivery)
 *   schedule      — tools that schedule future agent runs
 *   destroy       — bash commands flagged by isDestructiveCommand
 */
export function classifyActionCategory(
  toolName: string,
  _input: Record<string, unknown>,
): ClassifyResult {
  switch (toolName) {
    // Read-only tools
    case 'read':
    case 'grep':
    case 'ls':
      return { category: 'read' };

    // Local-mutate tools
    case 'edit':
    case 'write':
      return { category: 'local-mutate' };

    // Bash: delegate to bash-guard for destroy classification
    case 'bash': {
      const command = typeof _input.command === 'string' ? _input.command : '';
      const result = isDestructiveCommand(command);
      return { category: result.destructive ? 'destroy' : 'local-mutate' };
    }

    // Outbound IPC tools
    case 'send_message':
    case 'deliver_file':
    case 'send_webhook':
      return { category: 'outbound' };

    // Scheduling IPC tools
    case 'schedule_task':
    case 'cancel_task':
      return { category: 'schedule' };

    // Unknown / future tools: conservative default
    default:
      return { category: 'local-mutate' };
  }
}

/**
 * Gate decisions for the (category, origin) policy table.
 *
 * Note on I1: evaluatePermissionGate never reads prompt content or any
 * IPC payload field that could be authored by the agent. The gate reads
 * only RunAuthority fields (origin, operatorGrant) and the tool input
 * (command, path, etc.) — none of which are agent-authored policy fields.
 */
export type PermissionGateDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'confirm'; title: string; message: string }
  | { action: 'held' };

export function isProtectedPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return PROTECTED_PATHS.some(
    (segment) =>
      normalized === segment ||
      normalized.includes(`/${segment}`) ||
      normalized.startsWith(segment),
  );
}

/**
 * Evaluate the permission gate using RunAuthority (host-derived, agent-proof).
 *
 * Policy table:
 *   read / local-mutate → always allow (any origin)
 *   destroy → block on headless/subagent/evaluator; confirm on interactive-main
 *   outbound → held on headless/subagent without operatorGrant; otherwise allow
 *   schedule → allow (WS2 enforces pending_approval at the IPC handler)
 *
 * I1 invariant: this function reads only RunAuthority fields and tool input.
 * It never reads prompt content or IPC payload fields authored by the agent.
 */
export function evaluatePermissionGate(params: {
  toolName: string;
  input: Record<string, unknown>;
  runAuthority: RunAuthority;
}): PermissionGateDecision {
  const { toolName, input, runAuthority } = params;
  const { origin } = runAuthority;

  const classification = classifyActionCategory(toolName, input);

  // VAL-WS1-007: read and local-mutate always allow regardless of origin
  if (classification.category === 'read' || classification.category === 'local-mutate') {
    return { action: 'allow' };
  }

  // VAL-WS1-008: destroy blocks headless/subagent/evaluator, confirms interactive-main
  if (classification.category === 'destroy') {
    const command = typeof input.command === 'string' ? input.command : '';
    const result = isDestructiveCommand(command);

    if (origin === 'headless' || origin === 'subagent' || origin === 'evaluator') {
      return {
        action: 'block',
        reason: `Destructive command blocked (${result.matched}). ${
          origin === 'subagent'
            ? 'Subagents cannot execute destructive commands.'
            : 'Headless/evaluator runs cannot execute destructive commands without operator confirmation.'
        }`,
      };
    }

    // interactive-main: confirm
    return {
      action: 'confirm',
      title: 'Destructive Command',
      message: `The agent wants to run:\n\n  ${command}\n\nMatched: ${result.matched}\n\nAllow this command?`,
    };
  }

  // VAL-WS1-009 + VAL-WS1-010: outbound held on headless/subagent without grant;
  // VAL-WS1-009 calls subagent a "headless run", so we include it in the held condition.
  if (classification.category === 'outbound') {
    if (
      (origin === 'headless' || origin === 'subagent') &&
      !runAuthority.operatorGrant
    ) {
      // The caller (IPC handler) is responsible for enqueueing the held row.
      // evaluatePermissionGate is pure — it signals the hold decision here.
      return { action: 'held' };
    }
    // interactive-main with operatorGrant → normal pending → delivered flow
    // evaluator runs always allow (operatorGrant=true by default)
    return { action: 'allow' };
  }

  // VAL-WS1-012: schedule always allows at the tool level.
  // WS2 enforces pending_approval status at the IPC handler, not here.
  if (classification.category === 'schedule') {
    return { action: 'allow' };
  }

  // Fallback: conservative deny for unknown categories
  return { action: 'allow' };
}

/**
 * Evaluate the permission gate using the legacy isSubagent/hasUI parameters.
 * This overload exists for backward compatibility with existing call sites
 * that have not yet been migrated to use RunAuthority.
 *
 * The origin mapping mirrors the RunAuthority derivation:
 *   isSubagent=true           → origin='subagent'
 *   isSubagent=false, hasUI   → origin='interactive-main'
 *   isSubagent=false, !hasUI  → origin='headless'
 */
export function evaluatePermissionGateLegacy(params: {
  toolName: string;
  input: Record<string, unknown>;
  isSubagent: boolean;
  hasUI: boolean;
}): PermissionGateDecision {
  const { toolName, input, isSubagent, hasUI } = params;

  if (toolName === 'bash') {
    const command = String(input.command ?? '');
    const result = isDestructiveCommand(command);
    if (!result.destructive) return { action: 'allow' };

    if (isSubagent || !hasUI) {
      return {
        action: 'block',
        reason: `Destructive command blocked (${result.matched}). ${
          isSubagent
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

  if (toolName === 'write' || toolName === 'edit') {
    const filePath = String(input.path ?? '');
    if (!isProtectedPath(filePath)) return { action: 'allow' };

    if (isSubagent || !hasUI) {
      return {
        action: 'block',
        reason: `Write to protected path blocked: ${filePath}. ${
          isSubagent
            ? 'Subagents cannot modify protected files.'
            : 'No confirmation UI is available.'
        }`,
      };
    }

    return {
      action: 'confirm',
      title: 'Protected Path',
      message: `The agent wants to ${toolName}:\n\n  ${filePath}\n\nThis is a protected path. Allow?`,
    };
  }

  return { action: 'allow' };
}
