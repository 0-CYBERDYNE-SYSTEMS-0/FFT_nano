import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideAuthorityAction,
  mayAnnounce,
  mayMutateLocal,
  resolveOperatorGrant,
} from '../src/authority-policy.js';
import { mintRunAuthority } from '../src/run-authority.js';

describe('authority policy table', () => {
  it('holds outbound for headless without grant and allows with grant', () => {
    const held = decideAuthorityAction({
      origin: 'headless',
      operatorGrant: false,
      category: 'outbound',
    });
    assert.equal(held.action, 'held');
    assert.equal(held.reasonCode, 'outbound-held-no-grant');

    const allowed = decideAuthorityAction({
      origin: 'headless',
      operatorGrant: true,
      category: 'outbound',
    });
    assert.equal(allowed.action, 'allow');
  });

  it('blocks destroy for headless/subagent/evaluator; confirms interactive-main', () => {
    for (const origin of ['headless', 'subagent', 'evaluator'] as const) {
      const d = decideAuthorityAction({
        origin,
        operatorGrant: origin === 'evaluator',
        category: 'destroy',
      });
      assert.equal(d.action, 'block', origin);
    }
    const confirm = decideAuthorityAction({
      origin: 'interactive-main',
      operatorGrant: true,
      category: 'destroy',
    });
    assert.equal(confirm.action, 'confirm');
  });

  it('blocks all categories for maintenance', () => {
    for (const category of [
      'read',
      'local-mutate',
      'outbound',
      'schedule',
      'destroy',
    ] as const) {
      const d = decideAuthorityAction({
        origin: 'maintenance',
        operatorGrant: false,
        category,
      });
      assert.equal(d.action, 'block', category);
    }
  });

  it('mayAnnounce / mayMutateLocal helpers match the table', () => {
    assert.equal(
      mayAnnounce({ origin: 'headless', operatorGrant: false }),
      false,
    );
    assert.equal(
      mayAnnounce({ origin: 'headless', operatorGrant: true }),
      true,
    );
    assert.equal(
      mayMutateLocal({ origin: 'headless', operatorGrant: false }),
      true,
    );
    assert.equal(
      mayMutateLocal({ origin: 'maintenance', operatorGrant: false }),
      false,
    );
  });

  it('resolveOperatorGrant uses host stamp for headless operator-created cron', () => {
    assert.equal(
      resolveOperatorGrant({ origin: 'headless', hostOperatorGrant: true }),
      true,
    );
    assert.equal(
      resolveOperatorGrant({ origin: 'headless', hostOperatorGrant: false }),
      false,
    );
    assert.equal(resolveOperatorGrant({ origin: 'interactive-main' }), true);
    assert.equal(resolveOperatorGrant({ origin: 'evaluator' }), true);
  });

  it('mintRunAuthority honors hostOperatorGrant for scheduled operator tasks', () => {
    const operatorCron = mintRunAuthority({
      requestId: 'cron-1',
      groupFolder: 'main',
      isMain: true,
      isScheduledTask: true,
      hostOperatorGrant: true,
    });
    assert.equal(operatorCron.origin, 'headless');
    assert.equal(operatorCron.operatorGrant, true);
    assert.equal(mayAnnounce(operatorCron), true);

    const agentCron = mintRunAuthority({
      requestId: 'cron-2',
      groupFolder: 'main',
      isMain: true,
      isScheduledTask: true,
      hostOperatorGrant: false,
    });
    assert.equal(agentCron.origin, 'headless');
    assert.equal(agentCron.operatorGrant, false);
    assert.equal(mayAnnounce(agentCron), false);
  });

  it('mintRunAuthority does not accept created_by string parameter', () => {
    const sig = mintRunAuthority.toString();
    assert.equal(sig.includes('created_by'), false);
  });
});
