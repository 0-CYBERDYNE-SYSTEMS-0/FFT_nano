import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
  PARITY_CONFIG,
  TRIGGER_PATTERN,
} from './config.js';
import { AvailableGroup } from './pi-runner.js';
import { RegisteredGroup } from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import {
  isTelegramJid,
  isTelegramPrivateChatJid,
  parseTelegramChatId,
} from './telegram.js';
import type { TelegramInlineKeyboard } from './telegram.js';
import { state } from './app-state.js';
import type { TelegramSettingsPanelAction } from './app-state.js';
import { ensureKnowledgeWikiScaffold } from './knowledge-wiki.js';
import { ensureKnowledgeNightlyTask } from './knowledge-wiki-task.js';
import {
  ensureMainWorkspaceBootstrap,
  getMainWorkspaceOnboardingStatus,
} from './workspace-bootstrap.js';
import { isValidGroupFolder } from './group-folder.js';
import { getAvailableGroups } from './state-persistence.js';

export const TELEGRAM_GROUP_APPROVALS_PATH = path.join(
  DATA_DIR,
  'telegram_group_approvals.json',
);
export const TELEGRAM_GROUP_APPROVAL_NOTIFY_EVERY_MS = 10 * 60 * 1000;

export interface TelegramGroupApprovalRecord {
  jid: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastNotifiedAt?: string;
}

export interface TelegramGroupApprovalState {
  pending: Record<string, TelegramGroupApprovalRecord>;
  ignored: Record<string, TelegramGroupApprovalRecord & { ignoredAt: string }>;
}

export function emptyTelegramGroupApprovalState(): TelegramGroupApprovalState {
  return { pending: {}, ignored: {} };
}

export function loadTelegramGroupApprovals(): TelegramGroupApprovalState {
  const loaded = loadJson<Partial<TelegramGroupApprovalState>>(
    TELEGRAM_GROUP_APPROVALS_PATH,
    emptyTelegramGroupApprovalState(),
  );
  return {
    pending: loaded.pending || {},
    ignored: loaded.ignored || {},
  };
}

export function saveTelegramGroupApprovals(
  approvals: TelegramGroupApprovalState,
): void {
  saveJson(TELEGRAM_GROUP_APPROVALS_PATH, approvals);
}

export function isTelegramGroupChatJid(chatJid: string): boolean {
  if (!isTelegramJid(chatJid) || isTelegramPrivateChatJid(chatJid)) {
    return false;
  }
  const chatId = parseTelegramChatId(chatJid);
  if (!chatId) return false;
  return Number(chatId) < 0;
}

export function buildTelegramGroupFolder(chatJid: string): string | null {
  const chatId = parseTelegramChatId(chatJid);
  if (!chatId) return null;
  const folder = `telegram-${chatId}`;
  return isValidGroupFolder(folder) ? folder : null;
}

export function findAvailableGroup(chatJid: string): AvailableGroup | null {
  return getAvailableGroups().find((group) => group.jid === chatJid) || null;
}

