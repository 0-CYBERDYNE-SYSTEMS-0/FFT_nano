export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath: string; // Path inside container (under /workspace/extra/)
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/fft_nano/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default baseline: 21600000 (6 hours)
  env?: Record<string, string>;
}

/**
 * RunAuthority — host-issued, immutable authority for a single agent run.
 *
 * Produced by mintRunAuthority() at spawn time; consumed by the permission gate,
 * the outbox hold logic, and JSONL audit stampers. The agent subprocess never
 * sees anything but FFT_NANO_RUN_AUTHORITY_ID (a random ID, not the authorityId).
 *
 * Invariants:
 *   I1: nothing in RunAuthority is writable by the agent subprocess.
 *   I4: operatorGrant is set exclusively by the host; the agent cannot influence it.
 */
export type RunOrigin =
  | 'interactive-main'
  | 'subagent'
  | 'headless'
  | 'evaluator'
  | 'maintenance';

// LISO.1: Session persistence mode for Pi runs
export type SessionPersistence = 'normal' | 'ephemeral';

// LISO.3: Turn-local learning evidence
export interface LearningTurnInput {
  turnId: string;
  groupFolder: string;
  latestUserText: string;
  assistantResponse: string;
  executionSummary: TurnExecutionSummary;
}

export interface TurnExecutionSummary {
  toolsRequested: number;
  toolsAllowed: number;
  toolsDenied: number;
  toolsFailed: number;
  toolsCancelled: number;
  selectedSkills: string[];
  completionStatus: 'success' | 'error' | 'cancelled' | 'timeout';
  hostDetectedCorrection: boolean;
  explicitMemoryMarkers: boolean;
  responseTruncated: boolean;
  deliveryFailed: boolean;
  permissionDenials: string[];
}

// LISO.4: Structured learning proposal schema
export type LearningProposal =
  | {
      kind: 'noop';
      reason: string;
    }
  | {
      kind: 'memory';
      intent: 'memory_append' | 'memory_promote';
      target: string;
      content: string;
      rationale: string;
      provenance: LearningProvenance;
    }
  | {
      kind: 'skill';
      intent: 'skill_create' | 'skill_patch';
      skillName: string;
      baseHash?: string;
      content: string;
      rationale: string;
      provenance: LearningProvenance;
    }
  | {
      kind: 'report';
      issue: string;
      recommendation: string;
      provenance: LearningProvenance;
    };

export interface LearningProvenance {
  reviewedTurnId: string;
  source: 'explicit-correction' | 'explicit-memory' | 'tool-failure';
  evidenceSummary: string;
}

// LISO.7: Maintenance lifecycle events
export type MaintenanceEventKind =
  | 'scheduled'
  | 'idle_grace_started'
  | 'idle_grace_cancelled'
  | 'maintenance_started'
  | 'maintenance_aborted'
  | 'maintenance_timeout'
  | 'proposal_parsed'
  | 'proposal_rejected'
  | 'proposal_applied'
  | 'maintenance_completed_noop';

export interface MaintenanceEventFields {
  runId: string;
  groupFolder: string;
  reviewedTurnId: string;
  kind: MaintenanceEventKind;
  sessionPersistence: 'ephemeral';
  promptMode: 'maintenance';
  status: string;
  abortReason?: string;
  proposalKind?: string;
  rejectionCode?: string;
  mutationId?: string;
  durationMs?: number;
}

// WS3: sender role for learning input provenance
export type SenderRole = 'operator' | 'member' | 'unknown';

