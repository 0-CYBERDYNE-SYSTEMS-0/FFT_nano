import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  DATA_DIR,
  MAIN_GROUP_FOLDER,
  MAIN_WORKSPACE_DIR,
} from './config.js';
import { AvailableGroup } from './pi-runner.js';
import { RegisteredGroup } from './types.js';
import { loadJson, saveJson } from './utils.js';
import { logger } from './logger.js';
import { isValidGroupFolder, resolveGroupFolderPath } from './group-folder.js';
import { migrateCompactionsForGroup } from './memory-maintenance.js';
import { ensureMemoryScaffold } from './memory-paths.js';
import { normalizeTelegramDeliveryMode } from './chat-preferences.js';
import {
  getAllChats,
  getLastGroupSync,
  setLastGroupSync,
  updateChatName,
} from './db.js';
import { isTelegramJid } from './telegram.js';
import { state } from './app-state.js';
import type { ChatRunPreferences, ChatUsageStats } from './app-state.js';

export interface GitInfo {
  branch?: string;
  commit?: string;
}

export function resolveGitInfo(): GitInfo {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    const commit = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
    }).trim();
    return {
      branch: branch || undefined,
      commit: commit || undefined,
    };
  } catch {
    return {};
  }
}

export const GIT_INFO = resolveGitInfo();

export function loadState(): void {
  const statePath = path.join(DATA_DIR, 'router_state.json');
  const loaded = loadJson<{
    last_timestamp?: string;
    last_agent_timestamp?: Record<string, string>;
    chat_run_preferences?: Record<string, ChatRunPreferences>;
    chat_usage_stats?: Record<string, ChatUsageStats>;
    learning_paused?: boolean;
  }>(statePath, {});
  state.lastTimestamp = loaded.last_timestamp || '';
  state.lastAgentTimestamp = loaded.last_agent_timestamp || {};
  state.learningPaused = loaded.learning_paused ?? false;
  state.chatRunPreferences = Object.fromEntries(
    Object.entries(loaded.chat_run_preferences || {}).map(
      ([chatJid, prefs]) => {
        const nextPrefs: ChatRunPreferences = { ...prefs };
        const normalizedDelivery = prefs.telegramDeliveryMode
          ? normalizeTelegramDeliveryMode(prefs.telegramDeliveryMode)
          : undefined;
        if (normalizedDelivery === undefined) {
          delete nextPrefs.telegramDeliveryMode;
        } else {
          nextPrefs.telegramDeliveryMode = normalizedDelivery;
        }
        return [chatJid, nextPrefs];
      },
    ),
  );
  state.chatUsageStats = loaded.chat_usage_stats || {};
  const rawRegisteredGroups = loadJson<Record<string, RegisteredGroup>>(
    path.join(DATA_DIR, 'registered_groups.json'),
    {},
  );
  state.registeredGroups = {};
  for (const [jid, group] of Object.entries(rawRegisteredGroups)) {
    if (!isValidGroupFolder(group.folder)) {
      logger.warn(
        { jid, folder: group.folder },
        'Skipping registered group with invalid folder from state',
      );
      continue;
    }
    state.registeredGroups[jid] = group;
  }
  logger.info(
    { groupCount: Object.keys(state.registeredGroups).length },
    'State loaded',
  );
}

export function saveState(): void {
  saveJson(path.join(DATA_DIR, 'router_state.json'), {
    last_timestamp: state.lastTimestamp,
    last_agent_timestamp: state.lastAgentTimestamp,
    chat_run_preferences: state.chatRunPreferences,
    chat_usage_stats: state.chatUsageStats,
    learning_paused: state.learningPaused,
  });
}

export function registerGroup(
  jid: string,
  group: RegisteredGroup,
  onMainRegistered?: () => void,
): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  state.registeredGroups[jid] = group;
  saveJson(
    path.join(DATA_DIR, 'registered_groups.json'),
    state.registeredGroups,
  );

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  // Workspace persona file naming: SOUL.md is canonical. CLAUDE.md is supported
  // for backwards compatibility (older installs/groups).
  const soulFile = path.join(groupDir, 'SOUL.md');
  const nanoFile = path.join(groupDir, 'NANO.md');
  const todosFile = path.join(groupDir, 'TODOS.md');
  const legacyClaudeFile = path.join(groupDir, 'CLAUDE.md');

  // If legacy exists but SOUL doesn't, migrate in-place to avoid split-brain.
  if (!fs.existsSync(soulFile) && fs.existsSync(legacyClaudeFile)) {
    try {
      fs.renameSync(legacyClaudeFile, soulFile);
    } catch {
      try {
        fs.copyFileSync(legacyClaudeFile, soulFile);
      } catch {
        /* ignore */
      }
    }
  }

  if (!fs.existsSync(nanoFile)) {
    fs.writeFileSync(
      nanoFile,
      [
        '# NANO',
        '',
        'Nano Core runtime contract.',
        '',
        'Session context order:',
        '1. Read NANO.md',
        '2. Read SOUL.md',
        '3. Read TODOS.md',
        '4. Retrieve durable canon from canonical/*.md when needed',
        '5. Read BOOTSTRAP.md (if present)',
        '',
        'Heartbeat and scheduled maintenance runs also read HEARTBEAT.md.',
        '',
        'Memory policy:',
        '- Durable memory belongs in canonical/*.md.',
        '- Daily staging and compaction notes belong in memory/*.md.',
        '- Keep SOUL.md stable; do not use it as compaction log storage.',
        '- TODOS.md is mission control for active execution state.',
        '',
        'Execution stance:',
        '- Use tools to verify claims and perform edits.',
        '- Prefer deterministic, testable changes.',
        '- Keep user-facing updates concise and concrete.',
      ].join('\n') + '\n',
    );
  }

  if (!fs.existsSync(soulFile)) {
    fs.writeFileSync(
      soulFile,
      `# SOUL\n\nYou are ${ASSISTANT_NAME}, a concise and practical assistant for ${group.name}.\n`,
    );
  }

  if (!fs.existsSync(todosFile)) {
    fs.writeFileSync(
      todosFile,
      [
        '# TODOS.md = MISSION CONTROL: Initial Mission',
        '',
        '## 🚀 ACTIVE OBJECTIVE',
        '> Ship the next validated increment safely.',
        '',
        '## 📋 TASK BOARD',
        '- [ ] Define first active task <!-- id:T1 status:PENDING -->',
        '',
        '## 🤖 SUB-AGENTS & PROCESSES',
        '- [None]',
        '',
        '## ⏳ BLOCKED / WAITING',
        '- [None]',
        '',
        '## 📝 MISSION LOG',
        '- [00:00] - Mission control initialized.',
      ].join('\n') + '\n',
    );
  }

  ensureMemoryScaffold(group.folder);

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
  if (group.folder === MAIN_GROUP_FOLDER) {
    onMainRegistered?.();
  }
}

