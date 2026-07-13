/**
 * Kernel surface contract — frozen host primitives.
 *
 * Growth rule: new agent capability belongs in skills (procedural knowledge)
 * or scheduled tasks (work items), not new host subsystems. Extending this
 * file is a deliberate kernel change and needs an explicit review.
 *
 * The host owns: prompt layers, run origins, IPC envelope kinds, workspace
 * contract files, and the directories that form the host↔agent ABI.
 * Everything else is product surface (skills, tasks, profiles, optional
 * integrations).
 */

import type { RunOrigin } from './types.js';

// ── Prompt layers ────────────────────────────────────────────────────────────

/** Ordered prompt layers built by system-prompt.ts. Order is ABI. */
export const KERNEL_PROMPT_LAYERS = [
  'stable',
  'session_bootstrap',
  'ephemeral',
] as const;

export type KernelPromptLayer = (typeof KERNEL_PROMPT_LAYERS)[number];

/** Prompt modes that change which context is assembled. */
export const KERNEL_PROMPT_MODES = ['full', 'minimal', 'maintenance'] as const;

export type KernelPromptMode = (typeof KERNEL_PROMPT_MODES)[number];

// ── Run origins ──────────────────────────────────────────────────────────────

/**
 * Host-derived run origins (see mintRunAuthority / deriveRunOrigin).
 * New origins are a kernel change — do not invent ad-hoc origin strings.
 */
export const KERNEL_RUN_ORIGINS = [
  'interactive-main',
  'subagent',
  'headless',
  'evaluator',
  'maintenance',
] as const satisfies readonly RunOrigin[];

export type KernelRunOrigin = (typeof KERNEL_RUN_ORIGINS)[number];

// ── IPC surface ──────────────────────────────────────────────────────────────

/**
 * Envelope kinds under data/ipc/<group>/. Host watches these directories and
 * processes JSON files. Adding a kind requires host watcher + boundary-ipc
 * support — not a skill.
 */
export const KERNEL_IPC_ENVELOPE_KINDS = [
  'message',
  'task',
  'action',
  'action_result',
] as const;

export type KernelIpcEnvelopeKind = (typeof KERNEL_IPC_ENVELOPE_KINDS)[number];

/**
 * Subdirectories of each group IPC root. deliver_files is a host-owned path
 * for file delivery requests (payload type is still farm_action).
 */
export const KERNEL_IPC_DIRS = [
  'messages',
  'tasks',
  'actions',
  'action_results',
  'deliver_files',
] as const;

export type KernelIpcDir = (typeof KERNEL_IPC_DIRS)[number];

/**
 * Top-level `type` values agents write into IPC JSON.
 * Schema details live in skills (e.g. fft-host-ipc); these names are kernel ABI.
 */
export const KERNEL_IPC_PAYLOAD_TYPES = [
  'message',
  'run_progress',
  'pause_task',
  'resume_task',
  'cancel_task',
  'refresh_groups',
  'register_group',
  'memory_action',
  'skill_action',
  'subagent_action',
  'farm_action',
  'schedule_task',
] as const;

export type KernelIpcPayloadType = (typeof KERNEL_IPC_PAYLOAD_TYPES)[number];

// ── Workspace contract files ─────────────────────────────────────────────────

/**
 * Canonical workspace files the host seeds and injects.
 * Product content belongs inside these files (or skills/tasks), not new
 * top-level contract filenames without a deliberate kernel revision.
 */
export const KERNEL_WORKSPACE_FILES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
] as const;

export type KernelWorkspaceFile = (typeof KERNEL_WORKSPACE_FILES)[number];

/** Required on every main workspace (BOOT/BOOTSTRAP optional). */
export const KERNEL_REQUIRED_WORKSPACE_FILES = [
  'NANO.md',
  'SOUL.md',
  'TODOS.md',
  'HEARTBEAT.md',
  'MEMORY.md',
] as const satisfies readonly KernelWorkspaceFile[];

/** Stable-layer file: identity only (must not become a compaction log). */
export const KERNEL_STABLE_CONTEXT_FILES = ['SOUL.md'] as const;

/** Per-turn (ephemeral) workspace files re-injected every run. */
export const KERNEL_PER_TURN_CONTEXT_FILES = [
  'TODOS.md',
  'HEARTBEAT.md',
] as const;

/** Session-bootstrap files (fresh/rebase session only). */
export const KERNEL_SESSION_BOOTSTRAP_FILES = [
  'NANO.md',
  'MEMORY.md',
  'BOOTSTRAP.md',
] as const;

// ── Growth policy ────────────────────────────────────────────────────────────

export const KERNEL_GROWTH_POLICY = {
  summary:
    'Extend the agent via skills and scheduled tasks; do not grow the host kernel without explicit review.',
  prefer: ['skills/runtime/*', 'scheduled tasks', 'workspace markdown content'],
  avoid: [
    'new prompt layers',
    'new run origins',
    'new IPC envelope kinds or top-level payload types',
    'new workspace contract filenames',
    'new host long-running subsystems for product features',
  ],
} as const;

export function isKernelRunOrigin(value: string): value is KernelRunOrigin {
  return (KERNEL_RUN_ORIGINS as readonly string[]).includes(value);
}

export function isKernelIpcPayloadType(
  value: string,
): value is KernelIpcPayloadType {
  return (KERNEL_IPC_PAYLOAD_TYPES as readonly string[]).includes(value);
}

export function isKernelWorkspaceFile(
  value: string,
): value is KernelWorkspaceFile {
  return (KERNEL_WORKSPACE_FILES as readonly string[]).includes(value);
}

export function isKernelPromptLayer(value: string): value is KernelPromptLayer {
  return (KERNEL_PROMPT_LAYERS as readonly string[]).includes(value);
}
