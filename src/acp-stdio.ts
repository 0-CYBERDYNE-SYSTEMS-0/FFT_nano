#!/usr/bin/env node

import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

process.env.FFT_NANO_ACP_ENABLED = '1';
process.env.FFT_NANO_ACP_STDIO = '1';
process.env.FFT_NANO_TUI_ENABLED = '0';
process.env.FFT_NANO_WEB_ENABLED = '0';
process.env.WHATSAPP_ENABLED = '0';
delete process.env.TELEGRAM_BOT_TOKEN;

const { handleStartupFailure, main } = await import('./wiring.js');

main().catch(handleStartupFailure);
