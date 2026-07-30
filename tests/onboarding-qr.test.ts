import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOnboardingHandoffUrl } from '../scripts/print-onboarding-qr.mjs';
import { buildOnboardingBootstrap } from '../src/onboarding-bootstrap.ts';
import { getOnboardingResumeStage, isOnboardingHandoff } from '../web/control-center/src/onboarding.tsx';

test('buildOnboardingHandoffUrl adds the wizard handoff without exposing credentials', () => {
  const result = buildOnboardingHandoffUrl('http://farm-nano.local:28990/setup?source=installer');

  assert.equal(
    result,
    'http://farm-nano.local:28990/setup?source=installer&onboarding=1',
  );
});

test('buildOnboardingHandoffUrl rejects URLs that contain credentials', () => {
  assert.throws(
    () => buildOnboardingHandoffUrl('http://operator:secret@farm-nano.local:28990/'),
    /must not contain credentials/,
  );
});

test('buildOnboardingHandoffUrl rejects non-web protocols', () => {
  assert.throws(
    () => buildOnboardingHandoffUrl('ftp://farm-nano.local/onboarding'),
    /http or https/,
  );
});

test('buildOnboardingHandoffUrl rejects credential-shaped query parameters', () => {
  assert.throws(
    () => buildOnboardingHandoffUrl('https://farm-nano.local/?token=secret'),
    /credential query parameters/,
  );
});

test('isOnboardingHandoff recognizes only the explicit QR handoff marker', () => {
  assert.equal(isOnboardingHandoff('?onboarding=1'), true);
  assert.equal(isOnboardingHandoff('?onboarding=0'), false);
  assert.equal(isOnboardingHandoff('?source=installer'), false);
});

test('bootstrap report stays local/read-only and requires approval for a discovered dashboard proposal', () => {
  const bootstrap = buildOnboardingBootstrap({
    env: {
      TELEGRAM_BOT_TOKEN: 'bot-token',
      TELEGRAM_ADMIN_SECRET: 'claim-secret',
      HA_TOKEN: 'ha-token',
      WHATSAPP_ENABLED: '1',
    },
    hostname: 'farm-nano',
    platform: 'linux',
    runtime: 'host',
    accessMode: 'lan',
    authRequired: true,
    whatsappAuthStatus: 'authenticated',
    farmProfile: { validation: { status: 'pass' } },
    cachedDiscovery: { entityCount: 4, domains: { sensor: 3, switch: 1 } },
  });

  assert.equal(bootstrap.device.runtime, 'host');
  assert.equal(bootstrap.web.phoneHandoff, 'protected_network');
  assert.equal(bootstrap.networkDiscovery.intrusiveScanRun, false);
  assert.equal(bootstrap.channels.telegram.claimReady, true);
  assert.equal(bootstrap.channels.whatsapp.linked, true);
  assert.equal(bootstrap.homeAssistant.proposal.state, 'ready_for_approval');
  assert.equal(bootstrap.homeAssistant.proposal.requiresExplicitApproval, true);
  assert.deepEqual(bootstrap.homeAssistant.proposal.suggestedViews, [
    { id: 'sensor', title: 'Sensors', entityCount: 3 },
    { id: 'switch', title: 'Controls', entityCount: 1 },
  ]);
});

test('bootstrap proposal is not ready from a token alone', () => {
  const bootstrap = buildOnboardingBootstrap({
    env: { HA_TOKEN: 'configured-but-unvalidated' },
    hostname: 'farm-nano',
    platform: 'linux',
    runtime: 'docker',
    accessMode: 'localhost',
    authRequired: false,
    cachedDiscovery: { entityCount: 12, domains: { sensor: 12 } },
  });

  assert.equal(bootstrap.homeAssistant.validation, 'missing');
  assert.equal(bootstrap.homeAssistant.proposal.state, 'needs_setup');
  assert.equal(bootstrap.web.phoneHandoff, 'local_only');
});

test('resume stage identifies the remaining safe onboarding step', () => {
  assert.equal(getOnboardingResumeStage({ apiKeyConfigured: false, telegramBotConfigured: false, configComplete: false }), 'Provider setup');
  assert.equal(getOnboardingResumeStage({ apiKeyConfigured: true, telegramBotConfigured: false, configComplete: false }), 'Channel setup');
  assert.equal(getOnboardingResumeStage({ apiKeyConfigured: true, telegramBotConfigured: true, configComplete: true }), 'Ready');
});
