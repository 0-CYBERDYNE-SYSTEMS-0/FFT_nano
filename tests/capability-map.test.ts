import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCapabilityMap,
  formatCapabilitiesText,
} from '../src/capability-map.js';

test('buildCapabilityMap includes skills, commands, subagents, and coder fallback', () => {
  const capabilities = buildCapabilityMap({
    isMain: true,
    assistantName: 'FarmFriend',
    skillCatalog: [
      {
        name: 'weather-watch',
        description: 'Weather forecasting skill',
        allowedTools: ['read'],
        whenToUse: 'Use when checking forecast and freeze risk.',
        source: 'project',
      },
    ],
  });

  assert.ok(capabilities.some((entry) => entry.kind === 'skill' && entry.id === 'skill:weather-watch'));
  assert.ok(capabilities.some((entry) => entry.kind === 'command' && entry.id === 'command:/status'));
  assert.ok(capabilities.some((entry) => entry.kind === 'subagent' && entry.id === 'subagent:researcher'));
  assert.ok(capabilities.some((entry) => entry.kind === 'coder' && entry.id === 'coder:execute'));
});

test('formatCapabilitiesText groups already-available and build-on-demand capabilities', () => {
  const text = formatCapabilitiesText({
    isMain: true,
    assistantName: 'FarmFriend',
    capabilities: buildCapabilityMap({
      isMain: true,
      assistantName: 'FarmFriend',
      skillCatalog: [
        {
          name: 'weather-watch',
          description: 'Weather forecasting skill',
          allowedTools: ['read'],
          whenToUse: 'Use when checking forecast and freeze risk.',
          source: 'project',
        },
      ],
    }),
  });

  assert.match(text, /Already available now/i);
  assert.match(text, /Can build for you/i);
  assert.match(text, /\/capabilities/i);
  assert.match(text, /weather-watch/i);
  assert.match(text, /coder/i);
});
