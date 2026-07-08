import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeRemoteAgeDays,
  countCommitsBehind,
  decideDriftWitnessAlert,
  resolveRemoteCommit,
  runDriftWitnessAtBoot,
  type DriftWitnessBootDeps,
} from '../src/drift-witness-service.js';
import { GIT_INFO } from '../src/state-persistence.js';

// ---------------------------------------------------------------------------
// SPEC-08: pure decision function. Two-condition gate (commitsBehind AND age).
// ---------------------------------------------------------------------------

test.describe('SPEC-08 drift-witness: decideDriftWitnessAlert', () => {
  test('1 commit behind, 1 day old → no alert (below threshold)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 1,
      remoteAgeDays: 1,
      threshold: 4,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'below-threshold');
  });

  test('5 commits behind, 1 day old → no alert (remote too recent)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 5,
      remoteAgeDays: 1,
      threshold: 4,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'remote-too-recent');
  });

  test('5 commits behind, 0.5 days old → no alert (both conditions required)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 5,
      remoteAgeDays: 0.5,
      threshold: 4,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'remote-too-recent');
  });

  test('5 commits behind, 3 days old → ALERT (both conditions met)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 5,
      remoteAgeDays: 3,
      threshold: 4,
    });
    assert.equal(decision.alert, true);
    assert.match(decision.reason, /^behind-5-/);
    assert.match(decision.reason, /age-3\.0\d*d$/);
  });

  test('threshold=0 disables detection entirely (no alert)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 99,
      remoteAgeDays: 99,
      threshold: 0,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'threshold-disabled');
  });

  test('threshold=-1 (negative env var) is clamped to disabled', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 99,
      remoteAgeDays: 99,
      threshold: -1,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'threshold-disabled');
  });

  test('commitsBehind=null downgrades to insufficient-evidence', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: null,
      remoteAgeDays: 5,
      threshold: 4,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'insufficient-evidence');
  });

  test('remoteAgeDays=null downgrades to insufficient-evidence', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 8,
      remoteAgeDays: null,
      threshold: 4,
    });
    assert.equal(decision.alert, false);
    assert.equal(decision.reason, 'insufficient-evidence');
  });

  test('minRemoteAgeDays override applies (default 2 days)', () => {
    const decision = decideDriftWitnessAlert({
      commitsBehind: 5,
      remoteAgeDays: 1.5,
      threshold: 4,
      minRemoteAgeDays: 1,
    });
    assert.equal(decision.alert, true);
  });
});

// ---------------------------------------------------------------------------
// Helper functions: age math, remote resolution, commit counting
// ---------------------------------------------------------------------------

test.describe('SPEC-08 drift-witness: computeRemoteAgeDays', () => {
  test('5 days back from now → 5.0', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    const fiveDaysBack = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const days = computeRemoteAgeDays(fiveDaysBack, now);
    assert.equal(days, 5);
  });

  test('future-dated committedAt clamps to 0', () => {
    const now = new Date('2026-07-07T00:00:00Z');
    const future = new Date(now.getTime() + 60 * 60 * 1000);
    const days = computeRemoteAgeDays(future, now);
    assert.equal(days, 0);
  });
});

test.describe('SPEC-08 drift-witness: resolveRemoteCommit / countCommitsBehind', () => {
  test('resolveRemoteCommit returns null when git is not executable', () => {
    const res = resolveRemoteCommit('main', { gitBin: '/nonexistent/git-binary' });
    assert.equal(res, null);
  });

  test('countCommitsBehind returns null on git failure', () => {
    const n = countCommitsBehind('deadbeef', 'cafebabe', {
      gitBin: '/nonexistent/git-binary',
    });
    assert.equal(n, null);
  });
});

// ---------------------------------------------------------------------------
// Boot witness: integration of helpers + decision + outbox routing
// ---------------------------------------------------------------------------

