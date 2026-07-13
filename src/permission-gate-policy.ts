import {
  decideAuthorityAction,
  type AuthorityActionCategory,
} from './authority-policy.js';
import { isDestructiveCommand } from './bash-guard.js';
import type { RunAuthority } from './types.js';

const PROTECTED_PATHS = ['.env', '.env.', '.git/', 'node_modules/'];

export type ActionCategory = AuthorityActionCategory;

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
 * Core (origin × grant × category) decisions come from authority-policy.ts.
 * This function layers tool-specific detail (protected paths, bash match text).
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

  // Maintenance: table blocks all categories; keep distinct messages for read.
  if (origin === 'maintenance') {
    if (classification.category === 'read') {
      return {
        action: 'block',
        reason:
          'Maintenance run cannot read files. All filesystem access is denied.',
      };
    }
    return {
      action: 'block',
      reason: `Maintenance run cannot perform '${toolName}' operations. Maintenance runs may only return structured learning proposals.`,
    };
  }

  // Protected paths: special-case on top of local-mutate allow.
  if (
    classification.category === 'local-mutate' &&
    (toolName === 'edit' || toolName === 'write') &&
    typeof input.path === 'string' &&
    isProtectedPath(input.path)
  ) {
    if (origin === 'interactive-main' && runAuthority.operatorGrant) {
      return {
        action: 'confirm',
        title: 'Protected Path',
        message: `The agent wants to ${toolName}:\n\n  ${input.path}\n\nThis is a protected path. Allow?`,
      };
    }
    return {
      action: 'block',
      reason: `Write to protected path blocked: ${input.path}. ${
        origin === 'subagent'
          ? 'Subagents cannot modify protected files.'
          : 'Headless/evaluator runs cannot modify protected paths.'
      }`,
    };
  }

  const table = decideAuthorityAction({
    origin,
    operatorGrant: runAuthority.operatorGrant,
    category: classification.category,
  });

  if (classification.category === 'destroy') {
    const command = typeof input.command === 'string' ? input.command : '';
    const result = isDestructiveCommand(command);
    if (table.action === 'block') {
      return {
        action: 'block',
        reason: `Destructive command blocked (${result.matched}). ${
          table.detail ||
          'Headless/evaluator runs cannot execute destructive commands without operator confirmation.'
        }`,
      };
    }
    if (table.action === 'confirm') {
      return {
        action: 'confirm',
        title: 'Destructive Command',
        message: `The agent wants to run:\n\n  ${command}\n\nMatched: ${result.matched}\n\nAllow this command?`,
      };
    }
  }

  if (table.action === 'held') return { action: 'held' };
  if (table.action === 'allow') return { action: 'allow' };
  if (table.action === 'confirm') {
    return {
      action: 'confirm',
      title: 'Permission required',
      message: table.detail || `Allow ${toolName}?`,
    };
  }
  return {
    action: 'block',
    reason: table.detail || `Blocked by authority policy (${table.reasonCode})`,
  };
}
