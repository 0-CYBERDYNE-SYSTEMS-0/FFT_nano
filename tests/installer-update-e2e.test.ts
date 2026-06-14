import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import test from 'node:test';

import { resolveRef, runUpdateCommand, type UpdateProgressEvent } from '../src/update-command.js';

// Keep the post-restart health probe fast — the e2e runs real `sleep`.
process.env.FFT_NANO_UPDATE_HEALTH_SETTLE_MS = '1000';
process.env.FFT_NANO_UPDATE_HEALTH_RECHECK_MS = '1000';

/**
 * installer-update-e2e.test.ts
 *
 * Integration test for the full installer + update loop.
 *
 * Exercises:
 * 1. The installer's resolve_ref() logic via the exported JS helper
 * 2. The update worker's progress stream via runUpdateCommand({ onProgress })
 * 3. Phase ordering and terminal event correctness
 *
 * Skipped on Windows where spawnSync contracts differ and git bash is not
 * guaranteed to be available.
 */

const isWindows = process.platform === 'win32';

// Tag-shaped string pattern: vMajor.Minor.Patch with optional suffix
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;

/**
 * Creates a fixture git repo that looks like an FFT_nano checkout.
 * Includes a custom install.sh with a resolve_ref override that returns
 * a fixed tag without network access.
 *
 * Sets up a local "origin" bare repo so git fetch origin works.
 *
 * NOTE: We pre-create the data/ directory so it exists before the
 * update command's lock mechanism creates it. Otherwise it shows as
 * an untracked change and triggers the stash path.
 */
function createFixtureRepo(fixturePath: string, fakeTag: string): void {
  fs.mkdirSync(fixturePath, { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixturePath, 'dist'), { recursive: true });
  // Add data/ to .gitignore so the lock file directory is ignored
  fs.writeFileSync(
    path.join(fixturePath, '.gitignore'),
    'data/\ndist/\n',
  );

  // package.json with a build script
  fs.writeFileSync(
    path.join(fixturePath, 'package.json'),
    JSON.stringify({
      name: 'fft_nano',
      version: '0.0.0',
      scripts: { build: 'echo "built" > dist/build marker' },
    }),
  );

  // Ensure dist directory exists for the build output
  fs.mkdirSync(path.join(fixturePath, 'dist'), { recursive: true });

  // package-lock.json (so update uses npm ci)
  fs.writeFileSync(
    path.join(fixturePath, 'package-lock.json'),
    JSON.stringify({
      name: 'fft_nano',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {},
    }),
  );

  // scripts/start.sh
  fs.writeFileSync(
    path.join(fixturePath, 'scripts', 'start.sh'),
    '#!/bin/bash\nexit 0\n',
  );
  fs.chmodSync(path.join(fixturePath, 'scripts', 'start.sh'), 0o755);

  // scripts/service.sh — always succeeds
  fs.writeFileSync(
    path.join(fixturePath, 'scripts', 'service.sh'),
    '#!/bin/bash\ncase "$1" in\n  restart) exit 0 ;;\n  status) echo "running" ; exit 0 ;;\n  pid) echo 4242 ; exit 0 ;;\n  *) exit 0 ;;\nesac\n',
  );
  fs.chmodSync(path.join(fixturePath, 'scripts', 'service.sh'), 0o755);

  // install.sh with a resolve_ref that returns the fixed fakeTag without network
  // This mimics the real install.sh resolve_ref but is deterministic for tests.
  // The real install.sh would call curl to GitHub; this stub intercepts that.
  const installSh = `#!/usr/bin/env bash
set -euo pipefail

REPO="\${REPO:-0-CYBERDYNE-SYSTEMS-0/FFT_nano}"
REF="\${REF:-latest}"

resolve_ref() {
  if [[ "$REF" != "latest" ]]; then
    printf '%s' "$REF"
    return
  fi
  # Return a deterministic fake tag without hitting the network
  printf '${fakeTag}'
}
`;
  fs.writeFileSync(path.join(fixturePath, 'install.sh'), installSh);
  fs.chmodSync(path.join(fixturePath, 'install.sh'), 0o755);

  // Initialize a real git repo with an initial commit
  // Use -b main to explicitly set the initial branch name regardless of the
  // system's init.defaultBranch setting (which may default to 'master' in CI).
  execSync('git init -b main', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git config user.email "test@fft"', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git config user.name "FFT Test"', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git add .', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: fixturePath, stdio: 'ignore' });

  // Create a local bare repo to act as "origin"
  const originPath = path.join(path.dirname(fixturePath), 'origin.git');
  fs.mkdirSync(originPath, { recursive: true });
  execSync('git init --bare', { cwd: originPath, stdio: 'ignore' });

  // Add origin remote and push
  execSync('git remote add origin file://' + originPath, { cwd: fixturePath, stdio: 'ignore' });
  execSync('git push origin main', { cwd: fixturePath, stdio: 'ignore' });

  // Create a commit that lives only on origin so the local checkout is one
  // commit behind. This exercises the real fetch/pull/install/build/restart
  // path instead of the up-to-date short-circuit.
  execSync('git commit --allow-empty -m "upstream update"', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git push origin main', { cwd: fixturePath, stdio: 'ignore' });
  execSync('git reset --hard HEAD~1', { cwd: fixturePath, stdio: 'ignore' });
}

test('installer-update-e2e: skipped on Windows', { skip: isWindows }, () => {
  // This is a placeholder; the actual skip happens at the describe level
  assert.ok(true);
});

test('installer-update-e2e: resolveRef returns a real tag-shaped string', { skip: isWindows }, (t, done) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-resolve-'));
  const fakeTag = 'v1.2.3';
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, fakeTag);

  const installScript = path.join(fixturePath, 'install.sh');

  resolveRef('0-CYBERDYNE-SYSTEMS-0/FFT_nano', 'latest', installScript)
    .then((tag) => {
      // Assert tag is tag-shaped (matches v\d+.\d+.\d+)
      assert.match(
        tag,
        TAG_PATTERN,
        `resolveRef should return a tag-shaped string, got: ${tag}`,
      );
      assert.equal(tag, fakeTag, `resolveRef should return the fake tag ${fakeTag}`);
      done();
    })
    .catch((err) => {
      done(err);
    });
});

