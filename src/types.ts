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
  timeout?: number; // Default: 300000 (5 minutes)
  env?: Record<string, string>;
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
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
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
  action: 'memory_search' | 'memory_get';
  params: {
    query?: string;
    path?: string;
    topK?: number;
    sources?: 'memory' | 'sessions' | 'all';
    groupFolder?: string;
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
  };
  error?: string;
  executedAt: string;
}
