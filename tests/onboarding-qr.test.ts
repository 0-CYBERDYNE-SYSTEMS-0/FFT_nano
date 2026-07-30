import assert from 'node:assert/strict';
import test from 'node:test';

import { buildOnboardingHandoffUrl } from '../scripts/print-onboarding-qr.mjs';
import { isOnboardingHandoff } from '../web/control-center/src/onboarding.tsx';

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