test.describe('SPEC-08 drift-witness: runDriftWitnessAtBoot', () => {
  function makeBootDeps(overrides: Partial<DriftWitnessBootDeps> = {}): {
    deps: DriftWitnessBootDeps;
    warns: Array<{ payload: unknown; msg?: string }>;
    infos: Array<{ payload: unknown; msg?: string }>;
    delivers: Array<{ dedupeKey: string; destination: string; body: string }>;
  } {
    const warns: Array<{ payload: unknown; msg?: string }> = [];
    const infos: Array<{ payload: unknown; msg?: string }> = [];
    const delivers: Array<{
      dedupeKey: string;
      destination: string;
      body: string;
    }> = [];
    const deps: DriftWitnessBootDeps = {
      gitInfo: { branch: 'main', commit: 'aaaaaaa' },
      canonicalBranch: 'main',
      threshold: 4,
      outbox: {
        deliver: async (input) => {
          delivers.push({
            dedupeKey: input.dedupeKey,
            destination: input.destination,
            body: input.body,
          });
          return true;
        },
      },
      findMainChatJid: () => 'telegram:main',
      now: new Date('2026-07-07T00:00:00Z'),
      logger: {
        warn: (payload, msg) => warns.push({ payload, msg }),
        info: (payload, msg) => infos.push({ payload, msg }),
      },
      resolveRemote: () => null,
      ...overrides,
    };
    return { deps, warns, infos, delivers };
  }

  test('remote-unreachable short-circuits, no warn, no outbox row, info log present', async () => {
    const { deps, warns, infos, delivers } = makeBootDeps({
      resolveRemote: () => null,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, false);
    assert.equal(outcome.reason, 'remote-unreachable');
    assert.equal(outcome.evidence.commitsBehind, null);
    assert.equal(warns.length, 0);
    assert.equal(delivers.length, 0);
    assert.ok(
      infos.some((entry) =>
        String((entry.payload as { reason?: string } | undefined)?.reason ?? '').startsWith(
          'insufficient',
        ) || /CLEAN/.test(entry.msg ?? ''),
      ),
      'info log should mark witness CLEAN',
    );
  });

  test('CLEAN evidence logs info, no outbox row, no warn', async () => {
    const { deps, warns, infos, delivers } = makeBootDeps({
      gitInfo: { branch: 'main', commit: 'aaaaaaa' },
      resolveRemote: () => ({
        commit: 'bbbbbbb',
        committedAt: new Date('2026-07-07T00:00:00Z'),
      }),
      countCommitsBehind: () => 0,
      threshold: 4,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, false);
    assert.equal(warns.length, 0);
    assert.equal(delivers.length, 0);
    assert.ok(infos.some((entry) => /CLEAN/.test(entry.msg ?? '')));
  });

  test('Drift detected → WARN log + outbox row with stable dedupe key', async () => {
    const { deps, warns, infos, delivers } = makeBootDeps({
      gitInfo: { branch: 'main', commit: 'aaaaaaa' },
      resolveRemote: () => ({
        commit: 'cccccccc',
        committedAt: new Date(
          new Date('2026-07-07T00:00:00Z').getTime() - 5 * 24 * 60 * 60 * 1000,
        ),
      }),
      countCommitsBehind: () => 7,
      threshold: 4,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, true);
    assert.equal(outcomes(outcome), 1);
    assert.equal(warns.length, 1);
    assert.equal(delivers.length, 1);
    assert.equal(
      delivers[0]?.dedupeKey,
      'drift-witness:aaaaaaa:cccccccc',
      'dedupe key must be local:remote so a re-fire after partial deploy does not double-post',
    );
    assert.match(delivers[0]?.body || '', /behind main by 7 commits/);
    assert.match(delivers[0]?.body || '', /5\.0d old/);
    void infos; // silence unused; info logs come from clean path
  });

  test('Local checkout on a non-canonical branch surfaces that fact in the message', async () => {
    const { deps, delivers } = makeBootDeps({
      gitInfo: { branch: 'feature/some-work', commit: 'ddddddd' },
      resolveRemote: () => ({
        commit: 'ccccccc2',
        committedAt: new Date(
          new Date('2026-07-07T00:00:00Z').getTime() - 4 * 24 * 60 * 60 * 1000,
        ),
      }),
      countCommitsBehind: () => 12,
      threshold: 4,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, true);
    assert.match(delivers[0]?.body || '', /checkout is on feature\/some-work/);
  });

  test('No outbox configured → WARN still logs but delivery is silent', async () => {
    const { deps, warns, delivers } = makeBootDeps({
      gitInfo: { branch: 'main', commit: 'eeeeeee' },
      resolveRemote: () => ({
        commit: 'ffffffff',
        committedAt: new Date(
          new Date('2026-07-07T00:00:00Z').getTime() - 3 * 24 * 60 * 60 * 1000,
        ),
      }),
      countCommitsBehind: () => 6,
      outbox: null,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, true);
    assert.equal(warns.length, 1);
    assert.equal(delivers.length, 0);
  });

  test('findMainChatJid returns null → delivery is skipped, witness still fires', async () => {
    const { deps, warns, delivers } = makeBootDeps({
      gitInfo: { branch: 'main', commit: '1111111' },
      resolveRemote: () => ({
        commit: '2222222',
        committedAt: new Date(
          new Date('2026-07-07T00:00:00Z').getTime() - 4 * 24 * 60 * 60 * 1000,
        ),
      }),
      countCommitsBehind: () => 8,
      findMainChatJid: () => null,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, true);
    assert.match(outcome.reason, /no-main-chat/);
    assert.equal(warns.length, 1);
    assert.equal(delivers.length, 0);
  });

  test('No local commit (GIT_INFO empty) → silent CLEAN, no outbox, no warn', async () => {
    const { deps, warns, infos, delivers } = makeBootDeps({
      gitInfo: { branch: undefined, commit: undefined },
      resolveRemote: () => ({
        commit: '3333333',
        committedAt: new Date(
          new Date('2026-07-07T00:00:00Z').getTime() - 4 * 24 * 60 * 60 * 1000,
        ),
      }),
      countCommitsBehind: () => null,
    });
    const outcome = await runDriftWitnessAtBoot(deps);
    assert.equal(outcome.fired, false);
    assert.equal(outcome.reason, 'insufficient-evidence');
    assert.equal(warns.length, 0);
    assert.equal(delivers.length, 0);
    assert.ok(infos.some((entry) => /CLEAN/.test(entry.msg ?? '')));
  });
});

// ---------------------------------------------------------------------------
// Verify GIT_INFO is captured at module load (state-persistence contract).
// This is the data the boot witness consumes; if it disappears we lose the
// drift signal entirely.
// ---------------------------------------------------------------------------

test('SPEC-08: resolveGitInfo has been called once at module load (GIT_INFO exported)', () => {
  assert.ok(GIT_INFO, 'GIT_INFO must be exported from state-persistence');
  assert.ok(typeof GIT_INFO === 'object');
  if (GIT_INFO.branch !== undefined) {
    assert.ok(GIT_INFO.branch.length > 0);
  }
  if (GIT_INFO.commit !== undefined) {
    assert.ok(GIT_INFO.commit.length > 0);
  }
});

// Helper to keep TypeScript narrowing honest in a small helper with unused param.
function outcomes(outcome: { fired: boolean }): 1 | 0 {
  return outcome.fired ? 1 : 0;
}
