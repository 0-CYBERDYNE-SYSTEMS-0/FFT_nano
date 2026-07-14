import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  KERNEL_GROWTH_POLICY,
  KERNEL_IPC_DIRS,
  KERNEL_IPC_ENVELOPE_KINDS,
  KERNEL_IPC_PAYLOAD_TYPES,
  KERNEL_PER_TURN_CONTEXT_FILES,
  KERNEL_PROMPT_LAYERS,
  KERNEL_PROMPT_MODES,
  KERNEL_REQUIRED_WORKSPACE_FILES,
  KERNEL_RUN_ORIGINS,
  KERNEL_SESSION_BOOTSTRAP_FILES,
  KERNEL_STABLE_CONTEXT_FILES,
  KERNEL_WORKSPACE_FILES,
  isKernelIpcPayloadType,
  isKernelPromptLayer,
  isKernelRunOrigin,
  isKernelWorkspaceFile,
} from '../src/kernel-surface.js';
import { WORKSPACE_TEMPLATE_FILENAMES } from '../src/workspace-bootstrap.js';

describe('kernel surface freeze', () => {
  it('defines the three prompt layers in order', () => {
    assert.deepEqual([...KERNEL_PROMPT_LAYERS], [
      'stable',
      'session_bootstrap',
      'ephemeral',
    ]);
  });

  it('defines the known prompt modes', () => {
    assert.deepEqual([...KERNEL_PROMPT_MODES], [
      'full',
      'minimal',
      'maintenance',
    ]);
  });

  it('defines the five run origins', () => {
    assert.deepEqual([...KERNEL_RUN_ORIGINS], [
      'interactive-main',
      'subagent',
      'headless',
      'evaluator',
      'maintenance',
    ]);
  });

  it('defines IPC envelope kinds and dirs', () => {
    assert.deepEqual([...KERNEL_IPC_ENVELOPE_KINDS], [
      'message',
      'task',
      'action',
      'action_result',
    ]);
    assert.ok(KERNEL_IPC_DIRS.includes('messages'));
    assert.ok(KERNEL_IPC_DIRS.includes('actions'));
    assert.ok(KERNEL_IPC_DIRS.includes('deliver_files'));
  });

  it('workspace template filenames match the kernel contract', () => {
    assert.deepEqual(
      [...WORKSPACE_TEMPLATE_FILENAMES].sort(),
      [...KERNEL_WORKSPACE_FILES].sort(),
    );
    for (const name of KERNEL_REQUIRED_WORKSPACE_FILES) {
      assert.ok(
        (KERNEL_WORKSPACE_FILES as readonly string[]).includes(name),
        `required ${name} must be a kernel workspace file`,
      );
    }
  });

  it('stable / per-turn / session-bootstrap file sets are disjoint where required', () => {
    assert.deepEqual([...KERNEL_STABLE_CONTEXT_FILES], ['SOUL.md']);
    assert.ok(KERNEL_PER_TURN_CONTEXT_FILES.includes('TODOS.md'));
    assert.ok(KERNEL_PER_TURN_CONTEXT_FILES.includes('HEARTBEAT.md'));
    assert.ok(KERNEL_SESSION_BOOTSTRAP_FILES.includes('NANO.md'));
    assert.ok(KERNEL_SESSION_BOOTSTRAP_FILES.includes('MEMORY.md'));

    for (const f of KERNEL_STABLE_CONTEXT_FILES) {
      assert.equal(
        (KERNEL_PER_TURN_CONTEXT_FILES as readonly string[]).includes(f),
        false,
      );
      assert.equal(
        (KERNEL_SESSION_BOOTSTRAP_FILES as readonly string[]).includes(f),
        false,
      );
    }
  });

  it('type guards accept only kernel values', () => {
    assert.equal(isKernelRunOrigin('headless'), true);
    assert.equal(isKernelRunOrigin('background'), false);
    assert.equal(isKernelIpcPayloadType('memory_action'), true);
    assert.equal(isKernelIpcPayloadType('email_action'), false);
    assert.equal(isKernelWorkspaceFile('SOUL.md'), true);
    assert.equal(isKernelWorkspaceFile('AGENTS.md'), false);
    assert.equal(isKernelPromptLayer('stable'), true);
    assert.equal(isKernelPromptLayer('cache'), false);
  });

  it('growth policy points at skills and tasks', () => {
    assert.match(KERNEL_GROWTH_POLICY.summary, /skills and scheduled tasks/i);
    assert.ok(
      KERNEL_GROWTH_POLICY.prefer.some((p) => p.includes('skills/runtime')),
    );
    assert.ok(
      KERNEL_GROWTH_POLICY.avoid.some((p) => p.includes('prompt layers')),
    );
  });

  it('includes core IPC payload types used by the host ABI', () => {
    for (const type of [
      'message',
      'run_progress',
      'memory_action',
      'skill_action',
      'subagent_action',
      'farm_action',
      'schedule_task',
    ] as const) {
      assert.ok(
        KERNEL_IPC_PAYLOAD_TYPES.includes(type),
        `missing payload type ${type}`,
      );
    }
  });
});
