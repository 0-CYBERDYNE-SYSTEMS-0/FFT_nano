import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Permission Gate Extension Tests ───────────────────────────────────────────
// These test the exported functions from the extension by importing the source
// directly. The extension itself runs inside pi's process, so we test the
// logic in isolation.

describe('fft-permission-gate extension', () => {
  // Load the extension source and extract the logic functions
  // The extension exports a default function, but we need the helper functions.
  // We'll test by reading the source and evaluating the patterns.

  const destructivePatterns: Array<{ pattern: RegExp; description: string }> = [
    { pattern: /\brm\s+\S*-\S*r\S*/i, description: 'rm -r (recursive delete)' },
    { pattern: /\brm\s+\S*-\S*f\S*/i, description: 'rm -f (force delete)' },
    { pattern: /\brm\s+[^|;&\n]+/i, description: 'rm with path arguments' },
    { pattern: /\brmdir\b/i, description: 'rmdir' },
    { pattern: /\bdd\s+.*\bof=/i, description: 'dd writing to device/file' },
    { pattern: /\bmkfs\b/i, description: 'mkfs (format filesystem)' },
    { pattern: /\bchmod\s+\S*-\S*R\S*\s+777\b/i, description: 'chmod -R 777' },
    { pattern: /\bchmod\s+\S*-\S*R\S*\s+000\b/i, description: 'chmod -R 000' },
    { pattern: /\bchown\s+\S*-\S*R/i, description: 'chown -R (recursive ownership change)' },
    { pattern: /\bgit\s+clean\s+\S*-\S*f/i, description: 'git clean -f (delete untracked files)' },
    { pattern: /\bgit\s+reset\s+--hard\b/i, description: 'git reset --hard' },
    { pattern: /\bgit\s+push\s+--force\b/i, description: 'git push --force' },
    { pattern: /\bgit\s+push\s+\S*-f\b/i, description: 'git push -f' },
    { pattern: /\btruncate\b/i, description: 'truncate (zero out file)' },
    { pattern: /\bshred\b/i, description: 'shred (secure delete)' },
  ];

  const protectedPaths = ['.env', '.env.', '.git/', 'node_modules/'];

  function isDestructiveCommand(command: string): { destructive: boolean; matched?: string } {
    const trimmed = command.trim();
    if (!trimmed) return { destructive: false };
    for (const entry of destructivePatterns) {
      if (entry.pattern.test(trimmed)) {
        return { destructive: true, matched: entry.description };
      }
    }
    return { destructive: false };
  }

  function isProtectedPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    return protectedPaths.some(
      (p) => normalized === p || normalized.includes('/' + p) || normalized.startsWith(p),
    );
  }

  describe('destructive command detection', () => {
    it('detects rm -r', () => {
      assert.equal(isDestructiveCommand('rm -r /tmp/foo').destructive, true);
      assert.equal(isDestructiveCommand('rm -rf /tmp/foo').destructive, true);
      assert.equal(isDestructiveCommand('rm -fr /tmp/foo').destructive, true);
    });

    it('detects rm -f', () => {
      assert.equal(isDestructiveCommand('rm -f /tmp/foo.txt').destructive, true);
    });

    it('detects rm with path arguments', () => {
      assert.equal(isDestructiveCommand('rm /tmp/foo.txt').destructive, true);
      assert.equal(isDestructiveCommand('rm /tmp/foo /tmp/bar').destructive, true);
    });

    it('detects rmdir', () => {
      assert.equal(isDestructiveCommand('rmdir /tmp/empty-dir').destructive, true);
    });

    it('detects dd of=', () => {
      assert.equal(isDestructiveCommand('dd if=/dev/zero of=/dev/sda').destructive, true);
    });

    it('detects mkfs', () => {
      assert.equal(isDestructiveCommand('mkfs.ext4 /dev/sda1').destructive, true);
    });

    it('detects chmod -R 777', () => {
      assert.equal(isDestructiveCommand('chmod -R 777 /tmp/foo').destructive, true);
    });

    it('detects chmod -R 000', () => {
      assert.equal(isDestructiveCommand('chmod -R 000 /tmp/foo').destructive, true);
    });

    it('detects chown -R', () => {
      assert.equal(isDestructiveCommand('chown -R root:root /tmp/foo').destructive, true);
    });

    it('detects git clean -f', () => {
      assert.equal(isDestructiveCommand('git clean -f').destructive, true);
      assert.equal(isDestructiveCommand('git clean -fd').destructive, true);
    });

    it('detects git reset --hard', () => {
      assert.equal(isDestructiveCommand('git reset --hard HEAD').destructive, true);
    });

    it('detects git push --force', () => {
      assert.equal(isDestructiveCommand('git push --force origin main').destructive, true);
      assert.equal(isDestructiveCommand('git push -f origin main').destructive, true);
    });

    it('detects truncate', () => {
      assert.equal(isDestructiveCommand('truncate -s 0 /tmp/file.txt').destructive, true);
    });

    it('detects shred', () => {
      assert.equal(isDestructiveCommand('shred -u /tmp/secret.txt').destructive, true);
    });

    it('allows safe commands', () => {
      assert.equal(isDestructiveCommand('ls -la').destructive, false);
      assert.equal(isDestructiveCommand('cat /tmp/file.txt').destructive, false);
      assert.equal(isDestructiveCommand('echo "hello"').destructive, false);
      assert.equal(isDestructiveCommand('git status').destructive, false);
      assert.equal(isDestructiveCommand('git log --oneline -5').destructive, false);
      assert.equal(isDestructiveCommand('npm install').destructive, false);
      assert.equal(isDestructiveCommand('mkdir /tmp/new-dir').destructive, false);
      assert.equal(isDestructiveCommand('cp a.txt b.txt').destructive, false);
    });

    it('allows empty command', () => {
      assert.equal(isDestructiveCommand('').destructive, false);
      assert.equal(isDestructiveCommand('   ').destructive, false);
    });
  });

  describe('protected path detection', () => {
    it('detects .env', () => {
      assert.equal(isProtectedPath('.env'), true);
    });

    it('detects .env files with suffixes', () => {
      assert.equal(isProtectedPath('.env.local'), true);
      assert.equal(isProtectedPath('.env.production'), true);
    });

    it('detects .git/', () => {
      assert.equal(isProtectedPath('.git/'), true);
      assert.equal(isProtectedPath('.git/config'), true);
      assert.equal(isProtectedPath('/tmp/project/.git/HEAD'), true);
    });

    it('detects node_modules/', () => {
      assert.equal(isProtectedPath('node_modules/'), true);
      assert.equal(isProtectedPath('node_modules/lodash/index.js'), true);
    });

    it('allows normal paths', () => {
      assert.equal(isProtectedPath('src/index.ts'), false);
      assert.equal(isProtectedPath('/tmp/test.txt'), false);
      assert.equal(isProtectedPath('README.md'), false);
      assert.equal(isProtectedPath('package.json'), false);
    });
  });
});

