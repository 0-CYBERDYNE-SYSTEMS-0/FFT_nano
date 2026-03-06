import fs from 'fs';
import path from 'path';
import readline from 'node:readline/promises';
import { randomBytes } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';

import { ASSISTANT_NAME, MAIN_WORKSPACE_DIR } from './config.js';
import {
  getDefaultDotEnvPath,
  loadDotEnvMap,
  RUNTIME_PROVIDER_DEFINITIONS,
  upsertDotEnv,
} from './runtime-config.js';
import { ensureMainWorkspaceBootstrap } from './workspace-bootstrap.js';

export type OnboardFlow = 'quickstart' | 'advanced';
export type OnboardMode = 'local' | 'remote';
export type OnboardRuntime = 'auto' | 'docker' | 'host';
export type OnboardAuthChoice =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'zai'
  | 'minimax'
  | 'kimi-coding'
  | 'skip';
export type OnboardHatchChoice = 'tui' | 'web' | 'later';

export interface OnboardCliOptions {
  workspace: string;
  envPath?: string;
  operator?: string;
  assistantName?: string;
  nonInteractive: boolean;
  force: boolean;
  acceptRisk: boolean;
  flow?: OnboardFlow;
  mode?: OnboardMode;
  runtime?: OnboardRuntime;
  authChoice?: OnboardAuthChoice;
  model?: string;
  apiKey?: string;
  remoteUrl?: string;
  gatewayPort?: number;
  installDaemon?: boolean;
  skipChannels: boolean;
  skipSkills: boolean;
  skipHealth: boolean;
  skipUi: boolean;
  hatch?: OnboardHatchChoice;
  telegramToken?: string;
  whatsappEnabled?: boolean;
  json: boolean;
}

export interface OnboardSummary {
  workspace: string;
  operator: string;
  assistantName: string;
  flow: OnboardFlow;
  mode: OnboardMode;
  runtime: OnboardRuntime;
  authChoice: OnboardAuthChoice;
  hatch: OnboardHatchChoice;
  installDaemon: boolean;
  remoteUrl?: string;
  gatewayPort?: number;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<Exclude<OnboardAuthChoice, 'skip'>, string> =
  Object.fromEntries(
    RUNTIME_PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider.defaultModel]),
  ) as Record<Exclude<OnboardAuthChoice, 'skip'>, string>;

const ENV_KEY_BY_PROVIDER: Record<Exclude<OnboardAuthChoice, 'skip'>, string> =
  Object.fromEntries(
    RUNTIME_PROVIDER_DEFINITIONS.map((provider) => [provider.id, provider.apiKeyEnv]),
  ) as Record<Exclude<OnboardAuthChoice, 'skip'>, string>;

function hasMeaningfulEnvValue(raw: string | undefined): boolean {
  if (!raw) return false;
  const value = raw.trim();
  if (!value) return false;
  return value !== 'replace-me' && value !== '...';
}

function ensureAdminSecret(updates: Record<string, string | undefined>, envMap: Record<string, string>): void {
  const existing = envMap.TELEGRAM_ADMIN_SECRET;
  if (hasMeaningfulEnvValue(existing)) return;
  updates.TELEGRAM_ADMIN_SECRET = randomBytes(24).toString('hex');
}

