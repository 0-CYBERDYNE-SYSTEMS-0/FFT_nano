import { randomUUID } from 'crypto';
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

  // operatorGrant: true for interactive-main (operator present) and evaluator
  // runs; false for subagent, headless (including scheduled tasks) until
  // explicitly approved via a separate approval workflow.
  // Note: operator-created cron tasks get operatorGrant=true from the scheduler
  // when it sets created_by='operator'. The mint here handles the default for
  // the run authority; the outbox hold path uses operatorGrant to decide.
  const operatorGrant = origin === 'interactive-main' || origin === 'evaluator';

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
