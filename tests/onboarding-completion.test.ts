import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOnboardingCompletion,
  MAIN_ONBOARDING_COMPLETION_TOKEN,
} from '../src/onboarding-completion.ts';

test('extractOnboardingCompletion requires standalone final marker line', () => {
  const earlyMention = extractOnboardingCompletion(
    `I will emit ${MAIN_ONBOARDING_COMPLETION_TOKEN} later.\nWhat is your name?`,
  );
  assert.equal(earlyMention.completed, false);
});

test('extractOnboardingCompletion accepts final marker and strips it from output', () => {
  const done = extractOnboardingCompletion(
    `Great, onboarding is complete.\n${MAIN_ONBOARDING_COMPLETION_TOKEN}\n`,
  );
  assert.equal(done.completed, true);
  assert.equal(done.text, 'Great, onboarding is complete.');
});

test('extractOnboardingCompletion rejects marker when not final non-empty line', () => {
  const trailingText = extractOnboardingCompletion(
    `${MAIN_ONBOARDING_COMPLETION_TOKEN}\nOne more question`,
  );
  assert.equal(trailingText.completed, false);
});
