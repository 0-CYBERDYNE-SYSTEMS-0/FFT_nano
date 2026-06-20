import assert from 'node:assert/strict';
import test from 'node:test';

import { state } from '../src/app-state.js';
import { sendMessage } from '../src/telegram-delivery.js';

test('local TUI sessions never fall through to external delivery', async () => {
  let whatsappSends = 0;
  const previousSock = state.sock;
  state.sock = {
    sendMessage: async () => {
      whatsappSends += 1;
    },
  };

  try {
    assert.equal(await sendMessage('tui:main', 'local response'), false);
    assert.equal(whatsappSends, 0);
  } finally {
    state.sock = previousSock;
  }
});
