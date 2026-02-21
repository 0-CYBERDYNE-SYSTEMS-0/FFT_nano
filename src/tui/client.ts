import {
  CombinedAutocompleteProvider,
  Container,
  Loader,
  ProcessTerminal,
  Text,
  TUI,
  type SlashCommand,
} from '@mariozechner/pi-tui';

import type {
  AgentEventPayload,
  ChatEventPayload,
  GatewayEventFrame,
  TuiSessionSummary,
} from './protocol.js';
import { GatewayClient } from './gateway-client.js';
import { ChatLog } from './components/chat-log.js';
import { CustomEditor } from './components/custom-editor.js';
import { resolveStartupSession } from './startup-session.js';
import { editorTheme, theme } from './theme/theme.js';

type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type ReasoningLevel = 'off' | 'on' | 'stream';

interface CliOptions {
  url?: string;
  sessionKey: string;
  deliver: boolean;
}

interface SessionPrefs {
  provider?: string;
  model?: string;
  thinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
}

type SendMessageStatus = 'sent' | 'busy';

const DEFAULT_PROVIDER = process.env.PI_API || '(provider)';
const DEFAULT_MODEL = process.env.PI_MODEL || '(model)';
const DEFAULT_GATEWAY_URL = `ws://127.0.0.1:${process.env.FFT_NANO_TUI_PORT || '28989'}`;

const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Show slash command help' },
  { name: 'status', description: 'Show gateway status' },
  { name: 'sessions', description: 'List available sessions' },
  { name: 'session', description: 'Switch session key' },
  { name: 'history', description: 'Load recent session history' },
  { name: 'model', description: 'Set model (provider/model or model)' },
  { name: 'think', description: 'Set thinking level' },
  { name: 'reasoning', description: 'Set reasoning level' },
  { name: 'deliver', description: 'Set delivery mode (on/off)' },
  { name: 'gateway', description: 'Gateway service action (status|restart)' },
  { name: 'new', description: 'Reset session before next run' },
  { name: 'reset', description: 'Alias for /new' },
  { name: 'abort', description: 'Abort active run' },
  { name: 'exit', description: 'Exit TUI' },
  { name: 'quit', description: 'Exit TUI' },
];

function parseArgs(argv: string[]): CliOptions {
  let url: string | undefined;
  let sessionKey = 'main';
  let deliver = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--url') {
      url = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--session') {
      const next = argv[i + 1];
      if (next && next.trim()) sessionKey = next.trim();
      i += 1;
      continue;
    }
    if (token === '--deliver') {
      deliver = true;
      continue;
    }
  }

  return { url, sessionKey, deliver };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.replace(/^\//, '').trim();
  if (!trimmed) return { name: '', args: '' };
  const [name, ...rest] = trimmed.split(/\s+/);
  return {
    name: (name || '').toLowerCase(),
    args: rest.join(' ').trim(),
  };
}

function parseChatMessage(message: unknown): { role: string; text: string } | null {
  if (!message || typeof message !== 'object') return null;
  const rec = message as Record<string, unknown>;
  const role = typeof rec.role === 'string' ? rec.role : '';
  const content = typeof rec.content === 'string' ? rec.content : '';
  if (!role) return null;
  return { role, text: content || '(no output)' };
}

function normalizeThinkLevel(raw: string): ThinkLevel | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (key === 'off') return 'off';
  if (['minimal', 'min'].includes(key)) return 'minimal';
  if (key === 'low') return 'low';
  if (['med', 'mid', 'medium'].includes(key)) return 'medium';
  if (['high', 'max'].includes(key)) return 'high';
  if (['xhigh', 'x-high', 'x_high'].includes(key)) return 'xhigh';
  return null;
}

function normalizeReasoningLevel(raw: string): ReasoningLevel | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (['off', 'false', '0', 'no'].includes(key)) return 'off';
  if (['on', 'true', '1', 'yes'].includes(key)) return 'on';
  if (['stream', 'streaming', 'live'].includes(key)) return 'stream';
  return null;
}