test('installer-update-e2e: resolveRef passes through non-latest refs unchanged', { skip: isWindows }, (t, done) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-passthrough-'));
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, 'v9.9.9');

  const installScript = path.join(fixturePath, 'install.sh');

  resolveRef('0-CYBERDYNE-SYSTEMS-0/FFT_nano', 'v2.0.0-beta', installScript)
    .then((tag) => {
      assert.equal(tag, 'v2.0.0-beta', 'non-latest ref should pass through unchanged');
      done();
    })
    .catch((err) => {
      done(err);
    });
});

test('installer-update-e2e: runUpdateCommand progress stream contains phases in documented order', { skip: isWindows }, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-update-'));
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, 'v1.0.0');

  const events: UpdateProgressEvent[] = [];

  // Override existsSync to claim package-lock.json and service.sh exist
  const result = runUpdateCommand({
    cwd: fixturePath,
    onProgress: (event) => events.push(event),
    existsSync: (filePath) => {
      if (filePath === path.join(fixturePath, 'package-lock.json')) return true;
      if (filePath === path.join(fixturePath, 'scripts', 'service.sh')) return true;
      return false;
    },
  });

  assert.equal(result.ok, true, `update should succeed: ${result.text}`);

  // Phase sequence: starting, fetching, pulling, installing, building, restarting, verifying, complete
  const phases = events.map((e) => e.phase);

  // Each phase (except 'complete') emits 'started' then 'completed'
  const expectedPhases = [
    'starting', 'starting',
    'fetching', 'fetching',
    'pulling', 'pulling',
    'installing', 'installing',
    'building', 'building',
    'restarting', 'restarting',
    'verifying', 'verifying',
    'complete',
  ];

  assert.deepEqual(
    phases,
    expectedPhases,
    `Phase sequence should be ${JSON.stringify(expectedPhases)}, got ${JSON.stringify(phases)}`,
  );

  // Verify every event has an ISO timestamp
  for (const event of events) {
    assert.ok(event.at, 'every event must have an at timestamp');
    const parsed = new Date(event.at);
    assert.notEqual(parsed.toString(), 'Invalid Date', `at must be valid ISO string: ${event.at}`);
  }

  // Verify status transitions
  const startingEvents = events.filter((e) => e.phase === 'starting');
  assert.equal(startingEvents[0]?.status, 'started');
  assert.equal(startingEvents[1]?.status, 'completed');
  assert.equal(startingEvents[1]?.ok, true);

  // Verify complete is terminal
  const completeEvents = events.filter((e) => e.phase === 'complete');
  assert.equal(completeEvents.length, 1);
  assert.equal(completeEvents[0]?.status, 'completed');
  assert.equal(completeEvents[0]?.ok, true);

  // Verify durationMs is set on long-running phases (fetching, pulling, etc.)
  // The 'starting' phase completes immediately without measuring duration
  const phasesWithDuration = ['fetching', 'pulling', 'installing', 'building', 'restarting', 'verifying'];
  for (const phase of phasesWithDuration) {
    const completedEvents = events.filter(
      (e) => e.phase === phase && e.status === 'completed',
    );
    for (const event of completedEvents) {
      assert.ok(
        typeof event.durationMs === 'number' && event.durationMs >= 0,
        `completed phase ${phase} must have durationMs`,
      );
    }
  }
});

