export type StatusIncidentKind = 'stale' | 'timeout' | 'failed';

export interface StatusIncident {
  kind: StatusIncidentKind;
  runId: string;
  chatJid?: string;
  detail?: string;
  createdAtMs: number;
}

export interface RunProgressSnapshot {
  runId: string;
  phase: string;
  text: string;
  detail?: string;
  updatedAtMs: number;
  chatJid?: string;
}

export interface StatusTelemetrySnapshot {
  incidents: StatusIncident[];
  progressByRunId: Map<string, RunProgressSnapshot>;
}

export interface StatusTelemetry {
  noteRunProgress(event: {
    runId: string;
    phase: string;
    text: string;
    detail?: string;
    chatJid?: string;
    createdAt?: string;
  }): void;
  noteRunFailed(event: {
    runId: string;
    errorMessage?: string;
    detail?: string;
    chatJid?: string;
    createdAt?: string;
  }): void;
  noteRuntimeError(event: {
    runId: string;
    errorMessage: string;
    chatJid?: string;
    createdAt?: string;
  }): void;
  clearRun(runId: string): void;
  getSnapshot(nowMs?: number): StatusTelemetrySnapshot;
}

export interface CreateStatusTelemetryParams {
  incidentWindowMs: number;
  maxIncidents: number;
}

export interface FormatStatusReportParams {
  assistantName: string;
  runtime: string;
  serviceStartedAt: string;
  incidentWindowLabel: string;
  stuckWarningSeconds: number;
  nowMs?: number;
  telegramEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappConnected: boolean;
  registeredGroupCount: number;
  mainGroupName?: string;
  tasks: {
    active: number;
    paused: number;
    completed: number;
  };
  activeChatRuns: Array<{
    requestId: string;
    chatJid: string;
    startedAt: number;
  }>;
  activeCoderRuns: Array<{
    requestId: string;
    mode: 'execute' | 'plan';
    chatJid: string;
    groupName: string;
    startedAt: number;
    parentRequestId?: string;
    backend?: 'pi';
    route?:
      | 'coder_execute'
      | 'coder_plan'
      | 'auto_execute'
      | 'subagent_execute'
      | 'subagent_plan';
    state?: 'starting' | 'running' | 'completed' | 'failed' | 'aborted';
    worktreePath?: string;
  }>;
  telemetry: StatusTelemetrySnapshot;
  chatRuntimePreferenceLines?: string[];
  chatUsage?: {
    runs: number;
    totalTokens: number;
  };
  chatActiveRun?: {
    requestId: string;
    startedAt: number;
  } | null;
}

const TIMEOUT_PATTERN = /timed out|timeout|etimedout|stale_no_progress|retry exhausted/i;
const USER_ABORT_PATTERN = /aborted by user/i;

export function isUserAbortedErrorMessage(message?: string): boolean {
  if (typeof message !== 'string') return false;
  return USER_ABORT_PATTERN.test(message);
}

function toMs(iso?: string): number {
  if (!iso) return Date.now();
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function summarizeIncidentCounts(incidents: StatusIncident[]): string {
  let stale = 0;
  let timeout = 0;
  let failed = 0;
  for (const incident of incidents) {
    if (incident.kind === 'stale') stale += 1;
    else if (incident.kind === 'timeout') timeout += 1;
    else failed += 1;
  }
  return `timeout=${timeout} failed=${failed} stale=${stale}`;
}

function formatDurationShort(ms: number): string {
  const safe = Math.max(0, Math.floor(ms / 1000));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function formatAgeSeconds(nowMs: number, startedAt: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - startedAt) / 1000));
  return `${seconds}s`;
}

function classifyFailureKind(message: string): StatusIncidentKind {
  return TIMEOUT_PATTERN.test(message) ? 'timeout' : 'failed';
}