function usage(): string {
  return [
    'Usage:',
    '  npm run onboard -- [options]',
    '  ./scripts/onboard.sh [options]',
    '',
    'Core options:',
    '  --workspace <dir>            Main workspace path (default: FFT_NANO_MAIN_WORKSPACE_DIR or ~/nano)',
    '  --env-path <file>            Env file to update (default: ./.env)',
    '  --operator <name>            Primary operator name',
    '  --assistant-name <name>      Assistant name for IDENTITY.md',
    '  --non-interactive            Run without prompts',
    '  --accept-risk                Required with --non-interactive',
    '  --force                      Rewrite USER/IDENTITY/SOUL even if customized',
    '',
    'Wizard options:',
    '  --flow <quickstart|advanced|manual>',
    '  --mode <local|remote>',
    '  --runtime <auto|docker|host>',
    '  --auth-choice <openai|anthropic|gemini|openrouter|zai|minimax|kimi-coding|skip>',
    '  --model <provider/model-or-id>',
    '  --api-key <token>            API key for selected auth choice',
    '  --remote-url <url>           Remote gateway URL (remote mode)',
    '  --gateway-port <port>        Local gateway/TUI port hint',
    '  --install-daemon             Install host service',
    '  --no-install-daemon          Skip host service install',
    '  --skip-channels              Skip channel config prompts',
    '  --skip-skills                Skip skills setup prompts',
    '  --skip-health                Skip health prompts',
    '  --skip-ui                    Skip hatch UI prompts',
    '  --hatch <tui|web|later>',
    '  --telegram-token <token>',
    '  --whatsapp-enabled <0|1|true|false>',
    '  --json                       Output JSON summary',
  ].join('\n');
}

function parseFlagValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${args[index]}`);
  }
  return value;
}

function parseBooleanValue(raw: string): boolean {
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${raw}`);
}

function parseFlow(raw: string | undefined): OnboardFlow | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'quickstart') return 'quickstart';
  if (value === 'advanced' || value === 'manual') return 'advanced';
  throw new Error(`Invalid --flow (use quickstart|advanced|manual): ${raw}`);
}

function parseMode(raw: string | undefined): OnboardMode | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'local' || value === 'remote') return value;
  throw new Error(`Invalid --mode (use local|remote): ${raw}`);
}

function parseRuntime(raw: string | undefined): OnboardRuntime | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'auto' || value === 'docker' || value === 'host') return value;
  throw new Error(`Invalid --runtime (use auto|docker|host): ${raw}`);
}

function parseAuthChoice(raw: string | undefined): OnboardAuthChoice | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (
    value === 'openai' ||
    value === 'anthropic' ||
    value === 'gemini' ||
    value === 'openrouter' ||
    value === 'zai' ||
    value === 'minimax' ||
    value === 'kimi-coding' ||
    value === 'skip'
  ) {
    return value;
  }
  throw new Error(
    `Invalid --auth-choice (use openai|anthropic|gemini|openrouter|zai|minimax|kimi-coding|skip): ${raw}`,
  );
}

function parseHatch(raw: string | undefined): OnboardHatchChoice | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'tui' || value === 'web' || value === 'later') return value;
  throw new Error(`Invalid --hatch (use tui|web|later): ${raw}`);
}