test('installer-update-e2e: progress stream ends with completed event matching ok=true on success', { skip: isWindows }, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-ok-'));
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, 'v1.0.0');

  const events: UpdateProgressEvent[] = [];

  const result = runUpdateCommand({
    cwd: fixturePath,
    onProgress: (event) => events.push(event),
    existsSync: (filePath) => {
      if (filePath === path.join(fixturePath, 'package-lock.json')) return true;
      if (filePath === path.join(fixturePath, 'scripts', 'service.sh')) return true;
      return false;
    },
  });

  assert.equal(result.ok, true, `update should succeed: ${result.text}`);

  // Terminal event must be 'complete' with ok: true
  const lastEvent = events[events.length - 1];
  assert.equal(lastEvent.phase, 'complete');
  assert.equal(lastEvent.status, 'completed');
  assert.equal(lastEvent.ok, true);

  // Result text must indicate success
  assert.match(result.text, /Update complete/);
});

test('installer-update-e2e: progress stream ends with failed event when git fetch fails', { skip: isWindows }, () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-fail-'));
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, 'v1.0.0');

  // Remove the origin remote so git fetch fails (simulating network/remote issues)
  execSync('git remote remove origin', { cwd: fixturePath, stdio: 'ignore' });

  const events: UpdateProgressEvent[] = [];

  const result = runUpdateCommand({
    cwd: fixturePath,
    onProgress: (event) => events.push(event),
    existsSync: (filePath) => {
      if (filePath === path.join(fixturePath, 'package-lock.json')) return true;
      if (filePath === path.join(fixturePath, 'scripts', 'service.sh')) return true;
      return false;
    },
  });

  assert.equal(result.ok, false, 'update should fail when fetch fails');

  // There should be a 'failed' event somewhere in the stream
  const failedEvents = events.filter((e) => e.status === 'failed');
  assert.ok(
    failedEvents.length > 0,
    'stream should contain at least one failed event',
  );

  // There should be no 'complete' event with ok: true
  const completeEvents = events.filter((e) => e.phase === 'complete');
  assert.equal(
    completeEvents.length,
    0,
    'no complete event should exist when update fails',
  );

  // Result text should indicate failure during fetch
  assert.match(result.text, /Update aborted during fetch/);
});

test('installer-update-e2e: full loop — resolve_ref + runUpdateCommand', { skip: isWindows }, (t, done) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-e2e-full-'));
  const fakeTag = 'v3.14.159';
  const fixturePath = path.join(fixtureRoot, 'repo');
  createFixtureRepo(fixturePath, fakeTag);

  const installScript = path.join(fixturePath, 'install.sh');

  // Step 1: call resolve_ref
  resolveRef('0-CYBERDYNE-SYSTEMS-0/FFT_nano', 'latest', installScript)
    .then((tag) => {
      assert.match(tag, TAG_PATTERN, `resolved tag should be tag-shaped: ${tag}`);

      // Step 2: run the update with progress capture
      const events: UpdateProgressEvent[] = [];

      const result = runUpdateCommand({
        cwd: fixturePath,
        onProgress: (event) => events.push(event),
        existsSync: (filePath) => {
          if (filePath === path.join(fixturePath, 'package-lock.json')) return true;
          if (filePath === path.join(fixturePath, 'scripts', 'service.sh')) return true;
          return false;
        },
      });

      // Step 3: assert the progress stream
      assert.equal(result.ok, true, `update should succeed: ${result.text}`);

      // Verify phases in documented order
      const phases = events.map((e) => e.phase);
      assert.ok(phases.includes('starting'), 'must have starting phase');
      assert.ok(phases.includes('fetching'), 'must have fetching phase');
      assert.ok(phases.includes('pulling'), 'must have pulling phase');
      assert.ok(phases.includes('installing'), 'must have installing phase');
      assert.ok(phases.includes('building'), 'must have building phase');
      assert.ok(phases.includes('restarting'), 'must have restarting phase');
      assert.ok(phases.includes('verifying'), 'must have verifying phase');
      assert.ok(phases.includes('complete'), 'must have complete phase');

      // Verify phase order
      const phaseOrder = ['starting', 'fetching', 'pulling', 'installing', 'building', 'restarting', 'verifying', 'complete'];
      const actualOrder = phaseOrder.filter((p) => phases.includes(p));
      for (let i = 0; i < phaseOrder.length; i++) {
        const expectedPhase = phaseOrder[i];
        const actualIndex = phases.indexOf(expectedPhase);
        const nextPhase = phaseOrder[i + 1];
        const nextIndex = nextPhase ? phases.indexOf(nextPhase) : Infinity;
        assert.ok(
          actualIndex < nextIndex,
          `${expectedPhase} (index ${actualIndex}) should come before ${nextPhase} (index ${nextIndex})`,
        );
      }

      // Verify terminal event
      const lastEvent = events[events.length - 1];
      assert.equal(lastEvent.phase, 'complete');
      assert.equal(lastEvent.status, 'completed');
      assert.equal(lastEvent.ok, true);

      done();
    })
    .catch((err) => {
      done(err);
    });
});
