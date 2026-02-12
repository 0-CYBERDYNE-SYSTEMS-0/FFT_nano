import { execSync } from 'child_process';

import { logger } from './logger.js';

let restartInFlight: Promise<boolean> | null = null;
let lastRestartAtMs = 0;

function sh(cmd: string): void {
  execSync(cmd, { stdio: 'ignore' });
}

export function shouldSelfHealAppleContainer(error: string): boolean {
  const s = (error || '').toLowerCase();
  return (
    s.includes('request timed out') ||
    s.includes('timed out') ||
    s.includes('etimedout') ||
    s.includes('enetunreach') ||
    s.includes('eai_again') ||
    s.includes('network is unreachable') ||
    s.includes('could not connect') ||
    s.includes("couldn't connect") ||
    s.includes('socket hang up') ||
    s.includes('econnreset') ||
    s.includes('connection reset')
  );
}

export async function restartAppleContainerSystemSingleFlight(
  reason: string,
): Promise<boolean> {
  // Avoid flapping if multiple requests fail in a short window.
  const cooldownMs = 60_000;
  const now = Date.now();
  if (now - lastRestartAtMs < cooldownMs) {
    logger.warn({ reason }, 'Apple Container restart skipped (cooldown)');
    return false;
  }

  if (restartInFlight) return restartInFlight;

  restartInFlight = (async () => {
    try {
      logger.warn({ reason }, 'Self-heal: restarting Apple Container system');
      try {
        sh('container system stop');
      } catch {
        // system stop can fail if services are already stopped; ignore.
      }
      sh('container system start');
      lastRestartAtMs = Date.now();
      logger.info('Self-heal: Apple Container system restarted');
      return true;
    } catch (err) {
      logger.error({ err }, 'Self-heal: Apple Container restart failed');
      return false;
    } finally {
      restartInFlight = null;
    }
  })();

  return restartInFlight;
}