function uniquePushIncidents(
  target: StatusIncident[],
  candidate: StatusIncident,
): void {
  const duplicate = target.some(
    (incident) =>
      incident.runId === candidate.runId &&
      incident.kind === candidate.kind &&
      incident.detail === candidate.detail &&
      Math.abs(incident.createdAtMs - candidate.createdAtMs) < 1000,
  );
  if (!duplicate) {
    target.push(candidate);
  }
}

export function createStatusTelemetry(
  params: CreateStatusTelemetryParams,
): StatusTelemetry {
  const progressByRunId = new Map<string, RunProgressSnapshot>();
  const incidents: StatusIncident[] = [];

  function prune(nowMs: number): void {
    const threshold = nowMs - params.incidentWindowMs;
    let writeIndex = 0;
    for (let i = 0; i < incidents.length; i += 1) {
      const incident = incidents[i];
      if (incident.createdAtMs >= threshold) {
        incidents[writeIndex] = incident;
        writeIndex += 1;
      }
    }
    incidents.length = writeIndex;

    if (incidents.length > params.maxIncidents) {
      incidents.sort((a, b) => b.createdAtMs - a.createdAtMs);
      incidents.length = params.maxIncidents;
    }
  }

  function addIncident(incident: StatusIncident): void {
    uniquePushIncidents(incidents, incident);
  }

  return {
    noteRunProgress(event) {
      const updatedAtMs = toMs(event.createdAt);
      progressByRunId.set(event.runId, {
        runId: event.runId,
        phase: event.phase,
        text: event.text,
        detail: event.detail,
        updatedAtMs,
        chatJid: event.chatJid,
      });
      if (event.phase === 'stale') {
        addIncident({
          kind: 'stale',
          runId: event.runId,
          chatJid: event.chatJid,
          detail: event.detail || event.text,
          createdAtMs: updatedAtMs,
        });
      }
    },
    noteRunFailed(event) {
      const detail = event.errorMessage || event.detail || 'Run failed';
      addIncident({
        kind: classifyFailureKind(detail),
        runId: event.runId,
        chatJid: event.chatJid,
        detail,
        createdAtMs: toMs(event.createdAt),
      });
      progressByRunId.delete(event.runId);
    },
    noteRuntimeError(event) {
      addIncident({
        kind: classifyFailureKind(event.errorMessage),
        runId: event.runId,
        chatJid: event.chatJid,
        detail: event.errorMessage,
        createdAtMs: toMs(event.createdAt),
      });
    },
    clearRun(runId) {
      progressByRunId.delete(runId);
    },
    getSnapshot(nowMs = Date.now()) {
      prune(nowMs);
      const sorted = [...incidents].sort((a, b) => b.createdAtMs - a.createdAtMs);
      return {
        incidents: sorted.slice(0, params.maxIncidents),
        progressByRunId: new Map(progressByRunId),
      };
    },
  };
}

function derivePulseSeverity(params: {
  incidents: StatusIncident[];
  stuckRuns: number;
}): 'OK' | 'WARN' | 'ALERT' {
  const hasAlertIncident = params.incidents.some(
    (incident) => incident.kind === 'timeout' || incident.kind === 'failed',
  );
  if (hasAlertIncident) return 'ALERT';
  const hasWarningIncident =
    params.incidents.some((incident) => incident.kind === 'stale') ||
    params.stuckRuns > 0;
  return hasWarningIncident ? 'WARN' : 'OK';
}