export function parseOnboardArgs(argv: string[]): OnboardCliOptions {
  const options: OnboardCliOptions = {
    workspace: MAIN_WORKSPACE_DIR,
    nonInteractive: false,
    force: false,
    acceptRisk: false,
    skipChannels: false,
    skipSkills: false,
    skipHealth: false,
    skipUi: false,
    json: false,
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
    if (arg === '--env-path') {
      options.envPath = path.resolve(parseFlagValue(argv, i).trim());
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
    if (arg === '--accept-risk') {
      options.acceptRisk = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--flow') {
      options.flow = parseFlow(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--mode') {
      options.mode = parseMode(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--runtime') {
      options.runtime = parseRuntime(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--auth-choice') {
      options.authChoice = parseAuthChoice(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--model') {
      options.model = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--api-key') {
      options.apiKey = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--remote-url') {
      options.remoteUrl = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--gateway-port') {
      const parsed = Number.parseInt(parseFlagValue(argv, i), 10);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
        throw new Error('Invalid --gateway-port (must be 1..65535)');
      }
      options.gatewayPort = parsed;
      i += 1;
      continue;
    }
    if (arg === '--install-daemon') {
      options.installDaemon = true;
      continue;
    }
    if (arg === '--no-install-daemon') {
      options.installDaemon = false;
      continue;
    }
    if (arg === '--skip-channels') {
      options.skipChannels = true;
      continue;
    }
    if (arg === '--skip-skills') {
      options.skipSkills = true;
      continue;
    }
    if (arg === '--skip-health') {
      options.skipHealth = true;
      continue;
    }
    if (arg === '--skip-ui') {
      options.skipUi = true;
      continue;
    }
    if (arg === '--hatch') {
      options.hatch = parseHatch(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--telegram-token') {
      options.telegramToken = parseFlagValue(argv, i).trim();
      i += 1;
      continue;
    }
    if (arg === '--whatsapp-enabled') {
      options.whatsappEnabled = parseBooleanValue(parseFlagValue(argv, i));
      i += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
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
  const match = /Primary operator:\s*(.+?)(?:\.)?\s*$/im.exec(userBody);
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

function renderSoul(operator: string, assistantName: string): string {
  return [
    '# SOUL',
    '',
    `You are ${assistantName}, a pragmatic and technically rigorous copilot for ${operator}.`,
    '',
    'Operating style:',
    '- Be concise, factual, and action-oriented.',
    '- Prefer safe, reversible changes with explicit checks.',
    '- Keep heartbeat and cron work deterministic and visible.',
    '- Escalate before destructive or irreversible actions.',
  ].join('\n');
}

function shouldRewriteFile(existingBody: string, force: boolean): boolean {
  if (force) return true;
  if (!existingBody.trim()) return true;
  return /\[set during onboarding\]/i.test(existingBody);
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}

function shouldRewriteIdentityFile(existingBody: string, force: boolean): boolean {
  if (shouldRewriteFile(existingBody, force)) return true;
  const normalized = normalizeBody(existingBody);
  if (normalized === normalizeBody(renderIdentity(ASSISTANT_NAME))) return true;
  if (normalized === normalizeBody(renderIdentity('FarmFriend'))) return true;
  if (normalized === normalizeBody(renderIdentity('OpenClaw'))) return true;
  return false;
}

function shouldRewriteSoulFile(existingBody: string, force: boolean): boolean {
  if (force) return true;
  if (!existingBody.trim()) return true;
  if (/You are (?:FarmFriend|OpenClaw|FFT_nano): concise, practical, and technically rigorous\./i.test(existingBody)) {
    return true;
  }
  return false;
}

async function askText(
  rl: readline.Interface,
  message: string,
  defaultValue: string,
): Promise<string> {
  const answer = (await rl.question(`${message} [${defaultValue}]: `)).trim();
  return answer || defaultValue;
}

async function askConfirm(
  rl: readline.Interface,
  message: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`${message} (${suffix}): `)).trim().toLowerCase();
  if (!answer) return defaultValue;
  if (['y', 'yes', '1', 'true'].includes(answer)) return true;
  if (['n', 'no', '0', 'false'].includes(answer)) return false;
  return defaultValue;
}

async function askSelect<T extends string>(
  rl: readline.Interface,
  message: string,
  options: T[],
  defaultValue: T,
): Promise<T> {
  const list = options.map((opt, index) => `${index + 1}) ${opt}`).join('\n');
  const prompt = `${message}\n${list}\nChoose [${defaultValue}]: `;
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  if (!answer) return defaultValue;
  const asNum = Number.parseInt(answer, 10);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= options.length) {
    return options[asNum - 1];
  }
  if (options.includes(answer as T)) return answer as T;
  return defaultValue;
}

async function resolveRiskAccepted(opts: OnboardCliOptions): Promise<boolean> {
  if (opts.acceptRisk) return true;
  if (opts.nonInteractive) {
    throw new Error(
      [
        'Non-interactive onboarding requires explicit risk acknowledgement.',
        'Re-run with: --non-interactive --accept-risk',
      ].join('\n'),
    );
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log(
      [
        'Security warning — please read.',
        'This runtime can execute tools and modify files.',
        'Use least privilege and keep secrets outside reachable paths.',
      ].join('\n'),
    );
    const accepted = await askConfirm(
      rl,
      'I understand this setup is powerful and potentially risky. Continue?',
      false,
    );
    return accepted;
  } finally {
    rl.close();
  }
}

async function resolveWizardSelections(
  opts: OnboardCliOptions,
  envMap: Record<string, string>,
): Promise<{
  flow: OnboardFlow;
  mode: OnboardMode;
  runtime: OnboardRuntime;
  authChoice: OnboardAuthChoice;
  model?: string;
  apiKey?: string;
  remoteUrl?: string;
  gatewayPort?: number;
  installDaemon: boolean;
  hatch: OnboardHatchChoice;
  telegramToken?: string;
  whatsappEnabled?: boolean;
}> {
  if (opts.nonInteractive) {
    const flow = opts.flow || 'quickstart';
    const mode = opts.mode || (flow === 'quickstart' ? 'local' : 'local');
    const runtime = opts.runtime || (mode === 'local' ? 'docker' : 'auto');
    const authChoice = opts.authChoice || 'skip';
    const installDaemon = opts.installDaemon ?? true;
    const hatch = opts.hatch || 'tui';
    if (mode === 'remote' && !opts.remoteUrl?.trim()) {
      throw new Error('Remote mode requires --remote-url in non-interactive onboarding');
    }
    return {
      flow,
      mode,
      runtime,
      authChoice,
      model: opts.model?.trim() || undefined,
      apiKey: opts.apiKey?.trim() || undefined,
      remoteUrl: opts.remoteUrl?.trim() || undefined,
      gatewayPort: opts.gatewayPort,
      installDaemon,
      hatch,
      telegramToken: opts.telegramToken?.trim() || undefined,
      whatsappEnabled: opts.whatsappEnabled,
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    const flow = opts.flow
      ? opts.flow
      : await askSelect(rl, 'Onboarding flow', ['quickstart', 'advanced'], 'quickstart');
    const mode = opts.mode
      ? opts.mode
      : flow === 'quickstart'
        ? 'local'
        : await askSelect(rl, 'Setup mode', ['local', 'remote'], 'local');

    if (mode === 'remote') {
      const remoteUrlSeed = opts.remoteUrl || envMap.FFT_NANO_REMOTE_URL || 'ws://127.0.0.1:18789';
      const remoteUrl = await askText(rl, 'Remote gateway URL', remoteUrlSeed);
      const installDaemon = opts.installDaemon ?? false;
      const hatch = opts.hatch || 'later';
      return {
        flow,
        mode,
        runtime: opts.runtime || 'auto',
        authChoice: 'skip',
        remoteUrl,
        installDaemon,
        hatch,
        gatewayPort: opts.gatewayPort,
      };
    }

    const runtime = opts.runtime
      ? opts.runtime
      : await askSelect(rl, 'Agent runtime', ['docker', 'host'], 'docker');

    const authChoice = opts.authChoice
      ? opts.authChoice
      : await askSelect(
          rl,
          'Auth provider',
          ['openai', 'anthropic', 'gemini', 'openrouter', 'zai', 'minimax', 'kimi-coding', 'skip'],
          'openai',
        );
    let model = opts.model?.trim();
    let apiKey = opts.apiKey?.trim();
    if (authChoice !== 'skip') {
      const modelSeed =
        model ||
        envMap.PI_MODEL ||
        DEFAULT_MODEL_BY_PROVIDER[authChoice as Exclude<OnboardAuthChoice, 'skip'>];
      model = await askText(rl, 'Default model', modelSeed);
      const keyEnv = ENV_KEY_BY_PROVIDER[authChoice as Exclude<OnboardAuthChoice, 'skip'>];
      const keySeed = apiKey || envMap[keyEnv] || '';
      apiKey = await askText(
        rl,
        `${keyEnv} (${keySeed ? 'press Enter to keep existing' : 'required'})`,
        keySeed,
      );
    }

    const gatewayPort = opts.gatewayPort
      ? opts.gatewayPort
      : Number.parseInt(
          await askText(
            rl,
            'Gateway/TUI port',
            envMap.FFT_NANO_TUI_PORT || process.env.FFT_NANO_TUI_PORT || '28989',
          ),
          10,
        ) || 28989;
    const installDaemon =
      typeof opts.installDaemon === 'boolean'
        ? opts.installDaemon
        : await askConfirm(rl, 'Install host service (recommended)', true);
    const hatch = opts.hatch
      ? opts.hatch
      : opts.skipUi
        ? 'later'
        : await askSelect(rl, 'How do you want to hatch your bot?', ['tui', 'web', 'later'], 'tui');

    let telegramToken = opts.telegramToken?.trim();
    let whatsappEnabled = opts.whatsappEnabled;
    if (!opts.skipChannels) {
      telegramToken = await askText(
        rl,
        'Telegram bot token (optional)',
        telegramToken || envMap.TELEGRAM_BOT_TOKEN || '',
      );
      const waSeed =
        typeof whatsappEnabled === 'boolean'
          ? String(whatsappEnabled ? 1 : 0)
          : envMap.WHATSAPP_ENABLED || '0';
      const waAnswer = await askText(rl, 'Enable WhatsApp (1/0)', waSeed);
      whatsappEnabled = parseBooleanValue(waAnswer);
    }

    return {
      flow,
      mode,
      runtime,
      authChoice,
      model,
      apiKey,
      remoteUrl: opts.remoteUrl?.trim() || undefined,
      gatewayPort,
      installDaemon,
      hatch,
      telegramToken: telegramToken || undefined,
      whatsappEnabled,
    };
  } finally {
    rl.close();
  }
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

function writeWizardMetadata(workspace: string, summary: OnboardSummary): void {
  const stateDir = path.join(workspace, '.fft_nano');
  fs.mkdirSync(stateDir, { recursive: true });
  const payload = {
    lastRunAt: new Date().toISOString(),
    lastRunVersion: process.env.npm_package_version || 'unknown',
    lastRunCommand: 'onboard',
    lastRunMode: summary.mode,
    lastRunRuntime: summary.runtime,
    flow: summary.flow,
    hatch: summary.hatch,
  };
  fs.writeFileSync(path.join(stateDir, 'wizard-state.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

export async function runOnboarding(opts: OnboardCliOptions): Promise<OnboardSummary> {
  const riskAccepted = await resolveRiskAccepted(opts);
  if (!riskAccepted) {
    throw new Error('Onboarding cancelled: risk acknowledgement not accepted');
  }

  const workspace = path.resolve(opts.workspace);
  ensureMainWorkspaceBootstrap({ workspaceDir: workspace });
  const envPath = opts.envPath || getDefaultDotEnvPath(process.cwd());
  const envMap = loadDotEnvMap(envPath);

  const userPath = path.join(workspace, 'USER.md');
  const identityPath = path.join(workspace, 'IDENTITY.md');
  const soulPath = path.join(workspace, 'SOUL.md');
  const userCurrent = readLineIfExists(userPath);
  const identityCurrent = readLineIfExists(identityPath);
  const soulCurrent = readLineIfExists(soulPath);
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

  if (!resolved.operator) throw new Error('Operator name cannot be empty');
  if (!resolved.assistantName) throw new Error('Assistant name cannot be empty');

  const wizard = await resolveWizardSelections(opts, envMap);

  if (wizard.mode === 'local') {
    const updates: Record<string, string | undefined> = {
      FFT_NANO_TUI_PORT:
        typeof wizard.gatewayPort === 'number' ? String(wizard.gatewayPort) : undefined,
      CONTAINER_RUNTIME: wizard.runtime,
    };
    if (wizard.runtime === 'host') {
      updates.FFT_NANO_ALLOW_HOST_RUNTIME = '1';
    }
    ensureAdminSecret(updates, envMap);

    if (wizard.authChoice !== 'skip') {
      const provider = wizard.authChoice;
      const keyEnv = ENV_KEY_BY_PROVIDER[provider];
      updates.PI_API = provider;
      updates.PI_MODEL = wizard.model?.trim() || DEFAULT_MODEL_BY_PROVIDER[provider];
      if (wizard.apiKey?.trim()) {
        updates[keyEnv] = wizard.apiKey.trim();
      } else if (opts.nonInteractive) {
        throw new Error(
          `Non-interactive onboarding requires --api-key for --auth-choice ${provider}`,
        );
      }
    }

    if (!opts.skipChannels) {
      if (wizard.telegramToken !== undefined) {
        updates.TELEGRAM_BOT_TOKEN = wizard.telegramToken;
      }
      if (typeof wizard.whatsappEnabled === 'boolean') {
        updates.WHATSAPP_ENABLED = wizard.whatsappEnabled ? '1' : '0';
      }
    }

    upsertDotEnv(envPath, updates);
  } else {
    const updates: Record<string, string | undefined> = {
      FFT_NANO_REMOTE_URL: wizard.remoteUrl?.trim() || '',
    };
    if (opts.runtime) {
      updates.CONTAINER_RUNTIME = wizard.runtime;
      if (wizard.runtime === 'host') {
        updates.FFT_NANO_ALLOW_HOST_RUNTIME = '1';
      }
    }
    upsertDotEnv(envPath, updates);
  }

  if (shouldRewriteFile(userCurrent, opts.force)) {
    fs.writeFileSync(userPath, `${renderUser(resolved.operator)}\n`, 'utf-8');
  }
  if (shouldRewriteIdentityFile(identityCurrent, opts.force)) {
    fs.writeFileSync(identityPath, `${renderIdentity(resolved.assistantName)}\n`, 'utf-8');
  }
  if (shouldRewriteSoulFile(soulCurrent, opts.force)) {
    fs.writeFileSync(soulPath, `${renderSoul(resolved.operator, resolved.assistantName)}\n`, 'utf-8');
  }

  const summary: OnboardSummary = {
    workspace,
    operator: resolved.operator,
    assistantName: resolved.assistantName,
    flow: wizard.flow,
    mode: wizard.mode,
    runtime: wizard.runtime,
    authChoice: wizard.authChoice,
    hatch: wizard.hatch,
    installDaemon: wizard.installDaemon,
    remoteUrl: wizard.remoteUrl,
    gatewayPort: wizard.gatewayPort,
  };
  writeWizardMetadata(workspace, summary);
  return summary;
}

async function main(): Promise<void> {
  try {
    const opts = parseOnboardArgs(process.argv.slice(2));
    const result = await runOnboarding(opts);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const hatchHint =
      result.hatch === 'web'
        ? 'Next hatch: run `fft web` (or `./scripts/web.sh`) to open FFT CONTROL CENTER.'
        : result.hatch === 'tui'
          ? 'Next hatch: run `fft tui` (or `./scripts/start.sh tui`) to attach terminal UI.'
          : 'Next hatch: run either `fft tui` or `fft web` when you are ready.';
    console.log(
      [
        'Onboarding complete.',
        `Workspace: ${result.workspace}`,
        `Operator: ${result.operator}`,
        `Assistant: ${result.assistantName}`,
        `Flow: ${result.flow}`,
        `Mode: ${result.mode}`,
        `Runtime: ${result.runtime}`,
        `Auth: ${result.authChoice}`,
        `Hatch: ${result.hatch}`,
        `Install daemon: ${result.installDaemon ? 'yes' : 'no'}`,
        hatchHint,
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