export function migrateCompactionSummariesFromSoul(): void {
  const groupFolders = new Set<string>();
  for (const group of Object.values(state.registeredGroups)) {
    groupFolders.add(group.folder);
  }
  groupFolders.add(MAIN_GROUP_FOLDER);
  groupFolders.add('global');

  let movedSections = 0;
  for (const groupFolder of groupFolders) {
    try {
      const result = migrateCompactionsForGroup(groupFolder);
      movedSections += result.movedSections;
    } catch (err) {
      logger.debug(
        { groupFolder, err },
        'Compaction summary migration skipped for group',
      );
    }
  }

  if (movedSections > 0) {
    logger.info(
      { movedSections, groupCount: groupFolders.size },
      'Migrated legacy compaction summaries from SOUL.md to MEMORY.md',
    );
  }
}

export function migrateLegacyClaudeMemoryFiles(): void {
  const groupsRoot = path.join(DATA_DIR, '..', 'groups');
  try {
    if (!fs.existsSync(groupsRoot)) return;
    const entries = fs.readdirSync(groupsRoot);
    for (const folder of entries) {
      const dir = path.join(groupsRoot, folder);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const soul = path.join(dir, 'SOUL.md');
      const legacy = path.join(dir, 'CLAUDE.md');
      if (fs.existsSync(soul) || !fs.existsSync(legacy)) continue;

      try {
        fs.renameSync(legacy, soul);
      } catch {
        try {
          fs.copyFileSync(legacy, soul);
        } catch {
          /* ignore */
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Legacy CLAUDE.md migration skipped');
  }
}

export function maybeRegisterWhatsAppMainChat(deps: {
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  hasMainGroup: () => boolean;
}): void {
  if (!state.sock?.user?.id) return;
  if (deps.hasMainGroup()) return;

  const phoneUser = state.sock.user.id.split(':')[0];
  if (!phoneUser) return;

  const selfChatJid = `${phoneUser}@s.whatsapp.net`;
  deps.registerGroup(selfChatJid, {
    name: `${ASSISTANT_NAME} (main)`,
    folder: MAIN_GROUP_FOLDER,
    trigger: `@${ASSISTANT_NAME}`,
    added_at: new Date().toISOString(),
  });
}

const GROUP_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function syncGroupMetadata(force = false): Promise<void> {
  if (!force) {
    const lastSync = getLastGroupSync();
    if (lastSync) {
      const lastSyncTime = new Date(lastSync).getTime();
      const now = Date.now();
      if (now - lastSyncTime < GROUP_SYNC_INTERVAL_MS) {
        logger.debug({ lastSync }, 'Skipping group sync - synced recently');
        return;
      }
    }
  }

  try {
    logger.info('Syncing group metadata from WhatsApp...');
    const groups = await state.sock!.groupFetchAllParticipating();

    let count = 0;
    for (const [jid, metadata] of Object.entries(groups)) {
      if (metadata.subject) {
        updateChatName(jid, metadata.subject);
        count++;
      }
    }

    setLastGroupSync();
    logger.info({ count }, 'Group metadata synced');
  } catch (err) {
    logger.error({ err }, 'Failed to sync group metadata');
  }
}

export function getAvailableGroups(): AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(state.registeredGroups));

  return chats
    .filter(
      (c) =>
        c.jid !== '__group_sync__' &&
        (c.jid.endsWith('@g.us') || isTelegramJid(c.jid)),
    )
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

export function writeJsonAtomic(filePath: string, payload: unknown): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

export function listPendingDeliveryFiles(groupFolder: string): string[] {
  const deliverFilesDir = path.join(
    DATA_DIR,
    'ipc',
    groupFolder,
    'deliver_files',
  );
  if (!fs.existsSync(deliverFilesDir)) return [];
  try {
    return fs
      .readdirSync(deliverFilesDir)
      .filter((fileName) => fileName.endsWith('.json'));
  } catch (err) {
    logger.warn({ err, groupFolder }, 'Unable to read deliver_files directory');
    return [];
  }
}
