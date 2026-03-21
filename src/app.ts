import { exec, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface AppRuntimeDeps {
  state: {
    telegramBot?: any | null;
    registeredGroups: Record<string, any>;
    messageLoopRunning?: boolean;
    sock?: any;
    lidToPhoneMap?: Record<string, string>;
    groupSyncTimerStarted?: boolean;
    shuttingDown?: boolean;
    heartbeatLoopStarted?: boolean;
  };
  constants: {
    telegramBotToken?: string;
    telegramApiBaseUrl?: string;
    assistantName: string;
    triggerPattern: RegExp;
    storeDir?: string;
    groupSyncIntervalMs?: number;
    pollInterval?: number;
    heartbeatActiveHoursRaw?: string;
    heartbeatActiveHours?: unknown;
    dataDir?: string;
    fftProfile?: string;
    featureFarm?: boolean;
    farmStateEnabled?: boolean;
    profileDetection?: unknown;
    whatsappEnabled?: boolean;
    mainWorkspaceDir?: string;
  };
  createTelegramBot: (params: {
    token: string;
    apiBaseUrl?: string;
    assistantName: string;
    triggerPattern: RegExp;
  }) => any;
  refreshTelegramCommandMenus: () => Promise<void>;
  handleTelegramCallbackQuery: (event: any) => Promise<void>;
  handleTelegramSetupInput: (event: any) => Promise<boolean>;
  handleTelegramCommand: (event: any) => Promise<boolean>;
  storeChatMetadata: (chatJid: string, timestamp: string, chatName?: string) => void;
  maybeRegisterTelegramChat: (chatJid: string, chatName: string) => boolean;
  isMainChat: (chatJid: string) => boolean;
  persistTelegramMedia: (event: any) => Promise<string>;
  storeTextMessage: (message: any) => void;
  logger: {
    info?: (payload: unknown, message?: string) => void;
    debug?: (payload: unknown, message?: string) => void;
    error?: (payload: unknown, message?: string) => void;
    warn?: (payload: unknown, message?: string) => void;
    fatal?: (payload: unknown, message?: string) => void;
  };
  useMultiFileAuthState?: (authDir: string) => Promise<{ state: any; saveCreds: () => void }>;
  makeWASocket?: (params: any) => any;
  makeCacheableSignalKeyStore?: (keys: any, logger: any) => any;
  browsers?: { macOS: (name: string) => unknown };
  disconnectReason?: { loggedOut: number };
  sendMessage?: (chatJid: string, text: string) => Promise<void>;
  maybeRegisterWhatsAppMainChat?: () => void;
  syncGroupMetadata?: (force?: boolean) => Promise<void>;
  startSchedulerLoop?: (params: any) => void;
  startIpcWatcher?: () => void;
  startMessageLoop?: () => Promise<void>;
  requestHeartbeatNow?: (reason?: string) => void;
  storeMessage?: (message: any, chatJid: string, fromMe: boolean, senderName?: string) => void;
  translateJid?: (jid: string) => string;
  processMessage?: (msg: any) => Promise<boolean>;
  getNewMessages?: (
    jids: string[],
    lastTimestamp: string,
    assistantName: string,
  ) => { messages: any[] };
  lastTimestamp?: () => string;
  setLastTimestamp?: (value: string) => void;
  saveState?: () => void;
  isWithinHeartbeatActiveHoursInvalid?: boolean;
  acquireSingletonLock?: (lockPath: string) => void;
  ensureContainerSystemRunning?: () => void;
  initDatabase?: () => void;
  loadState?: () => void;
  migrateLegacyClaudeMemoryFiles?: () => void;
  migrateCompactionSummariesFromSoul?: () => void;
  maybePromoteConfiguredTelegramMain?: () => void;
  startTuiGatewayService?: () => Promise<void>;
  startWebControlCenterService?: () => Promise<void>;
  stopTuiGatewayService?: () => Promise<void>;
  stopWebControlCenterService?: () => Promise<void>;
  startFarmStateCollector?: () => void;
  stopFarmStateCollector?: () => void;
  startHeartbeatLoop?: () => void;
  maybeRunBootMdOnce?: () => void;
  getContainerRuntime?: () => string;
}

export function createAppRuntime(deps: AppRuntimeDeps): {
  startTelegram: () => Promise<void>;
  connectWhatsApp: () => Promise<void>;
  startMessageLoop: () => Promise<void>;
  ensureContainerSystemRunning: () => void;
  stopFarmServicesForShutdown: (signal: string) => void;
  shutdownAndExit: (signal: string, exitCode: number) => Promise<void>;
  registerShutdownHandlers: () => void;
  main: () => Promise<void>;
} {
  async function startTelegram(): Promise<void> {
    if (!deps.constants.telegramBotToken) return;
    if (deps.state.telegramBot) return;

    deps.state.telegramBot = deps.createTelegramBot({
      token: deps.constants.telegramBotToken,
      apiBaseUrl: deps.constants.telegramApiBaseUrl,
      assistantName: deps.constants.assistantName,
      triggerPattern: deps.constants.triggerPattern,
    });

    deps.state.telegramBot.startPolling(async (event: any) => {
      if (event.kind === 'callback_query') {
        await deps.handleTelegramCallbackQuery(event);
        return;
      }

      const m = event;
      deps.storeChatMetadata(m.chatJid, m.timestamp, m.chatName);
      const didRegister = deps.maybeRegisterTelegramChat(m.chatJid, m.chatName);
      if (didRegister && deps.isMainChat(m.chatJid)) {
        await deps.refreshTelegramCommandMenus();
      }
      if (await deps.handleTelegramSetupInput(m)) return;
      if (await deps.handleTelegramCommand(m)) return;
      if (deps.state.registeredGroups[m.chatJid]) {
        const finalContent = m.media ? await deps.persistTelegramMedia(m) : m.content;
        deps.storeTextMessage({
          id: m.id,
          chatJid: m.chatJid,
          sender: m.sender,
          senderName: m.senderName,
          content: finalContent,
          timestamp: m.timestamp,
          isFromMe: false,
        });
      }
    });

    deps.logger.info?.('Telegram polling started');
    void deps.refreshTelegramCommandMenus();
  }

  async function connectWhatsApp(): Promise<void> {
    if (!deps.useMultiFileAuthState || !deps.makeWASocket || !deps.makeCacheableSignalKeyStore) {
      throw new Error('WhatsApp runtime dependencies are not configured');
    }
    const authDir = path.join(deps.constants.storeDir || 'data', 'auth');
    fs.mkdirSync(authDir, { recursive: true });
    const { state: authState, saveCreds } = await deps.useMultiFileAuthState(authDir);

    deps.state.sock = deps.makeWASocket({
      auth: {
        creds: authState.creds,
        keys: deps.makeCacheableSignalKeyStore(authState.keys, deps.logger),
      },
      printQRInTerminal: false,
      logger: deps.logger,
      browser: deps.browsers?.macOS('Chrome'),
    });

    deps.state.sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        const msg = 'WhatsApp authentication required. Run: npm run auth';
        deps.logger.error?.(msg);
        if (process.platform === 'darwin') {
          exec(
            `osascript -e 'display notification "${msg}" with title "FFT_nano" sound name "Basso"'`,
          );
        }
        setTimeout(() => process.exit(1), 1000);
      }

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
          ?.output?.statusCode;
        const shouldReconnect = reason !== deps.disconnectReason?.loggedOut;
        deps.logger.info?.({ reason, shouldReconnect }, 'Connection closed');
        if (shouldReconnect) {
          deps.logger.info?.('Reconnecting...');
          void connectWhatsApp();
        } else {
          deps.logger.info?.('Logged out. Run /setup to re-authenticate.');
          process.exit(0);
        }
      } else if (connection === 'open') {
        deps.logger.info?.('Connected to WhatsApp');
        deps.state.sock.sendPresenceUpdate('available').catch((err: unknown) => {
          deps.logger.debug?.({ err }, 'Failed to set initial available presence');
        });
        if (deps.state.sock.user) {
          const phoneUser = deps.state.sock.user.id.split(':')[0];
          const lidUser = deps.state.sock.user.lid?.split(':')[0];
          if (lidUser && phoneUser) {
            deps.state.lidToPhoneMap ||= {};
            deps.state.lidToPhoneMap[lidUser] = `${phoneUser}@s.whatsapp.net`;
            deps.logger.debug?.({ lidUser, phoneUser }, 'LID to phone mapping set');
          }
        }
        deps.maybeRegisterWhatsAppMainChat?.();
        deps.syncGroupMetadata?.().catch((err) => deps.logger.error?.({ err }, 'Initial group sync failed'));
        if (!deps.state.groupSyncTimerStarted) {
          deps.state.groupSyncTimerStarted = true;
          setInterval(() => {
            deps.syncGroupMetadata?.().catch((err) =>
              deps.logger.error?.({ err }, 'Periodic group sync failed'),
            );
          }, deps.constants.groupSyncIntervalMs || 24 * 60 * 60 * 1000);
        }
        deps.startSchedulerLoop?.({
          sendMessage: deps.sendMessage,
          registeredGroups: () => deps.state.registeredGroups,
          requestHeartbeatNow: deps.requestHeartbeatNow,
        });
        deps.startIpcWatcher?.();
        void deps.startMessageLoop?.().catch((err) =>
          deps.logger.fatal?.({ err }, 'Message loop crashed unexpectedly'),
        );
      }
    });

    deps.state.sock.ev.on('creds.update', saveCreds);
    deps.state.sock.ev.on('messages.upsert', ({ messages }: { messages: any[] }) => {
      for (const msg of messages) {
        if (!msg.message) continue;
        const rawJid = msg.key.remoteJid;
        if (!rawJid || rawJid === 'status@broadcast') continue;
        const chatJid = deps.translateJid ? deps.translateJid(rawJid) : rawJid;
        const timestamp = new Date(Number(msg.messageTimestamp) * 1000).toISOString();
        deps.storeChatMetadata(chatJid, timestamp);
        if (deps.state.registeredGroups[chatJid]) {
          deps.storeMessage?.(msg, chatJid, msg.key.fromMe || false, msg.pushName || undefined);
        }
      }
    });
  }

  async function startMessageLoop(): Promise<void> {
    if (deps.state.messageLoopRunning) {
      deps.logger.debug?.('Message loop already running, skipping duplicate start');
      return;
    }
    deps.state.messageLoopRunning = true;
    deps.logger.info?.(`FFT_nano running (trigger: @${deps.constants.assistantName})`);
    while (true) {
      try {
        const jids = Object.keys(deps.state.registeredGroups);
        const { messages } = deps.getNewMessages
          ? deps.getNewMessages(jids, deps.lastTimestamp?.() || '', deps.constants.assistantName)
          : { messages: [] };
        if (messages.length > 0) {
          deps.logger.info?.({ count: messages.length }, 'New messages');
        }
        for (const msg of messages) {
          try {
            const processed = await deps.processMessage?.(msg);
            if (!processed) {
              deps.logger.debug?.({ msgId: msg.id, chatJid: msg.chat_jid }, 'Message processing deferred; retrying on next poll loop');
              break;
            }
            deps.setLastTimestamp?.(msg.timestamp);
            deps.saveState?.();
          } catch (err) {
            deps.logger.error?.({ err, msg: msg.id }, 'Error processing message, will retry');
            break;
          }
        }
      } catch (err) {
        deps.logger.error?.({ err }, 'Error in message loop');
      }
      await new Promise((resolve) => setTimeout(resolve, deps.constants.pollInterval || 1000));
    }
  }

  function ensureContainerSystemRunning(): void {
    const runtime = deps.getContainerRuntime?.() || 'docker';
    if (runtime === 'host') {
      if (
        (process.env.NODE_ENV || '').toLowerCase() === 'production' &&
        !['1', 'true', 'yes', 'on'].includes(
          (process.env.FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD || '').toLowerCase(),
        )
      ) {
        throw new Error(
          'Host runtime is blocked in production unless FFT_NANO_ALLOW_HOST_RUNTIME_IN_PROD=1',
        );
      }
      deps.logger.warn?.(
        'Running in host runtime mode (no container isolation). This should only be used for trusted local workflows.',
      );
      return;
    }
    try {
      execSync('docker info', { stdio: 'pipe' });
      deps.logger.debug?.('Docker runtime available');
    } catch (err) {
      deps.logger.error?.({ err }, 'Docker runtime not available');
      console.error('\n╔════════════════════════════════════════════════════════════════╗');
      console.error('║  FATAL: Docker is required but is not available               ║');
      console.error('║                                                                ║');
      console.error('║  To fix:                                                       ║');
      console.error('║  1. Install Docker (Desktop on macOS, engine on Linux/RPi)     ║');
      console.error('║  2. Start the Docker daemon                                    ║');
      console.error('║  3. Restart FFT_nano                                          ║');
      console.error('╚════════════════════════════════════════════════════════════════╝\n');
      throw new Error('Docker is required but not available');
    }
    try {
      const output = execSync(
        "docker ps -a --filter status=exited --filter name=nanoclaw- --format '{{.Names}}'",
        { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
      );
      const stale = output
        .split('\n')
        .map((n) => n.trim())
        .filter((n) => n.startsWith('nanoclaw-'));
      if (stale.length > 0) {
        execSync(`docker rm ${stale.join(' ')}`, { stdio: 'pipe' });
        deps.logger.info?.({ runtime, count: stale.length }, 'Cleaned up stale containers');
      }
    } catch {
      // Ignore cleanup failures.
    }
  }

  function stopFarmServicesForShutdown(signal: string): void {
    if (deps.state.shuttingDown) return;
    deps.state.shuttingDown = true;
    deps.logger.info?.({ signal }, 'Shutting down FFT_nano services');
    if (deps.constants.featureFarm && deps.constants.farmStateEnabled) {
      deps.stopFarmStateCollector?.();
    }
  }

  async function shutdownAndExit(signal: string, exitCode: number): Promise<void> {
    stopFarmServicesForShutdown(signal);
    await deps.stopWebControlCenterService?.();
    await deps.stopTuiGatewayService?.();
    process.exit(exitCode);
  }

  function registerShutdownHandlers(): void {
    process.on('SIGINT', () => {
      void shutdownAndExit('SIGINT', 0);
    });
    process.on('SIGTERM', () => {
      void shutdownAndExit('SIGTERM', 0);
    });
  }

  async function main(): Promise<void> {
    registerShutdownHandlers();
    if (deps.constants.heartbeatActiveHoursRaw?.trim() && deps.isWithinHeartbeatActiveHoursInvalid) {
      deps.logger.warn?.(
        { value: deps.constants.heartbeatActiveHoursRaw },
        'Ignoring invalid heartbeat active-hours format; expected HH:MM-HH:MM, Mon-Fri@HH:MM-HH:MM, or HH:MM-HH:MM@America/New_York',
      );
    }
    if (deps.constants.dataDir) {
      deps.acquireSingletonLock?.(path.join(deps.constants.dataDir, 'fft_nano.lock'));
    }
    deps.ensureContainerSystemRunning?.();
    deps.initDatabase?.();
    deps.logger.info?.('Database initialized');
    deps.loadState?.();
    deps.migrateLegacyClaudeMemoryFiles?.();
    deps.migrateCompactionSummariesFromSoul?.();
    deps.maybePromoteConfiguredTelegramMain?.();
    await deps.startTuiGatewayService?.();
    await deps.startWebControlCenterService?.();
    deps.logger.info?.(
      {
        profile: deps.constants.fftProfile,
        featureFarm: deps.constants.featureFarm,
        profileDetection: deps.constants.profileDetection,
      },
      'Runtime profile resolved',
    );
    if (deps.constants.featureFarm && deps.constants.farmStateEnabled) {
      deps.startFarmStateCollector?.();
    }
    const telegramEnabled = !!deps.constants.telegramBotToken;
    const farmOnlyMode =
      !!deps.constants.featureFarm &&
      !!deps.constants.farmStateEnabled &&
      deps.constants.whatsappEnabled === false &&
      !telegramEnabled;
    if (deps.constants.whatsappEnabled === false && !telegramEnabled && !farmOnlyMode) {
      throw new Error('No channels enabled. Set WHATSAPP_ENABLED=1 and/or TELEGRAM_BOT_TOKEN.');
    }
    if (telegramEnabled) {
      await startTelegram();
    }
    if (telegramEnabled || deps.constants.whatsappEnabled === false) {
      deps.startSchedulerLoop?.({
        sendMessage: deps.sendMessage,
        registeredGroups: () => deps.state.registeredGroups,
        requestHeartbeatNow: deps.requestHeartbeatNow,
      });
      deps.startIpcWatcher?.();
      deps.startHeartbeatLoop?.();
      void startMessageLoop().catch((err) => deps.logger.fatal?.({ err }, 'Message loop crashed unexpectedly'));
    }
    if (farmOnlyMode) {
      deps.logger.info?.('Running in farm-state-only mode (no channels enabled)');
    } else if (deps.constants.whatsappEnabled) {
      await connectWhatsApp();
      deps.startHeartbeatLoop?.();
    } else {
      deps.logger.info?.('WhatsApp disabled (WHATSAPP_ENABLED=0)');
    }
    deps.maybeRunBootMdOnce?.();
  }

  return {
    startTelegram,
    connectWhatsApp,
    startMessageLoop,
    ensureContainerSystemRunning,
    stopFarmServicesForShutdown,
    shutdownAndExit,
    registerShutdownHandlers,
    main,
  };
}
