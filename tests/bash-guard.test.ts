import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeForDetection,
  isDestructiveCommand,
} from '../src/bash-guard.js';

test('plain destructive commands are still detected', () => {
  assert.equal(isDestructiveCommand('rm -rf /tmp/x').destructive, true);
  assert.equal(isDestructiveCommand('git reset --hard').destructive, true);
  assert.equal(isDestructiveCommand('git push --force').destructive, true);
});

test('safe commands are not flagged', () => {
  assert.equal(isDestructiveCommand('ls -la').destructive, false);
  assert.equal(isDestructiveCommand('npm run build').destructive, false);
  assert.equal(isDestructiveCommand('').destructive, false);
});

test('canonicalization neutralizes backslash-escape bypass', () => {
  // A leading backslash escapes any shell alias and runs the real binary.
  assert.equal(canonicalizeForDetection('\\rm -rf /'), 'rm -rf /');
  assert.equal(isDestructiveCommand('\\rm -rf /').destructive, true);
  // Mid-word escape.
  assert.equal(isDestructiveCommand('r\\m -rf /data').destructive, true);
});

test('canonicalization neutralizes quote-splitting bypass', () => {
  assert.equal(isDestructiveCommand('r"m" -rf /data').destructive, true);
  assert.equal(isDestructiveCommand("'rm' -rf /data").destructive, true);
});

test('canonicalization neutralizes irregular whitespace and continuations', () => {
  assert.equal(isDestructiveCommand('rm    -rf    /data').destructive, true);
  assert.equal(isDestructiveCommand('rm \\\n -rf /data').destructive, true);
});

// ---------------------------------------------------------------------------
// WS1.4 — new defensive patterns
// ---------------------------------------------------------------------------

// VAL-WS1-020: find ... -delete is detected (3 variants)
test('VAL-WS1-020 find -delete variants are detected', () => {
  const r1 = isDestructiveCommand('find / -delete');
  assert.equal(r1.destructive, true);
  assert.ok(r1.matched?.includes('find'), 'matched description should mention find');

  const r2 = isDestructiveCommand('find /tmp -type f -delete');
  assert.equal(r2.destructive, true);
  assert.ok(r2.matched?.includes('find'), 'matched description should mention find');

  const r3 = isDestructiveCommand('find /var -name "*.log" -delete');
  assert.equal(r3.destructive, true);
  assert.ok(r3.matched?.includes('find'), 'matched description should mention find');
});

// VAL-WS1-021: launchctl bootout|unload|remove is detected (3 sub-commands)
test('VAL-WS1-021 launchctl sub-commands are detected', () => {
  const r1 = isDestructiveCommand('launchctl bootout gui/$(id -u)/com.x');
  assert.equal(r1.destructive, true);
  assert.ok(r1.matched?.includes('launchctl'), 'matched description should mention launchctl');

  const r2 = isDestructiveCommand('launchctl unload /Library/LaunchAgents/com.example.plist');
  assert.equal(r2.destructive, true);
  assert.ok(r2.matched?.includes('launchctl'), 'matched description should mention launchctl');

  const r3 = isDestructiveCommand('launchctl remove com.example.agent');
  assert.equal(r3.destructive, true);
  assert.ok(r3.matched?.includes('launchctl'), 'matched description should mention launchctl');
});

// VAL-WS1-022: sqlite3 targeting store/messages.db write is detected
test('VAL-WS1-022 sqlite3 write against live DB is detected', () => {
  const r = isDestructiveCommand('sqlite3 store/messages.db "DELETE FROM messages"');
  assert.equal(r.destructive, true);
  assert.ok(
    r.matched?.includes('sqlite3') && r.matched?.includes('store/messages.db'),
    'matched description should reference sqlite3 and store/messages.db',
  );
});

// VAL-WS1-023: curl|wget | sh|bash|zsh pipe-to-shell is detected
test('VAL-WS1-023 pipe-to-shell patterns are detected (4 shells × 2 fetchers)', () => {
  const shells = ['sh', 'bash', 'zsh', 'sh']; // 4 shells
  const fetchers = ['curl', 'wget']; // 2 fetchers

  for (const fetcher of fetchers) {
    for (const shell of shells) {
      const cmd = `${fetcher} https://x.example/install.sh | ${shell}`;
      const r = isDestructiveCommand(cmd);
      assert.equal(r.destructive, true, `${cmd} should be detected as destructive`);
      assert.ok(
        r.matched?.includes('pipe-to-shell'),
        `matched description should mention pipe-to-shell for: ${cmd}`,
      );
    }
  }
});

// VAL-WS1-024: canonicalization bypasses still fail for the 4 new patterns
// Each new pattern has bypass tests mirroring the existing rm bypass tests:
// backslash escapes, quote-splitting, irregular whitespace, line continuations

