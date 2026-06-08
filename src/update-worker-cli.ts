/**
 * update-worker-cli.ts
 *
 * In-process CLI entry point for `fft update`.
 * Calls runUpdateCommand({ cwd, onProgress }) and prints a live,
 * line-by-line progress stream to stdout without writing a report file.
 *
 * This is NOT the detached worker (src/update-worker.ts); that one is for
 * Telegram/Web/TUI surfaces that need a report file. This CLI path is
 * operator-owned and the chat IS the operator.
 */

import { runUpdateCommand } from './update-command.js';
import type { UpdateProgressEvent } from './update-command.js';

function formatTimestamp(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

interface PhaseState {
  startedAt: Date | null;
  label: string;
}

function runCliUpdate(cwd: string): void {
  const phaseStates = new Map<string, PhaseState>();
  const overallStart = Date.now();
  let failed = false;
  let failureMessage: string | undefined;
  let stashRef: string | undefined;

  const onProgress = (event: UpdateProgressEvent): void => {
    const ts = formatTimestamp(new Date(event.at));

    if (event.status === 'started') {
      phaseStates.set(event.phase, {
        startedAt: new Date(event.at),
        label: event.label,
      });
      process.stdout.write(`[${ts}]  ${event.phase}  ▸ ${event.label}\n`);
    } else if (event.status === 'completed') {
      const state = phaseStates.get(event.phase);
      if (event.phase === 'complete') {
        const totalMs = Date.now() - overallStart;
        process.stdout.write(
          `Update complete in ${formatDuration(totalMs)}.\n`,
        );
      } else if (event.phase === 'pulling' && event.ok === true) {
        const duration = event.durationMs ?? 0;
        process.stdout.write(
          `✓ ${event.label} (${formatDuration(duration)})\n`,
        );
      } else {
        const duration = event.durationMs ?? 0;
        process.stdout.write(
          `✓ ${event.label} (${formatDuration(duration)})\n`,
        );
      }
    } else if (event.status === 'failed') {
      failed = true;
      failureMessage = event.message;
      process.stdout.write(`✗ ${event.label} — ${event.message ?? 'failed'}\n`);
    }
  };

  const result = runUpdateCommand({ cwd, onProgress });

  // If the result text contains a stash ref hint, surface it for recovery
  if (!result.ok && result.text) {
    // Extract stash ref from the output text for recovery hint
    const stashMatch = result.text.match(/(stash@\{[0-9]+\})/);
    if (stashMatch) {
      stashRef = stashMatch[1];
      process.stdout.write(
        `\nRecovery hint: your changes are saved at ${stashRef}. Restore with: git stash apply ${stashRef}\n`,
      );
    }
  }

  if (failed || !result.ok) {
    process.stdout.write(`Update failed.\n`);
    process.exit(1);
  }

  process.exit(0);
}

// Allow this script to be run directly: node dist/update-worker-cli.js --cwd <path>
const args = process.argv.slice(2);
let cwd: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cwd' && i + 1 < args.length) {
    cwd = args[i + 1];
    break;
  }
}

if (!cwd) {
  process.stderr.write(
    'Usage: node dist/update-worker-cli.js --cwd <repo-root>\n',
  );
  process.exit(1);
}

runCliUpdate(cwd);