export interface RunAuthority {
  authorityId: string; // crypto.randomUUID() — host-issued, unpredictable
  requestId: string; // existing per-run id; the authority wraps it
  origin: RunOrigin;
  groupFolder: string;
  startedAt: string; // ISO timestamp
  effectiveToolSet: readonly (
    | 'read'
    | 'bash'
    | 'edit'
    | 'write'
    | 'grep'
    | 'find'
    | 'ls'
    | 'agent'
  )[];
  // True for interactive-main runs and operator-created cron tasks; false for
  // agent-created schedule_task outputs and any agent-spawned outbound until
  // approved.
  operatorGrant: boolean;
  // Provenance (WS3)
  senderRole: SenderRole;
  // Global pause stamp captured at run start — a mid-run pause applies to the
  // next loop tick, not to the in-flight run.
  startedDuringPause: boolean;
  // /reflect dry-run: host hard-rejects skill and memory mutations for this run.
  // Read-only actions remain allowed.
  dryRun: boolean;
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: number;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  schedule_json?: string | null;
  session_target?: 'main' | 'isolated' | null;
  wake_mode?: 'next-heartbeat' | 'now' | null;
  delivery_mode?: 'none' | 'announce' | 'webhook' | null;
  delivery_channel?: 'chat' | null;
  delivery_to?: string | null;
  delivery_webhook_url?: string | null;
  timeout_seconds?: number | null;
  stagger_ms?: number | null;
  delete_after_run?: number | null;
  consecutive_errors?: number | null;
  subagent_type?: string | null;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed' | 'pending_approval';
  created_by?: 'operator' | 'agent';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

export interface FarmActionRequest {
  type: 'farm_action';
  action: string;
  params: Record<string, unknown>;
  requestId: string;
}

export interface FarmActionResult {
  requestId: string;
  status: 'success' | 'error';
  result?: unknown;
  error?: string;
  executedAt: string;
}

export interface CanvasLayout {
  columns: number;
  gap: number;
  rowHeight: number;
}

export type CanvasCardType =
  | 'line'
  | 'bar'
  | 'radial'
  | 'comparison'
  | 'kpi'
  | 'markdown'
  | 'iframe';

export interface CanvasCard {
  id: string;
  type: CanvasCardType;
  title?: string;
  entities?: string[];
  labels?: string[];
  span?: number;
  options?: Record<string, unknown>;
}

export interface CanvasSpec {
  version: '1.0';
  title: string;
  layout: CanvasLayout;
  cards: CanvasCard[];
}

export type DashboardPatchOp =
  | {
      op: 'add_view';
      view: Record<string, unknown>;
      index?: number;
    }
  | {
      op: 'update_view';
      viewPath: string;
      patch: Record<string, unknown>;
    }
  | {
      op: 'remove_view';
      viewPath: string;
    }
  | {
      op: 'add_card';
      viewPath: string;
      card: Record<string, unknown>;
      sectionIndex?: number;
      index?: number;
    }
  | {
      op: 'update_card';
      viewPath: string;
      cardId: string;
      patch: Record<string, unknown>;
    }
  | {
      op: 'remove_card';
      viewPath: string;
      cardId: string;
    }
  | {
      op: 'move_card';
      viewPath: string;
      cardId: string;
      toIndex: number;
      toSectionIndex?: number;
    }
  | {
      op: 'set_theme';
      theme: string;
    };

export type CanvasPatchOp =
  | {
      op: 'add_card';
      card: CanvasCard;
      index?: number;
    }
  | {
      op: 'update_card';
      cardId: string;
      patch: Partial<CanvasCard>;
    }
  | {
      op: 'remove_card';
      cardId: string;
    }
  | {
      op: 'move_card';
      cardId: string;
      toIndex: number;
    }
  | {
      op: 'set_layout';
      layout: Partial<CanvasLayout>;
    }
  | {
      op: 'set_title';
      title: string;
    };

export interface MemoryActionRequest {
  type: 'memory_action';
  action: 'memory_search' | 'memory_get' | 'memory_write';
  params: {
    query?: string;
    path?: string;
    topK?: number;
    sources?: 'memory' | 'sessions' | 'all';
    groupFolder?: string;
    intent?:
      | 'todo_set_objective'
      | 'todo_upsert_task'
      | 'todo_move_task'
      | 'todo_set_blocked'
      | 'todo_upsert_subagent'
      | 'todo_append_log'
      | 'memory_append'
      | 'memory_promote'
      | 'nano_patch'
      | 'soul_patch'
      | 'bootstrap_complete';
    targetSection?: string;
    payload?: Record<string, unknown>;
    recordedAt?: string;
    occurredAt?: string;
    reason?: string;
  };
  requestId: string;
}

export interface SkillActionRequest {
  type: 'skill_action';
  action:
    | 'skill_list'
    | 'skill_view'
    | 'skill_create'
    | 'skill_patch'
    | 'skill_write_file'
    | 'skill_archive'
    | 'skill_restore'
    | 'skill_rollback'
    | 'skill_pin'
    | 'skill_unpin'
    | 'skill_status';
  params: {
    name?: string;
    content?: string;
    filePath?: string;
    fileContent?: string;
    description?: string;
    groupFolder?: string;
    includeArchived?: boolean;
    reason?: string;
    version?: string;
  };
  requestId: string;
}

export interface MemorySearchHit {
  source: 'memory_doc' | 'session_transcript';
  score: number;
  groupFolder: string;
  title: string;
  snippet: string;
  path?: string;
  chatJid?: string;
  senderName?: string;
  timestamp?: string;
}

export interface MemoryActionResult {
  requestId: string;
  status: 'success' | 'error';
  result?: {
    hits?: MemorySearchHit[];
    document?: {
      groupFolder: string;
      path: string;
      content: string;
    };
    mutation?: {
      targetPath: string;
      operation: string;
      status: 'applied' | 'rejected';
      message: string;
      entryId?: string;
    };
  };
  error?: string;
  executedAt: string;
}

/**
 * File delivery request for sending files back to Telegram chat.
 * The agent writes this to <ipcDir>/deliver_files/*.json and the host
 * processes it and sends the file via Telegram.
 */
export type FileDeliveryKind = 'photo' | 'document' | 'video' | 'audio';

export interface FileDeliveryRequest {
  type: 'farm_action';
  action: 'deliver_file';
  requestId: string;
  params: {
    /** Path to file, absolute or relative to group workspace */
    filePath: string;
    /** Optional caption to include with the file */
    caption?: string;
    /** File kind hint (auto-detected from extension if omitted) */
    kind?: FileDeliveryKind;
    /** Override target chatJid (defaults to the group's registered chat) */
    chatJid?: string;
  };
}

export interface FileDeliveryResult {
  requestId: string;
  status: 'success' | 'error';
  result?: {
    kind: FileDeliveryKind;
    sizeBytes: number;
    deliveredTo: string;
  };
  error?: string;
  executedAt: string;
}

export type RunType =
  | 'chat'
  | 'coding'
  | 'scheduled'
  | 'cron'
  | 'heartbeat'
  | 'subagent'
  | 'agent-task';
