import { randomUUID } from 'crypto';
import type { RunAuthority, RunOrigin } from './types.js';

interface ToolSetInput {
  toolMode?: 'default' | 'read_only' | 'full';
  codingHint?: 'none' | 'auto' | 'force_delegate_execute' | 'force_delegate_plan';
}

/**
 * Derive the effective tool set from ContainerInput.toolMode + codingHint.
 * This must match the logic in buildPiArgs so the gate sees the same set
 * the subprocess receives.
 */
export function deriveEffectiveToolSet(input: ToolSetInput): readonly RunAuthority['effectiveToolSet'][number][] {
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
  if (
    codingHint === 'force_delegate_execute' ||
    codingHint === 'auto'
  ) {
    return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'] as const;
  }
  // Default branch (no toolMode, no codingHint) — cron/subagent/heartbeat path
  return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'] as const;
}

/**
 * Derive the RunOrigin from spawn-time signals.
 *
 * Priority:
 *   evaluator > interactive-main > subagent > headless
 */
export function deriveRunOrigin(params: {
  isEvaluatorRun?: boolean;
  isMain?: boolean;
  isSubagent?: boolean;
  isScheduledTask?: boolean;
  isHeartbeat?: boolean;
  requestId?: string;
}): RunOrigin {
  if (params.isEvaluatorRun) return 'evaluator';
  // interactive-main: not scheduled, not subagent, not heartbeat, and isMain
  if (params.isMain && !params.isSubagent && !params.isScheduledTask) {
    // Additional check: heartbeat requests have IDs starting with 'heartbeat-'
    if (params.requestId?.startsWith('heartbeat-')) return 'headless';
    return 'interactive-main';
  }
  if (params.isSubagent) return 'subagent';
  // Scheduled tasks and heartbeats are headless
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
  effectiveToolSet?: readonly RunAuthority['effectiveToolSet'][number][];
  senderRole?: RunAuthority['senderRole'];
  startedDuringPause?: boolean;
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
    effectiveToolSet: explicitToolSet,
    senderRole = 'unknown',
    startedDuringPause = false,
  } = input;

  const origin = deriveRunOrigin({
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
  const operatorGrant =
    origin === 'interactive-main' || origin === 'evaluator';

  const toolSet =
    explicitToolSet ??
    (isMain
      ? (['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'] as const)
      : (['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'agent'] as const));

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
  };
}
