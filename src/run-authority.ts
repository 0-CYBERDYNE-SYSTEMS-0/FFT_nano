import { randomUUID } from 'crypto';
import { resolveOperatorGrant } from './authority-policy.js';
import type { RunAuthority, RunOrigin } from './types.js';

interface ToolSetInput {
  toolMode?: 'default' | 'read_only' | 'full';
  codingHint?:
    | 'none'
    | 'auto'
    | 'force_delegate_execute'
    | 'force_delegate_plan';
}

/**
 * Derive the effective tool set from ContainerInput.toolMode + codingHint.
 * This must match the logic in buildPiArgs so the gate sees the same set
 * the subprocess receives.
 */
export function deriveEffectiveToolSet(
  input: ToolSetInput,
): readonly RunAuthority['effectiveToolSet'][number][] {
  const { toolMode, codingHint } = input;

  if (toolMode === 'read_only') {
    return ['read', 'grep', 'find', 'ls'] as const;
  }
  if (toolMode === 'full') {
    return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const;
  }
  // isForceDelegateHint
  if (codingHint === 'force_delegate_plan') {
    return ['read', 'grep', 'find', 'ls'] as const;
  }
  if (codingHint === 'force_delegate_execute' || codingHint === 'auto') {
    return [
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'agent',
    ] as const;
  }
  // Default branch (no toolMode, no codingHint) — cron/subagent/heartbeat path
  return [
    'read',
    'bash',
    'edit',
    'write',
    'grep',
    'find',
    'ls',
    'agent',
  ] as const;
}

/**
 * Derive the RunOrigin from spawn-time signals.
 *
 * Priority:
 *   maintenance > evaluator > interactive-main > subagent > headless
 *
 * Note: isHeartbeat is consulted BEFORE the interactive-main check because
 * a heartbeat run is always headless regardless of isMain — the operator is
 * not present at the keyboard.
 */
export function deriveRunOrigin(params: {
  isMaintenanceRun?: boolean;
  isEvaluatorRun?: boolean;
  isMain?: boolean;
  isSubagent?: boolean;
  isScheduledTask?: boolean;
  isHeartbeat?: boolean;
  requestId?: string;
}): RunOrigin {
  // LISO.6: Maintenance runs have their own origin distinct from evaluator
  if (params.isMaintenanceRun) return 'maintenance';
  if (params.isEvaluatorRun) return 'evaluator';
  // Heartbeats are headless (checked first so isMain=true + heartbeat → headless)
  if (params.isHeartbeat || params.requestId?.startsWith('heartbeat-')) {
    return 'headless';
  }
  // interactive-main: isMain, not subagent, not scheduled, not heartbeat
  if (params.isMain && !params.isSubagent && !params.isScheduledTask) {
    return 'interactive-main';
  }
  if (params.isSubagent) return 'subagent';
  // Scheduled tasks are headless
  return 'headless';
}

export interface MintRunAuthorityInput {
  requestId: string;
  groupFolder: string;
  isMain?: boolean;
  isSubagent?: boolean;
  isScheduledTask?: boolean;
  isHeartbeat?: boolean;
  isEvaluatorRun?: boolean;
  // LISO.6: Marks this as a maintenance run — no operatorGrant, no interactive tools
  isMaintenanceRun?: boolean;
  effectiveToolSet?: readonly RunAuthority['effectiveToolSet'][number][];
  senderRole?: RunAuthority['senderRole'];
  startedDuringPause?: boolean;
  dryRun?: boolean;
  /**
   * Host-only operator grant stamp. Use for operator-created scheduled runs
   * (map task.created_by === 'operator' at the host boundary). Never pass
   * agent-authored strings — only a host-computed boolean.
   */
  hostOperatorGrant?: boolean;
}

export function mintRunAuthority(input: MintRunAuthorityInput): RunAuthority {
  const {
    requestId,
    groupFolder,
    isMain = false,
    isSubagent = false,
    isScheduledTask = false,
    isHeartbeat = false,
    isEvaluatorRun = false,
    isMaintenanceRun = false,
    effectiveToolSet: explicitToolSet,
    senderRole = 'unknown',
    startedDuringPause = false,
    dryRun = false,
    hostOperatorGrant,
  } = input;

  const origin = deriveRunOrigin({
    isMaintenanceRun,
    isEvaluatorRun,
    isMain,
    isSubagent,
    isScheduledTask,
    isHeartbeat,
    requestId,
  });

  // Single grant resolver (authority-policy). Comments are not the policy.
  const operatorGrant = resolveOperatorGrant({
    origin,
    hostOperatorGrant,
  });

  const toolSet =
    explicitToolSet ??
    (isMain
      ? ([
          'read',
          'bash',
          'edit',
          'write',
          'grep',
          'find',
          'ls',
          'agent',
        ] as const)
      : ([
          'read',
          'bash',
          'edit',
          'write',
          'grep',
          'find',
          'ls',
          'agent',
        ] as const));

  return {
    authorityId: randomUUID(),
    requestId,
    origin,
    groupFolder,
    startedAt: new Date().toISOString(),
    effectiveToolSet: toolSet,
    operatorGrant,
    senderRole,
    startedDuringPause,
    dryRun,
  };
}
