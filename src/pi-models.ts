import type { PiModelEntry } from './app-state.js';

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, '');
}

export function parsePiModelListOutput(output: string): PiModelEntry[] {
  const cleaned = stripAnsi(output);
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !/^provider\s{2,}model\b/i.test(line))
    .map((line) => line.trim().split(/\s{2,}/))
    .filter((parts) => parts.length >= 2)
    .map((parts) => ({
      provider: (parts[0] || '').trim(),
      model: (parts[1] || '').trim(),
    }))
    .filter((entry) => entry.provider.length > 0 && entry.model.length > 0);
}

export function parsePiListModelsResult(result: {
  status: number | null;
  stdout?: string | null;
  stderr?: string | null;
}): PiModelEntry[] {
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  // Preferred path: normal CLI output on stdout.
  let entries = parsePiModelListOutput(stdout);
  if (entries.length > 0) return entries;

  // Some pi builds print the model table to stderr while exiting 0.
  if (result.status === 0) {
    entries = parsePiModelListOutput(stderr);
    if (entries.length > 0) return entries;
  }

  // Final fallback for mixed/noisy streams.
  return parsePiModelListOutput(`${stdout}\n${stderr}`);
}
