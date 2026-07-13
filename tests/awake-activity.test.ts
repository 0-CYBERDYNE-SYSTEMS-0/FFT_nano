import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAwakeActivitySection,
  type AwakeActivitySnapshot,
} from '../src/awake-activity.js';

function sampleSnapshot(
  overrides: Partial<AwakeActivitySnapshot> = {},
): AwakeActivitySnapshot {
  return {
    collectedAtMs: Date.parse('2026-07-12T12:00:00.000Z'),
    heartbeat: {
      enabled: true,
      every: '4h',
      loopStarted: true,
      lastSentAtMs: Date.parse('2026-07-12T08:00:00.000Z'),
      lastSentPreview: 'check irrigation',
      checklistEmpty: false,
    },
    cron: {
      active: 2,
      paused: 1,
      nextDueAt: '2026-07-12T13:00:00.000Z',
      overdueActive: 0,
    },
    curator: {
      enabled: true,
      minIdleHours: 6,
      lastInboundAtMs: Date.parse('2026-07-12T11:00:00.000Z'),
      idleForMs: 60 * 60 * 1000,
      idleEnough: false,
      lastReviewAt: null,
      learningPaused: false,
    },
    resume: {
      activeLongRuns: 0,
      recoverable: 1,
    },
    selfImprove: {
      lastEventAt: '2026-07-11T20:00:00.000Z',
      lastTrigger: 'interval',
      lastFired: false,
    },
    ...overrides,
  };
}

test('formatAwakeActivitySection explains heartbeat cron curator resume self-improve', () => {
  const text = formatAwakeActivitySection(sampleSnapshot());
  assert.match(text, /Why is the agent awake\?/);
  assert.match(text, /heartbeat: on every=4h loop=running last_alert=4h/);
  assert.match(text, /cron: active=2 paused=1 next=in 1h/);
  assert.match(text, /curator: on idle=1h \(need 6h\) ready=no/);
  assert.match(text, /resume: active_long_runs=0 recoverable=1/);
  assert.match(text, /self_improve: last=2026-07-11T20:00:00\.000Z trigger=interval fired=no/);
  assert.match(text, /summary: heartbeat-loop, cron\(2 active\), recoverable-resume/);
});

test('formatAwakeActivitySection summarizes idle when nothing is due', () => {
  const text = formatAwakeActivitySection(
    sampleSnapshot({
      heartbeat: {
        enabled: false,
        every: '4h',
        loopStarted: false,
        lastSentAtMs: null,
        lastSentPreview: null,
        checklistEmpty: true,
      },
      cron: {
        active: 0,
        paused: 0,
        nextDueAt: null,
        overdueActive: 0,
      },
      resume: { activeLongRuns: 0, recoverable: 0 },
      curator: {
        enabled: true,
        minIdleHours: 6,
        lastInboundAtMs: Date.now(),
        idleForMs: 0,
        idleEnough: false,
        lastReviewAt: null,
        learningPaused: false,
      },
    }),
  );
  assert.match(text, /summary: idle \(no background work due\)/);
});