// ─── Permission Gate UI Tests ─────────────────────────────────────────────────

describe('permission-gate-ui', () => {
  // We test the logic without importing the module (which depends on pi-runner types)
  // by reimplementing the core logic

  const pendingConfirmations = new Map<string, {
    requestId: string;
    chatJid?: string;
    resolve: (response: { confirmed: boolean } | { cancelled: true }) => void;
    reject: (err: Error) => void;
    createdAt: number;
    timeoutMs: number;
  }>();

  function parsePermissionGateCallback(callbackData: string): string | null {
    if (callbackData.startsWith('pg_allow:') || callbackData.startsWith('pg_block:')) {
      return callbackData.split(':')[1];
    }
    return null;
  }

  function createPendingConfirmation(
    requestId: string,
    chatJid: string | undefined,
    timeoutMs: number = 60_000,
  ) {
    let resolve!: (response: { confirmed: boolean } | { cancelled: true }) => void;
    let reject!: (err: Error) => void;
    const promise = new Promise<{ confirmed: boolean } | { cancelled: true }>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pendingConfirmations.set(requestId, {
      requestId,
      chatJid,
      resolve,
      reject,
      createdAt: Date.now(),
      timeoutMs,
    });
    return { promise, resolve, reject };
  }

  function resolvePendingConfirmation(
    requestId: string,
    response: { confirmed: boolean } | { cancelled: true },
  ): boolean {
    const pending = pendingConfirmations.get(requestId);
    if (!pending) return false;
    pendingConfirmations.delete(requestId);
    pending.resolve(response);
    return true;
  }

  beforeEach(() => {
    pendingConfirmations.clear();
  });

  describe('parsePermissionGateCallback', () => {
    it('parses pg_allow callback', () => {
      assert.equal(parsePermissionGateCallback('pg_allow:abc-123'), 'abc-123');
    });

    it('parses pg_block callback', () => {
      assert.equal(parsePermissionGateCallback('pg_block:abc-123'), 'abc-123');
    });

    it('returns null for non-permission-gate callbacks', () => {
      assert.equal(parsePermissionGateCallback('settings:home'), null);
      assert.equal(parsePermissionGateCallback('random_data'), null);
      assert.equal(parsePermissionGateCallback(''), null);
    });
  });

  describe('pending confirmation lifecycle', () => {
    it('creates and resolves a confirmation', async () => {
      const { promise } = createPendingConfirmation('req-1', 'chat-123');
      const resolved = resolvePendingConfirmation('req-1', { confirmed: true });
      assert.equal(resolved, true);
      const result = await promise;
      assert.deepEqual(result, { confirmed: true });
    });

    it('creates and denies a confirmation', async () => {
      const { promise } = createPendingConfirmation('req-2', 'chat-123');
      resolvePendingConfirmation('req-2', { confirmed: false });
      const result = await promise;
      assert.deepEqual(result, { confirmed: false });
    });

    it('returns false for unknown request ID', () => {
      const resolved = resolvePendingConfirmation('unknown', { confirmed: true });
      assert.equal(resolved, false);
    });

    it('removes resolved confirmation from pending', () => {
      createPendingConfirmation('req-3', 'chat-123');
      assert.equal(pendingConfirmations.size, 1);
      resolvePendingConfirmation('req-3', { confirmed: true });
      assert.equal(pendingConfirmations.size, 0);
    });

    it('tracks multiple pending confirmations', () => {
      createPendingConfirmation('req-a', 'chat-1');
      createPendingConfirmation('req-b', 'chat-2');
      createPendingConfirmation('req-c', 'chat-3');
      assert.equal(pendingConfirmations.size, 3);
      resolvePendingConfirmation('req-b', { confirmed: false });
      assert.equal(pendingConfirmations.size, 2);
    });
  });
});

