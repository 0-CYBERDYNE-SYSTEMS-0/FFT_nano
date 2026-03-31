/**
 * Generalized subagent type registry.
 *
 * Each registered type defines a fixed configuration: tool set, workspace mode,
 * prompt template, timeout, result delivery, and blocking behavior. The agent
 * (or user) can only spawn types that exist in this registry.
 *
 * The existing /coder system (CodingOrchestrator) is NOT affected -- it has
 * its own routes and is untouched by this module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Known pi tool names that can be enabled per subagent type. */
export const PI_TOOLS = [
  'read',
  'bash',
  'edit',
  'write',
  'grep',
  'find',
  'ls',
] as const;

export type PiTool = (typeof PI_TOOLS)[number];

/** How the subagent's working directory is resolved. */
export type SubagentWorkspaceMode = 'worktree' | 'path' | 'none';

/** Where and how results are delivered. */
export type SubagentResultDelivery = 'chat' | 'file' | 'none';

/** Configuration for a single registered subagent type. */
export interface SubagentTypeConfig {
  /** Machine-readable type name used in /subagents spawn <type>. */
  readonly name: string;

  /** Human-readable label shown in /subagents types and status messages. */
  readonly label: string;

  /** One-line description of what this type does. */
  readonly description: string;

  /**
   * Tools available to the subagent.
   * A subset of PI_TOOLS. The orchestrator maps this to pi's --tools flag.
   */
  readonly tools: readonly PiTool[];

  /**
   * How the working directory is determined:
   * - worktree: ephemeral git worktree (like /coder execute)
   * - path: a specific directory resolved from the request
   * - none: use the default group workspace
   */
  readonly workspaceMode: SubagentWorkspaceMode;

  /**
   * Name of the prompt template file in config/subagent-prompts/.
   * Loaded at spawn time by loadSubagentPrompt().
   */
  readonly promptTemplate: string;

  /** Default timeout in milliseconds. */
  readonly timeoutMs: number;

  /**
   * How results are delivered:
   * - chat: post as a message in the originating chat
   * - file: write to a file path (specified in request)
   * - none: fire-and-forget, no result delivery
   */
  readonly resultDelivery: SubagentResultDelivery;

  /**
   * If true, the spawn call blocks until the subagent completes.
   * If false, the spawn returns immediately with a tracking ID and
   * the result is delivered asynchronously.
   */
  readonly blocking: boolean;

  /**
   * Whether the agent can request this type on its own initiative.
   * General-purpose types should be user-initiated only.
   * Specific types (eval, nightly-analyst, etc.) can be agent-initiated.
   */
  readonly agentCanSpawn: boolean;
}

