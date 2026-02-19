import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { ASSISTANT_NAME, MAIN_WORKSPACE_DIR } from './config.js';
import {
  completeMainWorkspaceOnboarding,
  ensureMainWorkspaceBootstrap,
} from './workspace-bootstrap.js';

export interface OnboardCliOptions {
  workspace: string;
  operator?: string;
  assistantName?: string;
  nonInteractive: boolean;
  force: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run onboard -- [--workspace <dir>] [--operator <name>] [--assistant-name <name>] [--non-interactive] [--force]',
    '  ./scripts/onboard.sh [--workspace <dir>] [--operator <name>] [--assistant-name <name>] [--non-interactive] [--force]',
    '',
    'Flags:',
    '  --workspace <dir>       Main workspace path (default: FFT_NANO_MAIN_WORKSPACE_DIR or ~/nano)',
    '  --operator <name>       Primary operator name',
    '  --assistant-name <name> Assistant name for IDENTITY.md',
    '  --non-interactive       Require explicit operator and assistant-name values',
    '  --force                 Rewrite USER.md and IDENTITY.md even if they are already customized',
  ].join('\n');
}

function parseFlagValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return value;
}

export function parseOnboardArgs(argv: string[]): OnboardCliOptions {
  const options: OnboardCliOptions = {
    workspace: MAIN_WORKSPACE_DIR,
    nonInteractive: false,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--workspace') {
      options.workspace = path.resolve(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--operator') {
      options.operator = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--assistant-name') {
      options.assistantName = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--non-interactive') {
      options.nonInteractive = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '-h' || arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  options.workspace = path.resolve(options.workspace);
  return options;
}

function readLineIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseExistingOperator(userBody: string): string {
  const match = /Primary operator:\s*(.+)\.?/i.exec(userBody);
  return match?.[1]?.trim() || '';
}

function parseExistingAssistant(identityBody: string): string {
  const match = /Name:\s*(.+)/i.exec(identityBody);
  return match?.[1]?.trim() || '';
}

function renderUser(operator: string): string {
  return ['# USER', '', `Primary operator: ${operator}.`].join('\n');
}

function renderIdentity(assistantName: string): string {
  return [
    '# IDENTITY',
    '',
    `Name: ${assistantName}`,
    'Role: Main orchestrator + coding-capable assistant',
  ].join('\n');
}

function shouldRewriteFile(existingBody: string, force: boolean): boolean {
  if (force) return true;
  if (!existingBody.trim()) return true;
  return /\[set during onboarding\]/i.test(existingBody);
}

async function resolvePromptValues(params: {
  operatorSeed: string;
  assistantSeed: string;
  nonInteractive: boolean;
}): Promise<{ operator: string; assistantName: string }> {
  if (params.nonInteractive) {
    const operator = params.operatorSeed.trim();
    const assistantName = params.assistantSeed.trim();
    if (!operator) {
      throw new Error('Non-interactive onboarding requires --operator <name>');
    }
    if (!assistantName) {
      throw new Error('Non-interactive onboarding requires --assistant-name <name>');
    }
    return { operator, assistantName };
  }

  const rl = readline.createInterface({ input, output });
  try {
    const operatorAnswer = (
      await rl.question(`Primary operator name [${params.operatorSeed}]: `)
    ).trim();
    const assistantAnswer = (
      await rl.question(`Assistant name [${params.assistantSeed}]: `)
    ).trim();
    return {
      operator: (operatorAnswer || params.operatorSeed).trim(),
      assistantName: (assistantAnswer || params.assistantSeed).trim(),
    };
  } finally {
    rl.close();
  }
}

export async function runOnboarding(opts: OnboardCliOptions): Promise<{
  workspace: string;
  operator: string;
  assistantName: string;
}> {
  const workspace = path.resolve(opts.workspace);
  ensureMainWorkspaceBootstrap({ workspaceDir: workspace });

  const userPath = path.join(workspace, 'USER.md');
  const identityPath = path.join(workspace, 'IDENTITY.md');
  const userCurrent = readLineIfExists(userPath);
  const identityCurrent = readLineIfExists(identityPath);
  const explicitOperator = opts.operator?.trim() || '';
  const explicitAssistantName = opts.assistantName?.trim() || '';

  if (opts.nonInteractive) {
    if (!explicitOperator) {
      throw new Error('Non-interactive onboarding requires --operator <name>');
    }
    if (!explicitAssistantName) {
      throw new Error('Non-interactive onboarding requires --assistant-name <name>');
    }
  }

  const operatorSeed =
    explicitOperator || parseExistingOperator(userCurrent) || 'Primary Operator';
  const assistantSeed =
    explicitAssistantName || parseExistingAssistant(identityCurrent) || ASSISTANT_NAME;
  const resolved = await resolvePromptValues({
    operatorSeed,
    assistantSeed,
    nonInteractive: opts.nonInteractive,
  });

  if (!resolved.operator) {
    throw new Error('Operator name cannot be empty');
  }
  if (!resolved.assistantName) {
    throw new Error('Assistant name cannot be empty');
  }

  if (shouldRewriteFile(userCurrent, opts.force)) {
    fs.writeFileSync(userPath, `${renderUser(resolved.operator)}\n`, 'utf-8');
  }
  if (shouldRewriteFile(identityCurrent, opts.force)) {
    fs.writeFileSync(identityPath, `${renderIdentity(resolved.assistantName)}\n`, 'utf-8');
  }

  completeMainWorkspaceOnboarding({ workspaceDir: workspace, removeBootstrapFile: true });
  return { workspace, operator: resolved.operator, assistantName: resolved.assistantName };
}

async function main(): Promise<void> {
  try {
    const opts = parseOnboardArgs(process.argv.slice(2));
    const result = await runOnboarding(opts);
    console.log(
      [
        'Onboarding complete.',
        `Workspace: ${result.workspace}`,
        `Operator: ${result.operator}`,
        `Assistant: ${result.assistantName}`,
      ].join('\n'),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`onboard error: ${msg}`);
    console.error('');
    console.error(usage());
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