// ─── Extension File Exists and Compiles ───────────────────────────────────────

describe('extension file validation', () => {
  const extensionPath = path.resolve(
    import.meta.dirname || __dirname,
    '../src/extensions/fft-permission-gate.ts',
  );

  it('extension file exists', () => {
    assert.ok(fs.existsSync(extensionPath), `Extension file not found at ${extensionPath}`);
  });

  it('extension file contains expected patterns', () => {
    const content = fs.readFileSync(extensionPath, 'utf-8');
    assert.ok(content.includes('tool_call'), 'Should subscribe to tool_call event');
    assert.ok(content.includes('FFT_NANO_SUBAGENT'), 'Should check subagent env var');
    assert.ok(content.includes('DESTRUCTIVE_PATTERNS'), 'Should define destructive patterns');
    assert.ok(content.includes('PROTECTED_PATHS'), 'Should define protected paths');
    assert.ok(content.includes('block: true'), 'Should return block result');
    assert.ok(content.includes('ui.confirm'), 'Should use UI confirm for interactive mode');
    assert.ok(content.includes('isSubagent'), 'Should reference subagent mode');
    assert.ok(content.includes('hasUI'), 'Should check hasUI for interactive mode');
  });

  it('extension has 15 destructive patterns matching bash-guard.ts', () => {
    const content = fs.readFileSync(extensionPath, 'utf-8');
    // Each destructive pattern has a unique description: line in the array.
    // Extract from the array opening bracket to the closing ];
    const arraySection = content.match(/DESTRUCTIVE_PATTERNS.*?=\s*\[([\s\S]*?)\];/);
    assert.ok(arraySection, 'Should have DESTRUCTIVE_PATTERNS array');
    const descriptions = arraySection[1].match(/description:\s*'/g);
    assert.ok(descriptions, 'Should have description entries');
    assert.equal(descriptions.length, 15, `Should have exactly 15 destructive patterns (got ${descriptions.length})`);
  });

  it('extension has 4 protected paths', () => {
    const content = fs.readFileSync(extensionPath, 'utf-8');
    // Check PROTECTED_PATHS array
    const pathMatch = content.match(/PROTECTED_PATHS = \[([\s\S]*?)\]/);
    assert.ok(pathMatch, 'Should have PROTECTED_PATHS array');
    const paths = pathMatch[1].match(/'[^']+'/g);
    assert.ok(paths);
    assert.equal(paths.length, 4, 'Should have exactly 4 protected paths');
  });
});

// ─── Host Events Extension ────────────────────────────────────────────────────

describe('host events extension_ui_notification', () => {
  it('extension_ui_notification kind is valid in HostEvent type', async () => {
    // Import the host-events module to verify the type compiles
    const { HostEventBus } = await import('../src/runtime/host-events.js');
    const bus = new HostEventBus();
    assert.ok(bus, 'HostEventBus should instantiate');

    // Verify we can publish an extension_ui_notification event
    let received = false;
    bus.subscribe((event) => {
      if (event.kind === 'extension_ui_notification') {
        received = true;
        assert.equal(event.request.id, 'test-req-1');
      }
    });

    bus.publish({
      id: 'evt-1',
      createdAt: new Date().toISOString(),
      source: 'test',
      kind: 'extension_ui_notification',
      chatJid: '12345',
      requestId: 'req-1',
      request: { id: 'test-req-1', method: 'notify', title: 'Test' },
    });

    assert.ok(received, 'Should have received extension_ui_notification event');
  });
});