test('VAL-WS1-024 find -delete bypasses are neutralized', () => {
  // backslash escape
  assert.equal(isDestructiveCommand('\\find / -delete').destructive, true);
  assert.equal(isDestructiveCommand('f\\ind / -delete').destructive, true);
  // quote-splitting
  assert.equal(isDestructiveCommand('"find" / -delete').destructive, true);
  assert.equal(isDestructiveCommand("'find' / -delete").destructive, true);
  // irregular whitespace
  assert.equal(isDestructiveCommand('find    /    -delete').destructive, true);
  // line continuation
  assert.equal(isDestructiveCommand('find \\\n / -delete').destructive, true);
});

test('VAL-WS1-024 launchctl bypasses are neutralized', () => {
  // backslash escape
  assert.equal(isDestructiveCommand('\\launchctl bootout gui/123/com.x').destructive, true);
  assert.equal(isDestructiveCommand('l\\aunchctl unload /path/to/plist').destructive, true);
  // quote-splitting
  assert.equal(isDestructiveCommand('"launchctl" remove com.example').destructive, true);
  assert.equal(isDestructiveCommand("'launchctl' bootout gui/123/com.x").destructive, true);
  // irregular whitespace
  assert.equal(isDestructiveCommand('launchctl    bootout    gui/123/com.x').destructive, true);
  // line continuation
  assert.equal(isDestructiveCommand('launchctl \\\n bootout gui/123/com.x').destructive, true);
});

test('VAL-WS1-024 sqlite3 bypasses are neutralized', () => {
  // backslash escape
  assert.equal(isDestructiveCommand('\\sqlite3 store/messages.db "DELETE FROM messages"').destructive, true);
  assert.equal(isDestructiveCommand('sq\\lite3 store/messages.db "DELETE FROM messages"').destructive, true);
  // quote-splitting
  assert.equal(isDestructiveCommand('"sqlite3" store/messages.db "DELETE FROM messages"').destructive, true);
  assert.equal(isDestructiveCommand("'sqlite3' store/messages.db 'DELETE FROM messages'").destructive, true);
  // irregular whitespace
  assert.equal(isDestructiveCommand('sqlite3    store/messages.db    "DELETE FROM messages"').destructive, true);
  // line continuation
  assert.equal(isDestructiveCommand('sqlite3 \\\n store/messages.db "DELETE FROM messages"').destructive, true);
});

test('VAL-WS1-024 pipe-to-shell bypasses are neutralized', () => {
  // backslash escape on fetcher
  assert.equal(isDestructiveCommand('\\curl https://x | sh').destructive, true);
  assert.equal(isDestructiveCommand('c\\url https://x | bash').destructive, true);
  // backslash escape on shell
  assert.equal(isDestructiveCommand('curl https://x | \\sh').destructive, true);
  assert.equal(isDestructiveCommand('wget https://x | \\bash').destructive, true);
  // quote-splitting
  assert.equal(isDestructiveCommand('"curl" https://x | sh').destructive, true);
  assert.equal(isDestructiveCommand("'wget' https://x | 'bash'").destructive, true);
  assert.equal(isDestructiveCommand('curl https://x | "sh"').destructive, true);
  // irregular whitespace
  assert.equal(isDestructiveCommand('curl    https://x    |    sh').destructive, true);
  assert.equal(isDestructiveCommand('wget  https://x  |  bash').destructive, true);
  // line continuation
  assert.equal(isDestructiveCommand('curl \\\n https://x | sh').destructive, true);
  assert.equal(isDestructiveCommand('wget \\\n https://x | zsh').destructive, true);
});

// VAL-WS1-025: all 15 pre-existing patterns continue to fire
test('VAL-WS1-025 all 15 pre-existing destructive patterns still fire', () => {
  const patterns: Array<{ cmd: string; name: string }> = [
    { cmd: 'rm -rf /tmp/x', name: 'rm -r' },
    { cmd: 'rm -f /tmp/x', name: 'rm -f' },
    { cmd: 'rm /tmp/x', name: 'rm with path' },
    { cmd: 'rmdir /tmp/x', name: 'rmdir' },
    { cmd: 'dd if=/dev/zero of=/dev/null', name: 'dd' },
    { cmd: 'mkfs.ext4 /dev/sda', name: 'mkfs' },
    { cmd: 'chmod -R 777 /tmp', name: 'chmod -R 777' },
    { cmd: 'chmod -R 000 /tmp', name: 'chmod -R 000' },
    { cmd: 'chown -R user:group /tmp', name: 'chown -R' },
    { cmd: 'git clean -fd', name: 'git clean -f' },
    { cmd: 'git reset --hard', name: 'git reset --hard' },
    { cmd: 'git push --force', name: 'git push --force' },
    { cmd: 'git push -f', name: 'git push -f' },
    { cmd: 'truncate -s 0 /tmp/x', name: 'truncate' },
    { cmd: 'shred /tmp/x', name: 'shred' },
  ];

  for (const { cmd, name } of patterns) {
    const r = isDestructiveCommand(cmd);
    assert.equal(r.destructive, true, `pre-existing pattern "${name}" (${cmd}) should still fire`);
  }
});