export function clipTelegramButtonLabel(value: string, max = 26): string {
  const trimmed = value.trim() || 'Unnamed group';
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}...`;
}

export function buildTelegramGroupApprovalRecord(params: {
  chatJid: string;
  chatName?: string;
  nowIso: string;
}): TelegramGroupApprovalRecord {
  const existing = loadTelegramGroupApprovals().pending[params.chatJid];
  return {
    jid: params.chatJid,
    name:
      params.chatName?.trim() ||
      existing?.name ||
      findAvailableGroup(params.chatJid)?.name ||
      params.chatJid,
    firstSeenAt: existing?.firstSeenAt || params.nowIso,
    lastSeenAt: params.nowIso,
    lastNotifiedAt: existing?.lastNotifiedAt,
  };
}

export function buildTelegramGroupApprovalSnapshot(): {
  approvals: TelegramGroupApprovalState;
  pending: TelegramGroupApprovalRecord[];
  ignored: Array<TelegramGroupApprovalRecord & { ignoredAt: string }>;
} {
  const approvals = loadTelegramGroupApprovals();
  const knownGroups = getAvailableGroups().filter(
    (group) =>
      isTelegramGroupChatJid(group.jid) &&
      !group.isRegistered &&
      !approvals.ignored[group.jid],
  );
  for (const group of knownGroups) {
    if (!approvals.pending[group.jid]) {
      const nowIso = new Date().toISOString();
      approvals.pending[group.jid] = {
        jid: group.jid,
        name: group.name || group.jid,
        firstSeenAt: nowIso,
        lastSeenAt: group.lastActivity || nowIso,
      };
    }
  }

  for (const jid of Object.keys(approvals.pending)) {
    if (state.registeredGroups[jid]) delete approvals.pending[jid];
  }
  for (const jid of Object.keys(approvals.ignored)) {
    if (state.registeredGroups[jid]) delete approvals.ignored[jid];
  }
  saveTelegramGroupApprovals(approvals);

  const pending = Object.values(approvals.pending).sort((a, b) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
  const ignored = Object.values(approvals.ignored).sort((a, b) =>
    b.ignoredAt.localeCompare(a.ignoredAt),
  );
  return { approvals, pending, ignored };
}

export async function handleTelegramUnknownGroup(
  event: {
    chatJid: string;
    chatName?: string;
    content?: string;
  },
  deps: {
    sendMessage: (jid: string, text: string) => Promise<boolean>;
    findMainTelegramChatJid: () => string | null;
    buildTelegramGroupsPanel: (chatJid: string) => {
      text: string;
      keyboard: TelegramInlineKeyboard;
    };
  },
): Promise<void> {
  if (!isTelegramGroupChatJid(event.chatJid)) return;
  if (state.registeredGroups[event.chatJid]) return;

  const content = (event.content || '').trim();
  if (!content) return;
  TRIGGER_PATTERN.lastIndex = 0;
  const addressedToBot =
    TRIGGER_PATTERN.test(content) ||
    /^\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(content);
  if (!addressedToBot) return;

  const approvals = loadTelegramGroupApprovals();
  const ignored = approvals.ignored[event.chatJid];
  if (ignored) {
    await deps.sendMessage(
      event.chatJid,
      `${ASSISTANT_NAME}: this group is not active. Ask the owner to open /groups in the main chat and approve it.`,
    );
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const record = buildTelegramGroupApprovalRecord({
    chatJid: event.chatJid,
    chatName: event.chatName,
    nowIso,
  });
  const previousNotifiedAt = record.lastNotifiedAt
    ? Date.parse(record.lastNotifiedAt)
    : 0;
  const shouldNotifyMain =
    !previousNotifiedAt ||
    Number.isNaN(previousNotifiedAt) ||
    now - previousNotifiedAt >= TELEGRAM_GROUP_APPROVAL_NOTIFY_EVERY_MS;
  if (shouldNotifyMain) {
    record.lastNotifiedAt = nowIso;
  }
  approvals.pending[event.chatJid] = record;
  saveTelegramGroupApprovals(approvals);

  const mainChatJid = deps.findMainTelegramChatJid();
  await deps.sendMessage(
    event.chatJid,
    mainChatJid
      ? `${ASSISTANT_NAME}: I see this group, but the owner has not approved me here yet. I sent an approval panel to the main chat.`
      : `${ASSISTANT_NAME}: I see this group, but no Telegram main/admin chat is configured yet. DM me and run /main <secret> first.`,
  );

  if (!mainChatJid || !shouldNotifyMain || !state.telegramBot) return;
  const panel = deps.buildTelegramGroupsPanel(mainChatJid);
  if (state.telegramBot.sendMessageWithKeyboard) {
    await state.telegramBot.sendMessageWithKeyboard(
      mainChatJid,
      panel.text,
      panel.keyboard,
    );
  } else {
    await deps.sendMessage(mainChatJid, panel.text);
  }
}

export async function approveTelegramGroup(
  chatJid: string,
  deps: {
    registerGroup: (jid: string, group: RegisteredGroup) => void;
    sendMessage: (jid: string, text: string) => Promise<boolean>;
    refreshTelegramCommandMenus: () => Promise<void>;
  },
): Promise<{ ok: boolean; text: string }> {
  if (!isTelegramGroupChatJid(chatJid)) {
    return { ok: false, text: `Cannot approve non-group chat: ${chatJid}` };
  }
  if (state.registeredGroups[chatJid]) {
    return { ok: true, text: 'Group is already active.' };
  }
  const folder = buildTelegramGroupFolder(chatJid);
  if (!folder) {
    return { ok: false, text: `Cannot create a safe folder for ${chatJid}` };
  }

  const approvals = loadTelegramGroupApprovals();
  const pending = approvals.pending[chatJid];
  const available = findAvailableGroup(chatJid);
  const name = pending?.name || available?.name || chatJid;
  deps.registerGroup(chatJid, {
    name,
    folder,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
  delete approvals.pending[chatJid];
  delete approvals.ignored[chatJid];
  saveTelegramGroupApprovals(approvals);
  await deps.refreshTelegramCommandMenus();
  await deps.sendMessage(
    chatJid,
    `${ASSISTANT_NAME}: this group is active now. Mention @${ASSISTANT_NAME} when you want me to help here.`,
  );
  return { ok: true, text: `Approved ${name}.` };
}

export async function ignoreTelegramGroup(
  chatJid: string,
): Promise<{ ok: boolean; text: string }> {
  if (!isTelegramGroupChatJid(chatJid)) {
    return { ok: false, text: `Cannot ignore non-group chat: ${chatJid}` };
  }
  const approvals = loadTelegramGroupApprovals();
  const pending = approvals.pending[chatJid];
  const available = findAvailableGroup(chatJid);
  const nowIso = new Date().toISOString();
  approvals.ignored[chatJid] = {
    jid: chatJid,
    name: pending?.name || available?.name || chatJid,
    firstSeenAt: pending?.firstSeenAt || nowIso,
    lastSeenAt: pending?.lastSeenAt || nowIso,
    lastNotifiedAt: pending?.lastNotifiedAt,
    ignoredAt: nowIso,
  };
  delete approvals.pending[chatJid];
  saveTelegramGroupApprovals(approvals);
  return { ok: true, text: `Ignored ${approvals.ignored[chatJid].name}.` };
}

export async function unignoreTelegramGroup(
  chatJid: string,
): Promise<{ ok: boolean; text: string }> {
  const approvals = loadTelegramGroupApprovals();
  const ignored = approvals.ignored[chatJid];
  if (!ignored) return { ok: false, text: 'That group is not ignored.' };
  const nowIso = new Date().toISOString();
  approvals.pending[chatJid] = {
    jid: chatJid,
    name: ignored.name,
    firstSeenAt: ignored.firstSeenAt || nowIso,
    lastSeenAt: nowIso,
    lastNotifiedAt: ignored.lastNotifiedAt,
  };
  delete approvals.ignored[chatJid];
  saveTelegramGroupApprovals(approvals);
  return { ok: true, text: `Moved ${ignored.name} back to pending.` };
}

export function maybeRegisterTelegramChat(
  chatJid: string,
  chatName: string,
  deps: {
    registerGroup: (jid: string, group: RegisteredGroup) => void;
    hasMainGroup: () => boolean;
  },
): boolean {
  const TELEGRAM_AUTO_REGISTER = !['0', 'false', 'no'].includes(
    (process.env.TELEGRAM_AUTO_REGISTER || '1').toLowerCase(),
  );
  if (!TELEGRAM_AUTO_REGISTER) return false;
  if (state.registeredGroups[chatJid]) return false;

  const chatId = parseTelegramChatId(chatJid);
  if (!chatId) return false;

  const TELEGRAM_MAIN_CHAT_ID = process.env.TELEGRAM_MAIN_CHAT_ID;
  const isMain = TELEGRAM_MAIN_CHAT_ID && chatId === TELEGRAM_MAIN_CHAT_ID;
  if (isTelegramGroupChatJid(chatJid) && !isMain) return false;
  const folder = isMain ? MAIN_GROUP_FOLDER : `telegram-${chatId}`;

  deps.registerGroup(chatJid, {
    name: chatName,
    folder,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
  return true;
}

export function hasMainGroup(): boolean {
  return Object.values(state.registeredGroups).some(
    (g) => g.folder === MAIN_GROUP_FOLDER,
  );
}

export function ensureKnowledgeRuntimeSetup(mainChatJid: string | null): {
  createdPaths: string[];
  nightlyTask: ReturnType<typeof ensureKnowledgeNightlyTask>;
} {
  const scaffold = ensureKnowledgeWikiScaffold({
    workspaceDir: MAIN_WORKSPACE_DIR,
  });
  const nightlyTask = ensureKnowledgeNightlyTask({ mainChatJid });
  return {
    createdPaths: scaffold.createdPaths,
    nightlyTask,
  };
}

export function promoteChatToMain(
  chatJid: string,
  chatName: string,
  deps: {
    registerGroup: (jid: string, group: RegisteredGroup) => void;
  },
): void {
  const prev = state.registeredGroups[chatJid];
  if (prev?.folder === MAIN_GROUP_FOLDER) return;

  if (hasMainGroup()) {
    logger.warn(
      { chatJid },
      'Cannot promote to main: another main group already exists',
    );
    return;
  }

  if (prev && prev.folder !== MAIN_GROUP_FOLDER) {
    const oldDir = path.join(DATA_DIR, '..', 'groups', prev.folder);
    const newDir = path.join(DATA_DIR, '..', 'groups', MAIN_GROUP_FOLDER);
    try {
      if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.renameSync(oldDir, newDir);
      }
    } catch (err) {
      logger.warn(
        { err, oldDir, newDir },
        'Failed to migrate group folder to main',
      );
    }
  }

  deps.registerGroup(chatJid, {
    name: chatName || `${ASSISTANT_NAME} (main)`,
    folder: MAIN_GROUP_FOLDER,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
    containerConfig: prev?.containerConfig,
  });
  const setup = ensureKnowledgeRuntimeSetup(chatJid);
  if (setup.nightlyTask.created) {
    logger.info(
      {
        taskId: setup.nightlyTask.taskId,
        schedule: setup.nightlyTask.schedule,
        nextRun: setup.nightlyTask.nextRun,
      },
      'Provisioned nightly knowledge librarian task',
    );
  }
}

export function maybePromoteConfiguredTelegramMain(deps: {
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  promoteChatToMain: (chatJid: string, chatName: string) => void;
}): void {
  const TELEGRAM_MAIN_CHAT_ID = process.env.TELEGRAM_MAIN_CHAT_ID;
  if (!TELEGRAM_MAIN_CHAT_ID) return;
  const chatJid = `telegram:${TELEGRAM_MAIN_CHAT_ID}`;
  const prev = state.registeredGroups[chatJid];

  if (prev?.folder === MAIN_GROUP_FOLDER) {
    ensureKnowledgeRuntimeSetup(chatJid);
    logger.info(
      { chatJid },
      'Configured Telegram main chat already registered',
    );
    return;
  }

  if (!prev) {
    logger.info(
      { chatJid },
      'Configured Telegram main chat not found in registry; creating main registration',
    );
    deps.registerGroup(chatJid, {
      name: `${ASSISTANT_NAME} (main)`,
      folder: MAIN_GROUP_FOLDER,
      trigger: `@${ASSISTANT_NAME}`,
      added_at: new Date().toISOString(),
    });
    ensureKnowledgeRuntimeSetup(chatJid);
    return;
  }

  logger.info(
    { chatJid },
    'Promoting configured Telegram main chat to main folder',
  );
  deps.promoteChatToMain(chatJid, prev.name || `${ASSISTANT_NAME} (main)`);
}

export function isMainChat(chatJid: string): boolean {
  return state.registeredGroups[chatJid]?.folder === MAIN_GROUP_FOLDER;
}

export function resolveMainOnboardingGate(chatJid: string): {
  active: boolean;
  pending: boolean;
} {
  if (!isMainChat(chatJid)) return { active: false, pending: false };
  if (PARITY_CONFIG.workspace.skipBootstrap)
    return { active: false, pending: false };
  if (!PARITY_CONFIG.workspace.enforceBootstrapGate)
    return { active: false, pending: false };

  ensureMainWorkspaceBootstrap({ workspaceDir: MAIN_WORKSPACE_DIR });
  const status = getMainWorkspaceOnboardingStatus(MAIN_WORKSPACE_DIR);
  if (!status.pending) return { active: false, pending: false };

  const enforceForWorkspace =
    status.gateEligible ||
    PARITY_CONFIG.workspace.enforceBootstrapGateForExisting;
  return {
    active: enforceForWorkspace,
    pending: true,
  };
}

export function parseTelegramTargetJid(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (isTelegramJid(value)) {
    return parseTelegramChatId(value) ? value : null;
  }
  if (/^-?\d+$/.test(value)) {
    return `telegram:${value}`;
  }
  return null;
}

export function findMainTelegramChatJid(): string | null {
  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER && isTelegramJid(jid)) {
      return jid;
    }
  }
  return null;
}

export function findMainChatJid(): string | null {
  for (const [jid, group] of Object.entries(state.registeredGroups)) {
    if (group.folder === MAIN_GROUP_FOLDER) return jid;
  }
  return null;
}

export function formatGroupsText(): string {
  const groups = Object.entries(state.registeredGroups);
  const { pending, ignored } = buildTelegramGroupApprovalSnapshot();
  const lines: string[] = [];

  if (pending.length > 0) {
    lines.push('Pending Telegram group approvals:');
    for (const record of pending.slice(0, 12)) {
      lines.push(`- ${record.name} -> ${record.jid}`);
    }
    if (pending.length > 12) lines.push(`- ... ${pending.length - 12} more`);
    lines.push('');
  }

  if (groups.length === 0) {
    lines.push('No groups are registered.');
  } else {
    lines.push('Registered groups:');
    for (const [jid, group] of groups) {
      const mainTag = group.folder === MAIN_GROUP_FOLDER ? ' (main)' : '';
      lines.push(
        `- ${group.name}${mainTag} -> ${jid} [folder=${group.folder}]`,
      );
    }
  }

  if (ignored.length > 0) {
    lines.push('');
    lines.push('Ignored Telegram groups:');
    for (const record of ignored.slice(0, 8)) {
      lines.push(`- ${record.name} -> ${record.jid}`);
    }
    if (ignored.length > 8) lines.push(`- ... ${ignored.length - 8} more`);
  }

  return lines.join('\n');
}

export function buildTelegramGroupsPanel(
  chatJid: string,
  deps: {
    registerTelegramSettingsPanelAction: (
      chatJid: string,
      action: TelegramSettingsPanelAction,
    ) => string;
  },
): {
  text: string;
  keyboard: TelegramInlineKeyboard;
} {
  const { pending, ignored } = buildTelegramGroupApprovalSnapshot();
  const keyboard: TelegramInlineKeyboard = [];

  for (const record of pending.slice(0, 8)) {
    const label = clipTelegramButtonLabel(record.name, 24);
    keyboard.push([
      {
        text: `Approve ${label}`,
        callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
          kind: 'approve-telegram-group',
          chatJid: record.jid,
        }),
        style: 'primary' as const,
      },
      {
        text: 'Ignore',
        callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
          kind: 'ignore-telegram-group',
          chatJid: record.jid,
        }),
      },
    ]);
  }

  for (const record of ignored.slice(0, 4)) {
    keyboard.push([
      {
        text: `Unignore ${clipTelegramButtonLabel(record.name, 20)}`,
        callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
          kind: 'unignore-telegram-group',
          chatJid: record.jid,
        }),
      },
      {
        text: 'Approve',
        callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
          kind: 'approve-telegram-group',
          chatJid: record.jid,
        }),
        style: 'primary' as const,
      },
    ]);
  }

  keyboard.push([
    {
      text: 'Refresh',
      callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-groups',
      }),
    },
    {
      text: 'Back',
      callbackData: deps.registerTelegramSettingsPanelAction(chatJid, {
        kind: 'show-home',
      }),
    },
  ]);

  return {
    text: formatGroupsText(),
    keyboard,
  };
}