/** Result of spawning a subagent. */
export interface SubagentSpawnResult {
  ok: boolean;
  requestId: string;
  result: string | null;
  error?: string;
  streamed: boolean;
  /** Only populated for blocking spawns. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

/** Request to spawn a subagent. */
export interface SubagentSpawnRequest {
  requestId: string;
  type: string;
  taskText: string;
  originChatJid: string;
  originGroupFolder: string;
  assistantName: string;
  sessionKey: string;
  group: import('./types.js').RegisteredGroup;
  /** For path workspace mode: the directory to use as cwd. */
  workspacePath?: string;
  /** For file result delivery: the file path to write results to. */
  resultFilePath?: string;
  /** Optional runtime preference overrides. */
  runtimePrefs?: {
    provider?: string;
    model?: string;
    thinkLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    reasoningLevel?: 'off' | 'on' | 'stream';
    verboseMode?: 'off' | 'new' | 'all' | 'verbose';
  };
  abortController?: AbortController;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const EVAL_TOOLS: readonly PiTool[] = ['read', 'grep', 'find', 'ls'];
const FULL_TOOLS: readonly PiTool[] = [...PI_TOOLS];
const DATA_TOOLS: readonly PiTool[] = ['bash', 'write', 'read', 'grep', 'find', 'ls'];

/** All registered subagent types. */
export const SUBAGENT_TYPE_REGISTRY = new Map<string, SubagentTypeConfig>(
  [
    {
      name: 'eval',
      label: 'Skill Evaluator',
      description:
        'Test a skill against prompts and report structured results.',
      tools: EVAL_TOOLS,
      workspaceMode: 'path' as const,
      promptTemplate: 'eval',
      timeoutMs: 600_000, // 10 minutes
      resultDelivery: 'chat' as const,
      blocking: true,
      agentCanSpawn: true,
    },
    {
      name: 'nightly-analyst',
      label: 'Nightly Farm Analyst',
      description:
        'Process telemetry, update data, generate morning briefing.',
      tools: DATA_TOOLS,
      workspaceMode: 'none' as const,
      promptTemplate: 'nightly-analyst',
      timeoutMs: 1_800_000, // 30 minutes
      resultDelivery: 'file' as const,
      blocking: false,
      agentCanSpawn: true,
    },
    {
      name: 'photo-analyst',
      label: 'Photo Analyst',
      description:
        'Identify pests, diseases, and deficiencies from photos.',
      tools: ['read'] as const,
      workspaceMode: 'path' as const,
      promptTemplate: 'photo-analyst',
      timeoutMs: 300_000, // 5 minutes
      resultDelivery: 'chat' as const,
      blocking: true,
      agentCanSpawn: true,
    },
    {
      name: 'researcher',
      label: 'Research Agent',
      description: 'Search the web for information and summarize findings.',
      tools: ['read', 'grep', 'find', 'ls'] as const,
      workspaceMode: 'none' as const,
      promptTemplate: 'researcher',
      timeoutMs: 900_000, // 15 minutes
      resultDelivery: 'chat' as const,
      blocking: true,
      agentCanSpawn: true,
    },
    {
      name: 'compliance-auditor',
      label: 'Compliance Auditor',
      description: 'Review spray logs and check for compliance gaps.',
      tools: EVAL_TOOLS,
      workspaceMode: 'path' as const,
      promptTemplate: 'compliance-auditor',
      timeoutMs: 600_000, // 10 minutes
      resultDelivery: 'chat' as const,
      blocking: true,
      agentCanSpawn: true,
    },
    {
      name: 'data-sync',
      label: 'Data Sync',
      description: 'Fetch data from external APIs and write to farm-state.',
      tools: DATA_TOOLS,
      workspaceMode: 'none' as const,
      promptTemplate: 'data-sync',
      timeoutMs: 600_000, // 10 minutes
      resultDelivery: 'none' as const,
      blocking: false,
      agentCanSpawn: true,
    },
    {
      name: 'general',
      label: 'General Purpose',
      description:
        'General-purpose subagent for tasks that don\'t fit specific types.',
      tools: FULL_TOOLS,
      workspaceMode: 'none' as const,
      promptTemplate: 'general',
      timeoutMs: 1_800_000, // 30 minutes
      resultDelivery: 'chat' as const,
      blocking: true,
      agentCanSpawn: true,
    },
  ].map((cfg) => [cfg.name, cfg] as const),
) satisfies ReadonlyMap<string, SubagentTypeConfig>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a registered type by name. Returns null if not found. */
export function getSubagentType(name: string): SubagentTypeConfig | null {
  return SUBAGENT_TYPE_REGISTRY.get(name) ?? null;
}

/** Return all registered type names. */
export function listSubagentTypeNames(): string[] {
  return [...SUBAGENT_TYPE_REGISTRY.keys()];
}

/**
 * Convert a tools list to the pi --tools flag value.
 * Maps tool names to the comma-separated string pi expects.
 */
export function toolsToPiFlag(tools: readonly PiTool[]): string {
  return tools.join(',');
}

/**
 * Validate that all tools in the list are known pi tools.
 * Returns the list of invalid tools (empty if all valid).
 */
export function validateTools(tools: readonly string[]): string[] {
  const valid = new Set<string>(PI_TOOLS);
  return tools.filter((t) => !valid.has(t));
}