export function formatStatusReport(params: FormatStatusReportParams): string {
  const nowMs = params.nowMs || Date.now();
  const startedAtMs = Date.parse(params.serviceStartedAt);
  const uptimeMs = Number.isFinite(startedAtMs)
    ? Math.max(0, nowMs - startedAtMs)
    : 0;

  const incidents = params.telemetry.incidents;
  const runProgressByRunId = params.telemetry.progressByRunId;

  const subagentRuns = params.activeCoderRuns.filter((run) =>
    (run.route || '').startsWith('subagent_'),
  ).length;
  const coderRuns = params.activeCoderRuns.length - subagentRuns;

  const stuckRuns = params.activeCoderRuns.filter((run) => {
    const snapshot = runProgressByRunId.get(run.requestId);
    if (!snapshot) return false;
    return nowMs - snapshot.updatedAtMs > params.stuckWarningSeconds * 1000;
  }).length;

  const severity = derivePulseSeverity({ incidents, stuckRuns });

  const lines: string[] = [
    `${params.assistantName} pulse: ${severity}`,
    `- uptime: ${formatDurationShort(uptimeMs)}`,
    `- runtime: ${params.runtime}`,
    `- active_runs: agent=${params.activeChatRuns.length} coder=${coderRuns} subagent=${subagentRuns}`,
    `- channels: telegram=${params.telegramEnabled ? 'yes' : 'no'} whatsapp=${params.whatsappEnabled ? 'yes' : 'no'} connected=${params.whatsappConnected ? 'yes' : 'no'}`,
    `- groups: registered=${params.registeredGroupCount} main=${params.mainGroupName || 'none'}`,
    `- tasks: active=${params.tasks.active} paused=${params.tasks.paused} completed=${params.tasks.completed}`,
    `- health_${params.incidentWindowLabel}: incidents=${incidents.length} (${summarizeIncidentCounts(incidents)})`,
  ];

  if (stuckRuns > 0) {
    lines.push(
      `- warnings: stuck_runs=${stuckRuns} (no progress >${params.stuckWarningSeconds}s)`,
    );
  }

  lines.push('', 'Active coder/subagent runs:');
  if (params.activeCoderRuns.length === 0) {
    lines.push('- none');
  } else {
    for (const run of params.activeCoderRuns.sort(
      (a, b) => a.startedAt - b.startedAt,
    )) {
      const age = formatAgeSeconds(nowMs, run.startedAt);
      const phase = runProgressByRunId.get(run.requestId);
      const phaseText = phase
        ? `${phase.phase}${phase.detail ? `(${phase.detail})` : ''}`
        : 'n/a';
      lines.push(
        `- request=${run.requestId} mode=${run.mode} state=${run.state || 'running'} phase=${phaseText} age=${age} chat=${run.chatJid} group=${run.groupName}${run.parentRequestId ? ` parent=${run.parentRequestId}` : ''}`,
      );
    }
  }

  lines.push('', 'Active chat runs:');
  if (params.activeChatRuns.length === 0) {
    lines.push('- none');
  } else {
    for (const run of params.activeChatRuns.sort(
      (a, b) => a.startedAt - b.startedAt,
    )) {
      lines.push(
        `- request=${run.requestId} age=${formatAgeSeconds(nowMs, run.startedAt)} chat=${run.chatJid}`,
      );
    }
  }

  lines.push('', `Recent incidents (${params.incidentWindowLabel}):`);
  if (incidents.length === 0) {
    lines.push('- none');
  } else {
    for (const incident of incidents) {
      const age = formatDurationShort(nowMs - incident.createdAtMs);
      lines.push(
        `- ${age} ago kind=${incident.kind} run=${incident.runId}${incident.chatJid ? ` chat=${incident.chatJid}` : ''}${incident.detail ? ` detail=${incident.detail}` : ''}`,
      );
    }
  }

  if (params.chatRuntimePreferenceLines && params.chatRuntimePreferenceLines.length > 0) {
    lines.push('', 'Chat context:');
    lines.push(...params.chatRuntimePreferenceLines);
    if (params.chatUsage) {
      lines.push(
        `- usage_runs: ${params.chatUsage.runs}`,
        `- usage_total_tokens: ${params.chatUsage.totalTokens}`,
      );
    }
    if (params.chatActiveRun) {
      lines.push(
        `- chat_run_active: yes (${formatAgeSeconds(nowMs, params.chatActiveRun.startedAt)})`,
      );
    } else {
      lines.push('- chat_run_active: no');
    }
  }

  return lines.join('\n');
}
