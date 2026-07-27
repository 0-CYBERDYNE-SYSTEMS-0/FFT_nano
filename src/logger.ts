import pino from 'pino';

const acpStdioMode =
  process.env.FFT_NANO_ACP_ENABLED === '1' &&
  process.env.FFT_NANO_ACP_STDIO !== '0';

export const logger = acpStdioMode
  ? pino(
      { level: process.env.LOG_LEVEL || 'info' },
      pino.destination({ dest: 2, sync: false }),
    )
  : pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
