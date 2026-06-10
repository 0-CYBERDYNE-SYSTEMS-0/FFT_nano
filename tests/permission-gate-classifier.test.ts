import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyActionCategory } from '../src/permission-gate-policy.js';

test('VAL-WS1-001: classifier returns read for read-only tools', () => {
  // read tool
  assert.equal(classifyActionCategory('read', {}).category, 'read');
  assert.equal(classifyActionCategory('read', { path: '/tmp/x' }).category, 'read');
  assert.equal(classifyActionCategory('read', { path: '/abs/file', pattern: '*.ts' }).category, 'read');

  // grep tool
  assert.equal(classifyActionCategory('grep', {}).category, 'read');
  assert.equal(classifyActionCategory('grep', { pattern: 'TODO' }).category, 'read');
  assert.equal(classifyActionCategory('grep', { path: '/src', pattern: 'TODO' }).category, 'read');

  // ls tool
  assert.equal(classifyActionCategory('ls', {}).category, 'read');
  assert.equal(classifyActionCategory('ls', { path: '/tmp' }).category, 'read');
});

test('VAL-WS1-002: classifier returns local-mutate for write-like tools', () => {
  // edit tool
  assert.equal(
    classifyActionCategory('edit', { path: '/abs/file' }).category,
    'local-mutate',
  );
  assert.equal(
    classifyActionCategory('edit', { path: '/src/index.ts' }).category,
    'local-mutate',
  );
  assert.equal(
    classifyActionCategory('edit', { path: 'relative/path' }).category,
    'local-mutate',
  );

  // write tool
  assert.equal(
    classifyActionCategory('write', { path: '/abs/file' }).category,
    'local-mutate',
  );
  assert.equal(
    classifyActionCategory('write', { path: '/src/app.ts' }).category,
    'local-mutate',
  );
  assert.equal(
    classifyActionCategory('write', { path: 'relative/path' }).category,
    'local-mutate',
  );
});

test('VAL-WS1-003: classifier returns destroy for bash that isDestructiveCommand flags', () => {
  // Existing 15 patterns
  assert.equal(
    classifyActionCategory('bash', { command: 'rm -rf /tmp/x' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'rm -f /tmp/x' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'rmdir /tmp/dir' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'dd if=/dev/zero of=/dev/sda' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'mkfs.ext4 /dev/sdb' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'chmod -R 777 /home' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'chmod -R 000 /home' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'chown -R user:group /tmp' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'git clean -fd' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'git reset --hard' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'git push --force origin main' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'git push -f origin main' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'truncate -s 0 /tmp/file' }).category,
    'destroy',
  );
  assert.equal(
    classifyActionCategory('bash', { command: 'shred -u /tmp/file' }).category,
    'destroy',
  );

  // Non-destructive bash should NOT be destroy
  assert.notEqual(
    classifyActionCategory('bash', { command: 'ls -la /tmp' }).category,
    'destroy',
  );
  assert.notEqual(
    classifyActionCategory('bash', { command: 'npm run build' }).category,
    'destroy',
  );
});

test('VAL-WS1-004: classifier returns outbound for messaging and webhook IPC', () => {
  assert.equal(
    classifyActionCategory('send_message', { text: 'hello' }).category,
    'outbound',
  );
  assert.equal(
    classifyActionCategory('send_message', { text: 'hello', chatId: '123' }).category,
    'outbound',
  );

  assert.equal(
    classifyActionCategory('deliver_file', { path: '/tmp/file.pdf' }).category,
    'outbound',
  );
  assert.equal(
    classifyActionCategory('deliver_file', { path: '/tmp/file.pdf', chatId: '123' }).category,
    'outbound',
  );

  assert.equal(
    classifyActionCategory('send_webhook', { url: 'https://example.com/hook' }).category,
    'outbound',
  );
  assert.equal(
    classifyActionCategory('send_webhook', { url: 'https://example.com/hook', data: {} }).category,
    'outbound',
  );
});

test('VAL-WS1-005: classifier returns schedule for scheduling IPC', () => {
  assert.equal(
    classifyActionCategory('schedule_task', { prompt: 'do something' }).category,
    'schedule',
  );
  assert.equal(
    classifyActionCategory('schedule_task', { prompt: 'remind me', schedule_type: 'cron', schedule_value: '0 * * * *' }).category,
    'schedule',
  );

  assert.equal(
    classifyActionCategory('cancel_task', { taskId: 'task-123' }).category,
    'schedule',
  );
  assert.equal(
    classifyActionCategory('cancel_task', { taskId: 'task-456' }).category,
    'schedule',
  );
});

test('VAL-WS1-006: classifier is deterministic and total (unknown defaults to local-mutate)', () => {
  const VALID_CATEGORIES = ['read', 'local-mutate', 'outbound', 'schedule', 'destroy'] as const;

  // Test determinism: same input returns same category
  const variants = [
    { toolName: 'read' as const, input: {} },
    { toolName: 'read' as const, input: { path: '/tmp/x' } },
    { toolName: 'edit' as const, input: { path: '/abs/file' } },
    { toolName: 'bash' as const, input: { command: 'rm -rf /tmp' } },
    { toolName: 'send_message' as const, input: { text: 'hi' } },
    { toolName: 'schedule_task' as const, input: { prompt: 'do it' } },
    { toolName: 'cancel_task' as const, input: { taskId: 'x' } },
  ];

  for (const { toolName, input } of variants) {
    const r1 = classifyActionCategory(toolName, input);
    const r2 = classifyActionCategory(toolName, input);
    assert.equal(r1.category, r2.category, `Non-deterministic for ${toolName}`);
    assert.ok(VALID_CATEGORIES.includes(r1.category as typeof VALID_CATEGORIES[number]), `Invalid category ${r1.category} for ${toolName}`);
  }

  // Unknown toolName defaults to local-mutate
  assert.equal(classifyActionCategory('unknown_tool', {}).category, 'local-mutate');
  assert.equal(classifyActionCategory('foobar', { some: 'input' }).category, 'local-mutate');
  assert.equal(classifyActionCategory('', {}).category, 'local-mutate');
  assert.equal(classifyActionCategory('totally_fake', { path: '/abs' }).category, 'local-mutate');

  // Unknown also deterministic
  const r1 = classifyActionCategory('unknown_tool', {});
  const r2 = classifyActionCategory('unknown_tool', {});
  assert.equal(r1.category, r2.category);
});