function helpText(): string {
  return [
    'Slash commands:',
    '/help',
    '/status',
    '/sessions',
    '/session <key>',
    '/history [limit]',
    '/model <provider/model|model>',
    '/think <off|minimal|low|medium|high|xhigh>',
    '/reasoning <off|on|stream>',
    '/deliver <on|off>',
    '/gateway <status|restart>',
    '/new or /reset',
    '/abort',
    '/exit',
  ].join('\n');
}

export async function runTuiClient(opts: CliOptions): Promise<void> {
  let sessionKey = opts.sessionKey;
  let activeRunId: string | null = null;
  let sessionPrefs: SessionPrefs = {};
  let lastCtrlCAt = 0;
  let connectionStatus = 'connecting';
  let activityStatus = 'idle';
  let deliver = opts.deliver;
  let availableSessions: TuiSessionSummary[] = [];
  let statusLoader: Loader | null = null;
  let statusText: Text | null = null;

  const client = new GatewayClient({
    url: opts.url,
    onEvent: (frame: GatewayEventFrame) => {
      if (frame.event === 'chat_event') {
        const evt = frame.payload as ChatEventPayload;
        if (!evt || evt.sessionKey !== sessionKey) return;

        if (evt.state === 'message') {
          const message = parseChatMessage(evt.message);
          if (!message) return;
          if (message.role === 'user') {
            activeRunId = evt.runId;
            setActivityStatus('running');
            chatLog.addUser(message.text);
          }
          else if (message.role === 'assistant') chatLog.finalizeAssistant(message.text, evt.runId);
          else chatLog.addSystem(message.text);
          tui.requestRender();
          return;
        }

        if (evt.state === 'final') {
          if (activeRunId === evt.runId) activeRunId = null;
          const message = parseChatMessage(evt.message);
          chatLog.finalizeAssistant(message?.text || '(no output)', evt.runId);
          const usage = evt.usage;
          const usageLine = usage
            ? [
                `tokens in=${asNumber(usage.inputTokens) ?? 0}`,
                `out=${asNumber(usage.outputTokens) ?? 0}`,
                `total=${asNumber(usage.totalTokens) ?? 0}`,
              ].join(' ')
            : null;
          if (usageLine) chatLog.addSystem(usageLine);
          setActivityStatus('idle');
          updateFooter();
          tui.requestRender();
          return;
        }

        if (evt.state === 'aborted') {
          if (activeRunId === evt.runId) activeRunId = null;
          chatLog.addSystem('run aborted');
          chatLog.dropAssistant(evt.runId);
          setActivityStatus('idle');
          tui.requestRender();
          return;
        }

        if (evt.state === 'error') {
          if (activeRunId === evt.runId) activeRunId = null;
          chatLog.addSystem(`error: ${evt.errorMessage || 'unknown error'}`);
          chatLog.dropAssistant(evt.runId);
          setActivityStatus('error');
          tui.requestRender();
        }
        return;
      }

      if (frame.event === 'agent_event') {
        const evt = frame.payload as AgentEventPayload & { sessionKey?: string };
        if (!evt || evt.stream !== 'lifecycle') return;
        if (evt.sessionKey && evt.sessionKey !== sessionKey) return;
        if (activeRunId && evt.runId !== activeRunId) return;

        if (evt.data?.phase === 'start') {
          setActivityStatus('running');
          tui.requestRender();
          return;
        }

        if (evt.data?.phase === 'end') {
          if (activeRunId === evt.runId) {
            activeRunId = null;
          }
          setActivityStatus('idle');
          tui.requestRender();
        }
      }
    },
    onClose: (code, reason) => {
      connectionStatus = `disconnected (${code})${reason ? `: ${reason}` : ''}`;
      setActivityStatus('idle');
      updateFooter();
      tui.requestRender();
      setTimeout(() => {
        tui.stop();
        process.exit(1);
      }, 50);
    },
  });

  const tui = new TUI(new ProcessTerminal());
  const header = new Text('', 1, 0);
  const chatLog = new ChatLog();
  const statusContainer = new Container();
  const footer = new Text('', 1, 0);
  const editor = new CustomEditor(tui, editorTheme);

  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(statusContainer);
  root.addChild(footer);
  root.addChild(editor);

  tui.addChild(root);
  tui.setFocus(editor);

  editor.setAutocompleteProvider(
    new CombinedAutocompleteProvider(SLASH_COMMANDS, process.cwd()),
  );

  const ensureStatusText = () => {
    if (statusText) return;
    statusContainer.clear();
    statusLoader?.stop();
    statusLoader = null;
    statusText = new Text('', 1, 0);
    statusContainer.addChild(statusText);
  };

  const ensureStatusLoader = () => {
    if (statusLoader) return;
    statusContainer.clear();
    statusText = null;
    statusLoader = new Loader(
      tui,
      (spinner) => theme.accent(spinner),
      (text) => theme.bold(theme.accentSoft(text)),
      '',
    );
    statusContainer.addChild(statusLoader);
  };

  const updateHeader = () => {
    header.setText(
      theme.header(
        `FFT_nano TUI · ${opts.url || DEFAULT_GATEWAY_URL} · session ${sessionKey}`,
      ),
    );
  };

  const updateFooter = () => {
    const provider = sessionPrefs.provider || DEFAULT_PROVIDER;
    const model = sessionPrefs.model || DEFAULT_MODEL;
    const think = sessionPrefs.thinkLevel || 'off';
    const reasoning = sessionPrefs.reasoningLevel || 'off';
    footer.setText(
      theme.dim(
        [
          `${provider}/${model}`,
          `think=${think}`,
          `reasoning=${reasoning}`,
          `deliver=${deliver ? 'on' : 'off'}`,
          connectionStatus,
        ]
          .filter(Boolean)
          .join(' | '),
      ),
    );
  };

  const renderStatus = () => {
    const busy = ['sending', 'running'].includes(activityStatus);
    if (busy) {
      ensureStatusLoader();
      statusLoader?.setMessage(`${activityStatus} | ${connectionStatus}`);
      return;
    }
    ensureStatusText();
    statusText?.setText(theme.dim(`${connectionStatus} | ${activityStatus}`));
  };

  const setActivityStatus = (text: string) => {
    activityStatus = text;
    renderStatus();
  };

  const loadSessions = async () => {
    const res = await client.request<{ sessions: TuiSessionSummary[] }>('sessions.list', {});
    availableSessions = Array.isArray(res.sessions) ? res.sessions : [];
  };

  const findSession = (key: string): TuiSessionSummary | null => {
    return availableSessions.find((session) => session.sessionKey === key) || null;
  };

  const loadHistory = async (limit = 120) => {
    const res = await client.request<{
      sessionKey: string;
      messages: Array<{ role: string; text: string; timestamp: string }>;
    }>('chat.history', {
      sessionKey,
      limit,
    });

    chatLog.clearAll();
    for (const message of res.messages) {
      if (message.role === 'user') chatLog.addUser(message.text);
      else if (message.role === 'assistant') chatLog.finalizeAssistant(message.text);
      else chatLog.addSystem(message.text);
    }
  };

  const sendMessage = async (text: string): Promise<SendMessageStatus> => {
    if (activeRunId) {
      chatLog.addSystem('run already in progress; wait for completion or /abort before sending.');
      setActivityStatus('running');
      return 'busy';
    }

    setActivityStatus('sending');
    const res = await client.request<{ runId: string; status: string }>('chat.send', {
      sessionKey,
      message: text,
      deliver,
    });
    const runId = asString(res.runId) || null;
    const status = asString(res.status) || 'started';

    if (status === 'already_running') {
      if (runId) activeRunId = runId;
      chatLog.addSystem('run already in progress; message was not sent. Press Esc or /abort, then resend.');
      setActivityStatus('running');
      return 'busy';
    }

    activeRunId = runId;
    if (activeRunId) chatLog.updateAssistant('…', activeRunId);
    setActivityStatus('running');
    return 'sent';
  };

  const renderSessions = () => {
    if (!availableSessions.length) {
      chatLog.addSystem('No sessions available.');
      return;
    }
    const lines = [
      'sessions:',
      ...availableSessions.map((entry) => {
        const marker = entry.sessionKey === sessionKey ? '*' : '-';
        const mainLabel = entry.isMain ? ' (main)' : '';
        return `${marker} ${entry.sessionKey}${mainLabel} -> ${entry.name}`;
      }),
    ];
    chatLog.addSystem(lines.join('\n'));
  };

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) return;

    switch (name) {
      case 'help':
      case 'commands':
        chatLog.addSystem(helpText());
        break;

      case 'status': {
        const status = await client.request<{
          runtime?: string;
          connectedClients?: number;
          sessions?: number;
          activeRuns?: number;
        }>('status', {});
        chatLog.addSystem(
          [
            'status:',
            `- runtime: ${status.runtime || 'unknown'}`,
            `- connected_clients: ${status.connectedClients ?? 0}`,
            `- sessions: ${status.sessions ?? 0}`,
            `- active_runs: ${status.activeRuns ?? 0}`,
          ].join('\n'),
        );
        break;
      }

      case 'sessions':
        await loadSessions();
        renderSessions();
        break;

      case 'session':
        if (!args) {
          chatLog.addSystem(`current session: ${sessionKey}`);
          break;
        }
        await loadSessions();
        if (!findSession(args)) {
          chatLog.addSystem(`unknown session: ${args}`);
          renderSessions();
          break;
        }
        sessionKey = args;
        activeRunId = null;
        updateHeader();
        updateFooter();
        await loadHistory(120);
        break;

      case 'history': {
        const parsed = Number.parseInt(args || '120', 10);
        const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(400, parsed)) : 120;
        await loadHistory(limit);
        break;
      }

      case 'model': {
        if (!args) {
          chatLog.addSystem('usage: /model <provider/model|model>');
          break;
        }
        const slash = args.indexOf('/');
        if (slash > 0) {
          const provider = args.slice(0, slash).trim();
          const model = args.slice(slash + 1).trim();
          await client.request('sessions.patch', { sessionKey, provider, model });
          sessionPrefs.provider = provider;
          sessionPrefs.model = model;
        } else {
          await client.request('sessions.patch', { sessionKey, model: args });
          sessionPrefs.model = args;
        }
        updateFooter();
        break;
      }

      case 'think': {
        if (!args) {
          chatLog.addSystem('usage: /think <off|minimal|low|medium|high|xhigh>');
          break;
        }
        const normalized = normalizeThinkLevel(args);
        if (!normalized) {
          chatLog.addSystem('usage: /think <off|minimal|low|medium|high|xhigh>');
          break;
        }
        await client.request('sessions.patch', { sessionKey, thinkLevel: normalized });
        sessionPrefs.thinkLevel = normalized === 'off' ? undefined : normalized;
        updateFooter();
        break;
      }

      case 'reasoning': {
        if (!args) {
          chatLog.addSystem('usage: /reasoning <off|on|stream>');
          break;
        }
        const normalized = normalizeReasoningLevel(args);
        if (!normalized) {
          chatLog.addSystem('usage: /reasoning <off|on|stream>');
          break;
        }
        await client.request('sessions.patch', {
          sessionKey,
          reasoningLevel: normalized,
        });
        sessionPrefs.reasoningLevel = normalized === 'off' ? undefined : normalized;
        updateFooter();
        break;
      }

      case 'deliver': {
        if (!args) {
          chatLog.addSystem(`delivery: ${deliver ? 'on' : 'off'}`);
          break;
        }
        const value = args.trim().toLowerCase();
        if (!['on', 'off'].includes(value)) {
          chatLog.addSystem('usage: /deliver <on|off>');
          break;
        }
        deliver = value === 'on';
        updateFooter();
        chatLog.addSystem(`delivery set to ${deliver ? 'on' : 'off'}`);
        break;
      }

      case 'gateway': {
        const actionRaw = (args || 'status').trim().toLowerCase();
        const action =
          actionRaw === 'restart'
            ? 'restart'
            : actionRaw === 'status'
              ? 'status'
              : null;
        if (!action) {
          chatLog.addSystem('usage: /gateway <status|restart>');
          break;
        }

        if (action === 'restart') {
          chatLog.addSystem('Restarting gateway service. Expect disconnect while host restarts.');
        }
        const result = await client.request<{ ok: boolean; text: string }>('gateway.service', {
          action,
        });
        if (result.ok) {
          chatLog.addSystem(`gateway ${action}:\n${result.text}`);
        } else {
          chatLog.addSystem(`gateway ${action} failed:\n${result.text}`);
        }
        break;
      }

      case 'new':
      case 'reset':
        await client.request('sessions.reset', { sessionKey, reason: name });
        activeRunId = null;
        chatLog.clearAll();
        chatLog.addSystem('session reset');
        break;

      case 'abort':
        if (!activeRunId) {
          chatLog.addSystem('no active run');
          break;
        }
        await client.request('chat.abort', { sessionKey, runId: activeRunId });
        chatLog.addSystem('abort signal sent');
        break;

      case 'exit':
      case 'quit':
        client.close();
        tui.stop();
        process.exit(0);

      default:
        chatLog.addSystem(`unknown command: /${name}`);
    }
  };

  editor.onSubmit = (text: string) => {
    const value = text.trim();
    if (!value) return;

    if (value.startsWith('/')) {
      editor.setText('');
      void handleCommand(value)
        .catch((err) => {
          chatLog.addSystem(`error: ${err instanceof Error ? err.message : String(err)}`);
          setActivityStatus('error');
        })
        .finally(() => {
          tui.requestRender();
        });
      return;
    }

    void sendMessage(value)
      .then((status) => {
        if (status === 'sent') {
          editor.setText('');
          return;
        }
        editor.setText(value);
      })
      .catch((err) => {
        chatLog.addSystem(`error: ${err instanceof Error ? err.message : String(err)}`);
        setActivityStatus('error');
      })
      .finally(() => {
        tui.requestRender();
      });
  };

  editor.onEscape = () => {
    if (!activeRunId) return;
    void client
      .request('chat.abort', { sessionKey, runId: activeRunId })
      .catch(() => undefined)
      .finally(() => {
        tui.requestRender();
      });
  };

  editor.onCtrlC = () => {
    const now = Date.now();
    if (editor.getText().trim().length > 0) {
      editor.setText('');
      setActivityStatus('cleared input');
      tui.requestRender();
      return;
    }
    if (now - lastCtrlCAt < 1000) {
      client.close();
      tui.stop();
      process.exit(0);
    }
    lastCtrlCAt = now;
    setActivityStatus('press ctrl+c again to exit');
    tui.requestRender();
  };

  editor.onCtrlD = () => {
    client.close();
    tui.stop();
    process.exit(0);
  };

  editor.onCtrlT = () => {
    void handleCommand('/status').finally(() => tui.requestRender());
  };

  editor.onCtrlP = () => {
    void handleCommand('/sessions').finally(() => tui.requestRender());
  };

  await client.connect();
  await client.request('connect', { client: 'fft_nano_tui' });
  connectionStatus = 'connected';

  await loadSessions();
  const startupSession = resolveStartupSession(sessionKey, availableSessions);
  sessionKey = startupSession.sessionKey;

  updateHeader();
  updateFooter();
  renderStatus();
  if (startupSession.shouldLoadHistory) {
    await loadHistory(120);
  }

  chatLog.addSystem('Connected to FFT_nano gateway. Type /help for commands.');
  if (startupSession.infoMessage) {
    chatLog.addSystem(startupSession.infoMessage);
  }
  tui.start();
  tui.requestRender();

  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    process.once('exit', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  await runTuiClient(options);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
