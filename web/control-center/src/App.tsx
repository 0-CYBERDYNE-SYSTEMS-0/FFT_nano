import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { MarkdownLite } from './markdown';
import { OnboardingGate } from './onboarding';
import { useCollapse, useViewState } from './collapse';

type TabId =
  | 'overview'
  | 'chat'
  | 'sessions'
  | 'files'
  | 'setup'
  | 'system'
  | 'skills'
  | 'tasks'
  | 'pipelines'
  | 'memory'
  | 'knowledge'
  | 'logs';

interface RuntimeResponse {
  ok: boolean;
  serverTime: string;
  runtime: { runtime: string; sessions: number; activeRuns: number };
  profile: {
    profile: string;
    featureFarm: boolean;
    profileDetection: { source: string; reason: string };
  };
  build: {
    startedAt: string;
    version: string;
    branch?: string;
    commit?: string;
  };
  web: {
    accessMode: 'localhost' | 'lan' | 'remote';
    host: string;
    port: number;
    authRequired: boolean;
  };
  gateway: { host: string; port: number; authRequired: boolean; wsUrl: string };
}

interface ProviderSetup {
  id: string;
  label: string;
  piApi: string;
  defaultModel: string;
  apiKeyEnv: string;
  apiKeyRequired: boolean;
  endpointEnv?: string;
  signupUrl?: string;
  docsUrl?: string;
  localSetupUrl?: string;
  note?: string;
}

interface RuntimeSettings {
  providerPreset: string;
  provider: string;
  model: string;
  apiKeyEnv: string;
  apiKeyConfigured: boolean;
  endpointEnv?: string;
  endpointValue?: string;
  telegramBotConfigured: boolean;
  whatsappEnabled: boolean;
  heartbeatEnabled: boolean;
  heartbeatEvery: string;
}

interface SessionSummary {
  sessionKey: string;
  chatJid: string;
  name: string;
  isMain: boolean;
  lastActivity?: string;
}

interface SessionHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  runId?: string;
}

interface FileRootSummary {
  id: string;
  label: string;
}

interface SkillCatalogEntry {
  name: string;
  path: string;
  dir: string;
  description: string;
  rootId: string;
  rootLabel: string;
}

interface SkillCatalogGroup {
  root: FileRootSummary;
  skills: SkillCatalogEntry[];
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const TOKEN_KEY = 'fft_control_center.token';
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'chat', label: 'Chat' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'files', label: 'Files' },
  { id: 'setup', label: 'Setup' },
  { id: 'system', label: 'System' },
  { id: 'skills', label: 'Skills' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'logs', label: 'Logs' },
];

const THINK_LEVELS = ['unchanged', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const REASONING_LEVELS = ['unchanged', 'off', 'on', 'stream'] as const;

interface FileEntry {
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}

interface FileRootEntry {
  id: string;
  label: string;
}

function PanelHeader({
  title,
  collapse,
  actions,
}: {
  title: string;
  collapse?: { open: boolean; toggle: () => void };
  actions?: JSX.Element;
}): JSX.Element {
  return (
    <div className="panel-head">
      <h2 className="panel-head__title">{title}</h2>
      <div className="panel-head__actions">
        {actions}
        {collapse ? (
          <button
            type="button"
            className="panel-head__toggle"
            onClick={collapse.toggle}
            aria-expanded={collapse.open}
            aria-label={collapse.open ? `Collapse ${title}` : `Expand ${title}`}
            title={collapse.open ? 'Collapse' : 'Expand'}
          >
            {collapse.open ? '−' : '+'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function shortTime(input: string | number | undefined): string {
  if (!input) return '-';
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return String(input);
  return dt.toLocaleString();
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function summarizeAgentEvent(payload: unknown): string {
  const event = (payload || {}) as {
    sessionKey?: string;
    runId?: string;
    stream?: string;
    data?: Record<string, unknown>;
  };
  const session = event.sessionKey || '-';
  const run = event.runId || '-';
  const data = event.data || {};
  if (event.stream === 'progress') {
    return [
      'progress',
      session,
      run,
      String(data.phase || '-'),
      String(data.text || ''),
    ]
      .join(' ')
      .trim();
  }
  if (event.stream === 'tool') {
    return `tool ${session} ${run} ${String(data.toolName || '-')} ${String(data.status || '-')}`.trim();
  }
  if (event.stream === 'lifecycle') {
    return `lifecycle ${session} ${run} ${String(data.phase || '-')}`.trim();
  }
  return `agent ${asText(payload).slice(0, 300)}`;
}

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [tokenInput, setTokenInput] = useState(
    () => localStorage.getItem(TOKEN_KEY) || '',
  );
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || '',
  );
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [providers, setProviders] = useState<ProviderSetup[]>([]);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [models, setModels] = useState<
    Array<{ provider: string; model: string }>
  >([]);
  const [setupProvider, setSetupProvider] = useState('');
  const [setupModel, setSetupModel] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [setupEndpoint, setSetupEndpoint] = useState('');
  const [setupTelegramToken, setSetupTelegramToken] = useState('');
  const [setupStatus, setSetupStatus] = useState('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState('main');
  const [history, setHistory] = useState<SessionHistoryMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeRunId, setActiveRunId] = useState('');
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  const [systemPreview, setSystemPreview] = useState<unknown>(null);
  const [tasks, setTasks] = useState<unknown>(null);
  const [pipelines, setPipelines] = useState<unknown>(null);
  const [memory, setMemory] = useState<unknown>(null);
  const [knowledge, setKnowledge] = useState<Record<string, unknown> | null>(
    null,
  );
  const [knowledgeNote, setKnowledgeNote] = useState('');
  const [hostLogs, setHostLogs] = useState('');
  const [errorLogs, setErrorLogs] = useState('');
  const [skillGroups, setSkillGroups] = useState<SkillCatalogGroup[]>([]);
  const [skillStatus, setSkillStatus] = useState('');

  // Service + session controls
  const [prefsProvider, setPrefsProvider] = useState('');
  const [prefsModel, setPrefsModel] = useState('');
  const [prefsThink, setPrefsThink] = useState<(typeof THINK_LEVELS)[number]>('unchanged');
  const [prefsReasoning, setPrefsReasoning] = useState<(typeof REASONING_LEVELS)[number]>('unchanged');
  const [prefsStatus, setPrefsStatus] = useState('');
  const [serviceOutput, setServiceOutput] = useState('');
  const [prefsDirty, setPrefsDirty] = useState(false);

  // File editor
  const [fileRoots, setFileRoots] = useState<FileRootEntry[]>([]);
  const [activeRoot, setActiveRoot] = useState('');
  const [activeDir, setActiveDir] = useState('.');
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<{ root: string; path: string } | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [fileOriginal, setFileOriginal] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const [fileError, setFileError] = useState('');
  const [creatingPath, setCreatingPath] = useState('');

  // Collapsible state
  const overviewRuntime = useCollapse('overview.runtime', true);
  const overviewProfile = useCollapse('overview.profile', true);
  const overviewBuild = useCollapse('overview.build', false);
  const overviewGateway = useCollapse('overview.gateway', false);
  const overviewKnowledge = useCollapse('overview.knowledge', false);
  const chatSessionsPanel = useCollapse('chat.sessions', true);
  const chatComposerPanel = useCollapse('chat.composer', true);
  const chatServicePanel = useCollapse('chat.service', true);
  const chatEventsPanel = useCollapse('chat.events', true);
  const setupFormPanel = useCollapse('setup.form', true);
  const setupProvidersPanel = useCollapse('setup.providers', true);
  const systemPreviewPanel = useCollapse('system.preview', true);
  const systemReportPanel = useCollapse('system.report', false);
  const filesBrowserPanel = useCollapse('files.browser', true);
  const filesEditorPanel = useCollapse('files.editor', true);
  const skillsPanelState = useCollapse('skills.catalog', true);
  const tasksListPanel = useCollapse('tasks.list', true);
  const tasksJsonPanel = useCollapse('tasks.json', false);
  const knowledgeCapturePanel = useCollapse('knowledge.capture', true);
  const knowledgeCuratorPanel = useCollapse('knowledge.curator', false);
  const hostLogsPanel = useCollapse('logs.host', true);
  const errorLogsPanel = useCollapse('logs.error', true);
  const view = useViewState();

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const requestSeqRef = useRef(0);
  const activeSessionRef = useRef(activeSession);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const authHeaders = useMemo<Record<string, string>>(() => {
    if (!token) return {} as Record<string, string>;
    return { Authorization: `Bearer ${token}` } as Record<string, string>;
  }, [token]);

  const fetchJson = async <T,>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> => {
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), ...authHeaders },
    });
    if (!res.ok) throw new Error(`${url} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  };

  const appendEvent = (line: string) => {
    setEvents((prev) => [
      ...prev.slice(-199),
      `${new Date().toLocaleTimeString()} ${line}`,
    ]);
  };

  const refreshRuntime = async () => {
    try {
      const data = await fetchJson<RuntimeResponse>('/api/runtime/status');
      setRuntime(data);
      setRuntimeError('');
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  };

  const refreshSetup = async () => {
    const providerPayload = await fetchJson<{
      ok: boolean;
      providers: ProviderSetup[];
    }>('/api/settings/providers');
    const settingsPayload = await fetchJson<{
      ok: boolean;
      settings: RuntimeSettings;
    }>('/api/settings/runtime');
    setProviders(providerPayload.providers || []);
    setSettings(settingsPayload.settings);
    setSetupProvider(settingsPayload.settings.providerPreset);
    setSetupModel(settingsPayload.settings.model);
    setSetupEndpoint(settingsPayload.settings.endpointValue || '');
    const modelPayload = await fetchJson<{
      ok: boolean;
      models: Array<{ provider: string; model: string }>;
    }>('/api/settings/models').catch(() => ({ ok: false, models: [] }));
    setModels(modelPayload.models || []);
  };

  const refreshLogs = async () => {
    const host = await fetchJson<{ ok: boolean; content: string }>(
      '/api/logs/recent?target=host&lines=160',
    ).catch(() => ({ ok: false, content: '' }));
    const error = await fetchJson<{ ok: boolean; content: string }>(
      '/api/logs/recent?target=error&lines=160',
    ).catch(() => ({ ok: false, content: '' }));
    setHostLogs(host.content || '');
    setErrorLogs(error.content || '');
  };

  const refreshSkills = async () => {
    const payload = await fetchJson<{
      ok: boolean;
      groups?: SkillCatalogGroup[];
    }>('/api/skills/catalog');
    setSkillGroups(payload.groups || []);
  };

  const refreshAll = async () => {
    await Promise.all([
      refreshRuntime(),
      refreshSetup().catch((err) => setSetupStatus(String(err))),
      refreshLogs(),
      refreshSkills().catch((err) => setSkillStatus(String(err))),
      fetchJson<{ ok: boolean }>('/api/tasks')
        .then(setTasks)
        .catch(() => null),
      fetchJson<{ ok: boolean }>('/api/pipelines')
        .then(setPipelines)
        .catch(() => null),
      fetchJson<{ ok: boolean }>('/api/memory')
        .then(setMemory)
        .catch(() => null),
      fetchJson<Record<string, unknown>>('/api/knowledge')
        .then(setKnowledge)
        .catch(() => null),
    ]);
  };

  const wsRequest = <T,>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Gateway is not connected'));
    requestSeqRef.current += 1;
    const id = `req-${Date.now()}-${requestSeqRef.current}`;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        pendingRef.current.delete(id);
        reject(new Error(`Gateway request timed out: ${method}`));
      }, 8000);
      pendingRef.current.set(id, {
        resolve: (value) => {
          window.clearTimeout(timeout);
          resolve(value as T);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
    });
  };

  const loadSessions = async () => {
    const result = await wsRequest<{ sessions: SessionSummary[] }>(
      'sessions.list',
    );
    setSessions(result.sessions || []);
    if (
      !result.sessions?.some(
        (session) => session.sessionKey === activeSession,
      ) &&
      result.sessions?.[0]
    ) {
      setActiveSession(result.sessions[0].sessionKey);
    }
  };

  const loadHistory = async (sessionKey: string) => {
    const result = await wsRequest<{ messages: SessionHistoryMessage[] }>(
      'chat.history',
      { sessionKey, limit: 160 },
    );
    setHistory(result.messages || []);
  };

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      void refreshRuntime();
      void refreshLogs();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!runtime) return;
    const ws = new WebSocket(runtime.gateway.wsUrl);
    wsRef.current = ws;
    const rejectAll = (message: string) => {
      for (const pending of pendingRef.current.values())
        pending.reject(new Error(message));
      pendingRef.current.clear();
    };
    ws.onopen = async () => {
      try {
        await wsRequest('connect', {
          client: 'fft_control_center',
          token: token || undefined,
        });
        setGatewayConnected(true);
        appendEvent('gateway connected');
        await loadSessions();
      } catch (err) {
        appendEvent(`gateway connect failed: ${asText(err)}`);
      }
    };
    ws.onclose = (event) => {
      setGatewayConnected(false);
      rejectAll(`Gateway closed (${event.code})`);
      appendEvent(`gateway disconnected (${event.code})`);
    };
    ws.onerror = () => appendEvent('gateway websocket error');
    ws.onmessage = (event) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof parsed.id === 'string' && typeof parsed.ok === 'boolean') {
        const pending = pendingRef.current.get(parsed.id);
        if (!pending) return;
        pendingRef.current.delete(parsed.id);
        if (parsed.ok) pending.resolve(parsed.result);
        else
          pending.reject(
            new Error(String(parsed.error || 'Unknown gateway error')),
          );
        return;
      }
      if (parsed.event === 'chat_event') {
        const payload = (parsed.payload || {}) as {
          runId?: string;
          sessionKey?: string;
          state?: string;
          message?: { role?: string; content?: string };
          errorMessage?: string;
        };
        appendEvent(
          `chat ${payload.sessionKey || '-'} ${payload.state || '-'}`,
        );
        if (payload.sessionKey !== activeSessionRef.current) return;
        if (payload.state === 'message' && payload.message) {
          setHistory((prev) => [
            ...prev,
            {
              role:
                payload.message?.role === 'user'
                  ? 'user'
                  : payload.message?.role === 'system'
                    ? 'system'
                    : 'assistant',
              text: payload.message?.content || '',
              timestamp: new Date().toISOString(),
              runId: payload.runId,
            },
          ]);
        }
        if (
          (payload.state === 'delta' || payload.state === 'final') &&
          payload.message?.role === 'assistant'
        ) {
          setActiveRunId(payload.runId || '');
          setHistory((prev) => {
            const idx = prev.findIndex(
              (msg) => msg.runId === payload.runId && msg.role === 'assistant',
            );
            const nextMessage = {
              role: 'assistant' as const,
              text: payload.message?.content || '',
              timestamp: new Date().toISOString(),
              runId: payload.runId,
            };
            if (idx === -1) return [...prev, nextMessage];
            const next = [...prev];
            next[idx] = nextMessage;
            return next;
          });
        }
        if (['final', 'aborted', 'error'].includes(payload.state || ''))
          setActiveRunId('');
        return;
      }
      if (parsed.event === 'agent_event') {
        appendEvent(summarizeAgentEvent(parsed.payload));
      }
    };
    return () => {
      ws.close();
      wsRef.current = null;
      rejectAll('Gateway connection reset');
    };
  }, [runtime?.gateway.wsUrl, token]);

  useEffect(() => {
    if (gatewayConnected) void loadHistory(activeSession);
  }, [activeSession, gatewayConnected]);

  const applyToken = () => {
    const next = tokenInput.trim();
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(next);
  };

  const sendChat = async () => {
    const message = chatInput.trim();
    if (!message) return;
    const result = await wsRequest<{ runId: string; status: string }>(
      'chat.send',
      {
        sessionKey: activeSession,
        message,
        deliver: false,
      },
    );
    setActiveRunId(result.runId);
    setChatInput('');
    appendEvent(`chat.send ${result.status} ${result.runId}`);
  };

  const saveSetup = async () => {
    setSetupStatus('Saving settings...');
    const payload = {
      providerPreset: setupProvider,
      model: setupModel,
      apiKey: setupKey,
      endpoint: setupEndpoint,
      clearEndpoint:
        setupEndpoint.trim() === '' &&
        !['ollama', 'lm-studio'].includes(setupProvider),
      telegramBotToken: setupTelegramToken,
    };
    const result = await fetchJson<{
      ok: boolean;
      requiresRestart: boolean;
      adminSecret?: string;
    }>('/api/settings/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSetupKey('');
    setSetupTelegramToken('');
    setSetupStatus(
      result.adminSecret
        ? `Saved. Restart the host for service/env changes.\n\nAdmin secret: ${result.adminSecret}\nIn Telegram DM: /main ${result.adminSecret}`
        : result.requiresRestart
          ? 'Saved. Restart the host for service/env changes.'
          : 'Saved.',
    );
    await refreshSetup();
  };

  const loadSystemPreview = async () => {
    const payload = await fetchJson<{ ok: boolean; preview: unknown }>(
      `/api/system-prompt?sessionKey=${encodeURIComponent(activeSession)}&mode=normal`,
    );
    setSystemPreview(payload.preview);
  };

  const runTaskAction = async (id: string, action: string) => {
    await fetchJson('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    });
    const next = await fetchJson<{ ok: boolean }>('/api/tasks');
    setTasks(next);
  };

  const captureKnowledge = async () => {
    await fetchJson('/api/knowledge/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: knowledgeNote, source: 'control-center' }),
    });
    setKnowledgeNote('');
    setKnowledge(await fetchJson<Record<string, unknown>>('/api/knowledge'));
  };

  const refreshFileRoots = async () => {
    const res = await fetchJson<{ ok: boolean; roots: FileRootEntry[] }>(
      '/api/files/roots',
    );
    setFileRoots(res.roots || []);
    if (!activeRoot && res.roots?.[0]) {
      setActiveRoot(res.roots[0].id);
    }
  };

  const refreshFileTree = async (rootId: string, dirPath: string) => {
    if (!rootId) {
      setFileEntries([]);
      return;
    }
    try {
      const res = await fetchJson<{
        ok: boolean;
        entries: FileEntry[];
      }>(
        `/api/files/tree?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(dirPath)}`,
      );
      setFileEntries(res.entries || []);
      setFileError('');
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
      setFileEntries([]);
    }
  };

  const openFile = async (rootId: string, filePath: string) => {
    if (fileContent !== fileOriginal && fileOriginal) {
      const ok = window.confirm(
        'Discard unsaved changes to the current file?',
      );
      if (!ok) return;
    }
    setFileStatus('Loading…');
    try {
      const res = await fetchJson<{
        ok: boolean;
        content: string;
        path: string;
      }>(
        `/api/files/read?root=${encodeURIComponent(rootId)}&path=${encodeURIComponent(filePath)}`,
      );
      setActiveFile({ root: rootId, path: filePath });
      setFileContent(res.content || '');
      setFileOriginal(res.content || '');
      setFileStatus('Loaded.');
      setFileError('');
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
      setFileStatus('Failed to load.');
    }
  };

  const saveFile = async () => {
    if (!activeFile) return;
    setFileStatus('Saving…');
    try {
      await fetchJson('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: activeFile.root,
          path: activeFile.path,
          content: fileContent,
        }),
      });
      setFileOriginal(fileContent);
      setFileStatus('Saved.');
      setFileError('');
      await refreshFileTree(activeRoot, activeDir);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
      setFileStatus('Save failed.');
    }
  };

  const createFile = async () => {
    const path = creatingPath.trim();
    if (!path || !activeRoot) return;
    setFileStatus('Creating…');
    try {
      await fetchJson('/api/files/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root: activeRoot, path, content: '' }),
      });
      setCreatingPath('');
      setFileStatus('Created.');
      setFileError('');
      await refreshFileTree(activeRoot, activeDir);
      await openFile(activeRoot, path);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : String(err));
      setFileStatus('Create failed.');
    }
  };

  const navigateDir = async (next: string) => {
    setActiveDir(next);
    await refreshFileTree(activeRoot, next);
  };

  // Service + session prefs
  const applySessionPrefs = async () => {
    setPrefsStatus('Applying…');
    const patch: Record<string, unknown> = {};
    if (prefsProvider) patch.provider = prefsProvider;
    if (prefsModel) patch.model = prefsModel;
    if (prefsThink !== 'unchanged') patch.thinkLevel = prefsThink;
    if (prefsReasoning !== 'unchanged') patch.reasoningLevel = prefsReasoning;
    if (Object.keys(patch).length === 0) {
      setPrefsStatus('Nothing to apply.');
      return;
    }
    try {
      await wsRequest<unknown>('sessions.patch', {
        sessionKey: activeSession,
        ...patch,
      });
      setPrefsStatus('Applied.');
      setPrefsDirty(false);
      appendEvent(`sessions.patch ${activeSession}`);
    } catch (err) {
      setPrefsStatus(`Failed: ${asText(err)}`);
    }
  };

  const resetSession = async () => {
    setPrefsStatus('Resetting session…');
    try {
      await wsRequest<unknown>('sessions.reset', {
        sessionKey: activeSession,
        reason: 'control-center',
      });
      setPrefsStatus('Session reset. Reload to see new history.');
      setHistory([]);
    } catch (err) {
      setPrefsStatus(`Failed: ${asText(err)}`);
    }
  };

  const runServiceAction = async (action: 'status' | 'doctor' | 'restart') => {
    setServiceOutput(`Running ${action}…`);
    try {
      const result = await wsRequest<{ ok: boolean; text: string }>(
        'service.gateway',
        { action },
      );
      setServiceOutput(
        `${action}\n${'-'.repeat(40)}\n${result?.text || '(no output)'}`,
      );
    } catch (err) {
      setServiceOutput(`${action}\n${'-'.repeat(40)}\nERROR: ${asText(err)}`);
    }
  };

  // File tree refresh when active root/dir change
  useEffect(() => {
    if (activeRoot) {
      void refreshFileTree(activeRoot, activeDir);
    }
  }, [activeRoot, activeDir]);

  useEffect(() => {
    if (fileRoots.length === 0) {
      void refreshFileRoots();
    }
  }, [fileRoots.length]);

  const activeProvider = providers.find(
    (provider) => provider.id === setupProvider,
  );
  const providerModels = models.filter(
    (entry) => entry.provider === activeProvider?.piApi,
  );
  const taskList =
    (tasks as { tasks?: Array<Record<string, unknown>> } | null)?.tasks || [];
  const knowledgeRecord = knowledge || {};
  const knowledgeStatus = knowledgeRecord.status as
    | {
        ready?: boolean;
        rawCaptureCount?: number;
        wikiDocCount?: number;
        lastRawCaptureAt?: string;
        lastProgressUpdateAt?: string;
      }
    | undefined;
  const knowledgeWiki = knowledgeRecord.wiki as
    | { index?: string; progress?: string; log?: string }
    | undefined;

  return (
    <OnboardingGate token={token}>
      <div className={`app app--${view.layout}${view.chatFocus ? ' app--chat-focus' : ''}`}>
        <header className="masthead panel">
          <div className="masthead__title">
            <h1>FFT CONTROL CENTER</h1>
            <p>
              {gatewayConnected ? 'gateway online' : 'gateway offline'} ·{' '}
              {runtime?.runtime.runtime || 'runtime unknown'}
              {activeRunId ? ' · run in progress' : ''}
            </p>
          </div>
          <div className="masthead__view">
            <span className="masthead__view-label">View</span>
            <button
              type="button"
              className={view.layout === 'dock' ? 'active' : ''}
              onClick={() => view.setLayout('dock')}
              title="Side-by-side dock layout"
            >
              Dock
            </button>
            <button
              type="button"
              className={view.layout === 'stacked' ? 'active' : ''}
              onClick={() => view.setLayout('stacked')}
              title="Stacked layout, full-width chat"
            >
              Stacked
            </button>
            <label className="masthead__focus">
              <input
                type="checkbox"
                checked={view.chatFocus}
                onChange={(event) => view.setChatFocus(event.target.checked)}
              />
              <span>Chat focus</span>
            </label>
          </div>
          <div className="token-control">
            <label htmlFor="token">Token</label>
            <input
              id="token"
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Bearer token"
            />
            <button type="button" onClick={applyToken}>
              Apply
            </button>
            <button type="button" onClick={() => void refreshAll()}>
              Refresh
            </button>
          </div>
        </header>

        {runtimeError ? <div className="error panel">{runtimeError}</div> : null}

      <nav className="tabbar panel">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' ? (
        <section className="grid status-grid">
          <article
            className={`panel stat${overviewRuntime.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Runtime" collapse={overviewRuntime} />
            {overviewRuntime.open ? (
              <>
                <div className="stat-value">{runtime?.runtime.runtime || '-'}</div>
                <p>sessions {runtime?.runtime.sessions ?? 0}</p>
                <p>active runs {runtime?.runtime.activeRuns ?? 0}</p>
              </>
            ) : null}
          </article>
          <article
            className={`panel stat${overviewProfile.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Profile" collapse={overviewProfile} />
            {overviewProfile.open ? (
              <>
                <div className="stat-value">{runtime?.profile.profile || '-'}</div>
                <p>farm {runtime?.profile.featureFarm ? 'on' : 'off'}</p>
                <p>{runtime?.profile.profileDetection.source || '-'}</p>
              </>
            ) : null}
          </article>
          <article
            className={`panel stat${overviewBuild.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Build" collapse={overviewBuild} />
            {overviewBuild.open ? (
              <>
                <div className="stat-value">
                  {runtime?.build.version || '-'}
                </div>
                <p>{runtime?.build.branch || '-'}</p>
                <p>{runtime?.build.commit?.slice(0, 7) || '-'}</p>
              </>
            ) : null}
          </article>
          <article
            className={`panel stat${overviewGateway.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Gateway" collapse={overviewGateway} />
            {overviewGateway.open ? (
              <>
                <div className="stat-value">
                  {runtime?.gateway.host || '-'}
                </div>
                <p>port {runtime?.gateway.port || '-'}</p>
                <p>auth {runtime?.gateway.authRequired ? 'required' : 'none'}</p>
              </>
            ) : null}
          </article>
          <article
            className={`panel stat${overviewKnowledge.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Knowledge" collapse={overviewKnowledge} />
            {overviewKnowledge.open ? (
              <>
                <div className="stat-value">
                  {knowledgeStatus?.ready ? 'ready' : 'check'}
                </div>
                <p>raw {knowledgeStatus?.rawCaptureCount ?? 0}</p>
                <p>wiki docs {knowledgeStatus?.wikiDocCount ?? 0}</p>
              </>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'chat' || activeTab === 'sessions' ? (
        <section className="grid main-grid">
          <article
            className={`panel sessions-panel${chatSessionsPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Sessions"
              collapse={chatSessionsPanel}
              actions={
                <button
                  type="button"
                  onClick={() => void loadSessions()}
                  title="Reload sessions from gateway"
                >
                  Reload
                </button>
              }
            />
            {chatSessionsPanel.open ? (
              <div className="scroll-block">
                {sessions.length === 0 ? (
                  <p className="empty-state">
                    No sessions loaded. Reload after the gateway connects.
                  </p>
                ) : (
                  sessions.map((session) => (
                    <button
                      key={session.sessionKey}
                      type="button"
                      className={`session-item ${activeSession === session.sessionKey ? 'active' : ''}`}
                      onClick={() => setActiveSession(session.sessionKey)}
                    >
                      <strong>{session.sessionKey}</strong>
                      <span>{session.name}</span>
                      <span>{shortTime(session.lastActivity)}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </article>
          <article
            className={`panel chat-panel${chatComposerPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title={`Live Chat · ${activeSession}`}
              collapse={chatComposerPanel}
              actions={
                <button
                  type="button"
                  onClick={() => void loadHistory(activeSession)}
                  title="Reload history"
                >
                  Reload
                </button>
              }
            />
            {chatComposerPanel.open ? (
              <>
                <div className="scroll-block history">
                  {history.length === 0 ? (
                    <p className="empty-state">
                      No messages yet. Send a prompt to start a run.
                    </p>
                  ) : (
                    history.map((msg, index) => {
                      const isStreaming =
                        !!activeRunId &&
                        msg.role === 'assistant' &&
                        msg.runId === activeRunId;
                      return (
                        <div
                          key={`${msg.timestamp}-${index}`}
                          className={`message ${msg.role}${isStreaming ? ' message--streaming' : ''}`}
                        >
                          <div className="message-meta-row">
                            <span className="meta">{msg.role}</span>
                            <span className="meta-time">
                              {shortTime(msg.timestamp)}
                              {msg.runId ? ` · ${msg.runId.slice(0, 8)}` : ''}
                            </span>
                          </div>
                          {msg.role === 'assistant' ? (
                            <MarkdownLite text={msg.text} />
                          ) : (
                            <pre className="message-content">{msg.text}</pre>
                          )}
                          {isStreaming ? (
                            <span className="streaming-caret" aria-hidden="true">
                              ▍
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="composer">
                  <textarea
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Type a run prompt..."
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault();
                        void sendChat();
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <button
                      type="button"
                      onClick={() => void sendChat()}
                      disabled={!chatInput.trim()}
                    >
                      Send
                    </button>
                    <button
                      type="button"
                      disabled={!activeRunId}
                      onClick={() =>
                        void wsRequest('chat.abort', {
                          sessionKey: activeSession,
                          runId: activeRunId,
                        })
                      }
                    >
                      Abort
                    </button>
                    <span className="composer-hint">⌘+Enter to send</span>
                  </div>
                </div>
              </>
            ) : null}
          </article>
          <div className="service-column">
            <article
              className={`panel service-panel${chatServicePanel.open ? '' : ' panel--collapsed'}`}
            >
              <PanelHeader
                title="Service + Session Controls"
                collapse={chatServicePanel}
              />
              {chatServicePanel.open ? (
                <div className="service-controls">
                  <p className="files-path">
                    {gatewayConnected
                      ? `gateway online · ${activeSession}`
                      : 'gateway offline — prefs will queue once connected'}
                  </p>
                  <div className="service-controls__grid">
                    <label className="field">
                      <span>Provider override</span>
                      <select
                        value={prefsProvider}
                        onChange={(event) => {
                          setPrefsProvider(event.target.value);
                          setPrefsDirty(true);
                        }}
                      >
                        <option value="">(unchanged)</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Model override</span>
                      <input
                        list="prefs-model-options"
                        value={prefsModel}
                        onChange={(event) => {
                          setPrefsModel(event.target.value);
                          setPrefsDirty(true);
                        }}
                        placeholder="(unchanged)"
                      />
                      <datalist id="prefs-model-options">
                        {providerModels.map((entry) => (
                          <option
                            key={`${entry.provider}:${entry.model}`}
                            value={entry.model}
                          />
                        ))}
                      </datalist>
                    </label>
                    <label className="field">
                      <span>Think</span>
                      <select
                        value={prefsThink}
                        onChange={(event) => {
                          setPrefsThink(
                            event.target.value as (typeof THINK_LEVELS)[number],
                          );
                          setPrefsDirty(true);
                        }}
                      >
                        {THINK_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Reasoning</span>
                      <select
                        value={prefsReasoning}
                        onChange={(event) => {
                          setPrefsReasoning(
                            event.target.value as (typeof REASONING_LEVELS)[number],
                          );
                          setPrefsDirty(true);
                        }}
                      >
                        {REASONING_LEVELS.map((lvl) => (
                          <option key={lvl} value={lvl}>
                            {lvl}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="composer-actions">
                    <button
                      type="button"
                      onClick={() => void applySessionPrefs()}
                      disabled={!prefsDirty || !gatewayConnected}
                    >
                      Apply Prefs
                    </button>
                    <button
                      type="button"
                      onClick={() => void resetSession()}
                      disabled={!gatewayConnected}
                    >
                      Reset Session
                    </button>
                    <button
                      type="button"
                      onClick={() => void runServiceAction('status')}
                      disabled={!gatewayConnected}
                    >
                      Status
                    </button>
                    <button
                      type="button"
                      onClick={() => void runServiceAction('doctor')}
                      disabled={!gatewayConnected}
                    >
                      Doctor
                    </button>
                    <button
                      type="button"
                      onClick={() => void runServiceAction('restart')}
                      disabled={!gatewayConnected}
                    >
                      Restart
                    </button>
                  </div>
                  {prefsStatus ? (
                    <p className="files-path">{prefsStatus}</p>
                  ) : null}
                  {serviceOutput ? (
                    <pre className="service-output">{serviceOutput}</pre>
                  ) : null}
                </div>
              ) : null}
            </article>
            <article
              className={`panel events-panel${chatEventsPanel.open ? '' : ' panel--collapsed'}`}
            >
              <PanelHeader
                title={`Events (${events.length})`}
                collapse={chatEventsPanel}
                actions={
                  <button
                    type="button"
                    onClick={() => setEvents([])}
                    title="Clear event list"
                  >
                    Clear
                  </button>
                }
              />
              {chatEventsPanel.open ? (
                <pre className="service-output">
                  {events.join('\n') || 'No events yet.'}
                </pre>
              ) : null}
            </article>
          </div>
        </section>
      ) : null}

      {activeTab === 'setup' ? (
        <section className="grid setup-grid">
          <article
            className={`panel${setupFormPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Provider + Model" collapse={setupFormPanel} />
            {setupFormPanel.open ? (
              <>
                <label className="field">
                  <span>Provider</span>
                  <select
                    value={setupProvider}
                    onChange={(event) => setSetupProvider(event.target.value)}
                  >
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Model</span>
                  <input
                    list="model-options"
                    value={setupModel}
                    onChange={(event) => setSetupModel(event.target.value)}
                    placeholder={activeProvider?.defaultModel || 'model id'}
                  />
                </label>
                <datalist id="model-options">
                  {providerModels.map((entry) => (
                    <option
                      key={`${entry.provider}:${entry.model}`}
                      value={entry.model}
                    />
                  ))}
                </datalist>
                <label className="field">
                  <span>
                    API Key (
                    {activeProvider?.apiKeyEnv ||
                      settings?.apiKeyEnv ||
                      'PI_API_KEY'}
                    )
                  </span>
                  <input
                    type="password"
                    value={setupKey}
                    onChange={(event) => setSetupKey(event.target.value)}
                    placeholder={
                      settings?.apiKeyConfigured
                        ? 'already set; enter a new key to replace'
                        : 'paste API key'
                    }
                  />
                </label>
                <label className="field">
                  <span>Endpoint</span>
                  <input
                    value={setupEndpoint}
                    onChange={(event) => setSetupEndpoint(event.target.value)}
                    placeholder="provider default or local endpoint"
                  />
                </label>
                <label className="field">
                  <span>Telegram Bot Token</span>
                  <input
                    type="password"
                    value={setupTelegramToken}
                    onChange={(event) => setSetupTelegramToken(event.target.value)}
                    placeholder={
                      settings?.telegramBotConfigured
                        ? 'already set; enter a new token to replace'
                        : 'paste token from BotFather'
                    }
                  />
                </label>
                <div className="composer-actions">
                  <button type="button" onClick={() => void saveSetup()}>
                    Save Settings
                  </button>
                  <button type="button" onClick={() => void refreshSetup()}>
                    Reload
                  </button>
                </div>
                <pre className="service-output">
                  {setupStatus ||
                    `Provider key: ${settings?.apiKeyConfigured ? 'set' : 'missing'}\nTelegram token: ${settings?.telegramBotConfigured ? 'set' : 'missing'}`}
                </pre>
              </>
            ) : null}
          </article>
          <article
            className={`panel${setupProvidersPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Get API Keys" collapse={setupProvidersPanel} />
            {setupProvidersPanel.open ? (
              <div className="provider-list">
                {providers.map((provider) => (
                  <div key={provider.id} className="provider-card">
                    <strong>{provider.label}</strong>
                    <span>
                      {provider.apiKeyRequired
                        ? provider.apiKeyEnv
                        : 'local/no hosted key required'}
                    </span>
                    <span>{provider.note || provider.defaultModel}</span>
                    <div className="inline-links">
                      {provider.signupUrl ? (
                        <a
                          href={provider.signupUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          API keys
                        </a>
                      ) : null}
                      {provider.localSetupUrl ? (
                        <a
                          href={provider.localSetupUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Install
                        </a>
                      ) : null}
                      {provider.docsUrl ? (
                        <a
                          href={provider.docsUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Docs
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'files' ? (
        <section className="grid files-grid">
          <article
            className={`panel files-browser${filesBrowserPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Workspace + Skills Files"
              collapse={filesBrowserPanel}
              actions={
                <button
                  type="button"
                  onClick={() => void refreshFileRoots()}
                  title="Reload file roots"
                >
                  Roots
                </button>
              }
            />
            {filesBrowserPanel.open ? (
              <>
                <div className="files-toolbar">
                  <select
                    value={activeRoot}
                    onChange={(event) => {
                      setActiveRoot(event.target.value);
                      setActiveDir('.');
                      setActiveFile(null);
                    }}
                  >
                    <option value="">— root —</option>
                    {fileRoots.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void navigateDir('.')}
                    title="Root of selected workspace"
                  >
                    ROOT
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const parent =
                        activeDir === '.' || !activeDir.includes('/')
                          ? '.'
                          : activeDir.split('/').slice(0, -1).join('/') || '.';
                      void navigateDir(parent);
                    }}
                    title="Up one level"
                  >
                    UP
                  </button>
                </div>
                <div className="breadcrumb-row">
                  <button
                    type="button"
                    onClick={() => void navigateDir('.')}
                  >
                    {activeRoot || '— root —'}
                  </button>
                  {activeDir !== '.' && activeDir !== ''
                    ? activeDir.split('/').map((part, idx, arr) => {
                        const next = arr.slice(0, idx + 1).join('/');
                        return (
                          <button
                            key={`${part}-${idx}`}
                            type="button"
                            onClick={() => void navigateDir(next)}
                          >
                            {part}
                          </button>
                        );
                      })
                    : null}
                </div>
                <input
                  type="text"
                  value={fileFilter}
                  onChange={(event) => setFileFilter(event.target.value)}
                  placeholder="filter current folder"
                  className="files-filter"
                />
                <div className="inline-action">
                  <input
                    type="text"
                    value={creatingPath}
                    onChange={(event) => setCreatingPath(event.target.value)}
                    placeholder="relative path, e.g. skills/new/SKILL.md"
                  />
                  <button
                    type="button"
                    onClick={() => void createFile()}
                    disabled={!creatingPath.trim() || !activeRoot}
                  >
                    Create
                  </button>
                </div>
                <div className="scroll-block">
                  {fileError ? (
                    <p className="empty-state">{fileError}</p>
                  ) : fileEntries.length === 0 ? (
                    <p className="empty-state">No entries.</p>
                  ) : (
                    fileEntries
                      .filter((entry) =>
                        fileFilter.trim()
                          ? entry.name
                              .toLowerCase()
                              .includes(fileFilter.toLowerCase())
                          : true,
                      )
                      .map((entry) => (
                        <button
                          key={entry.relPath}
                          type="button"
                          className={`file-item ${entry.kind}${
                            activeFile &&
                            activeFile.path === entry.relPath &&
                            activeFile.root === activeRoot
                              ? ' active'
                              : ''
                          }`}
                          onClick={() => {
                            if (entry.kind === 'dir') {
                              const next =
                                activeDir === '.'
                                  ? entry.relPath
                                  : `${activeDir}/${entry.relPath}`;
                              void navigateDir(next);
                            } else {
                              const path =
                                activeDir === '.'
                                  ? entry.relPath
                                  : `${activeDir}/${entry.relPath}`;
                              void openFile(activeRoot, path);
                            }
                          }}
                        >
                          <strong>{entry.kind === 'dir' ? `${entry.name}/` : entry.name}</strong>
                          <span className="file-meta">
                            {entry.size} bytes · {shortTime(entry.modifiedAt)}
                          </span>
                        </button>
                      ))
                  )}
                </div>
                {fileStatus ? <p className="files-path">{fileStatus}</p> : null}
              </>
            ) : null}
          </article>
          <article
            className={`panel file-editor${filesEditorPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title={
                activeFile
                  ? `Editor · ${activeFile.path}`
                  : 'Editor'
              }
              collapse={filesEditorPanel}
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeFile) void openFile(activeFile.root, activeFile.path);
                    }}
                    disabled={!activeFile}
                    title="Re-read from disk (discard local changes)"
                  >
                    Reload
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveFile()}
                    disabled={!activeFile || fileContent === fileOriginal}
                    title="Write changes to disk"
                  >
                    Save
                  </button>
                </>
              }
            />
            {filesEditorPanel.open ? (
              activeFile ? (
                <>
                  <p className="files-path">
                    {activeFile.root}:{activeFile.path}
                    {fileContent !== fileOriginal ? ' · unsaved changes' : ' · saved'}
                  </p>
                  <textarea
                    className="editor-area"
                    value={fileContent}
                    onChange={(event) => setFileContent(event.target.value)}
                    spellCheck={false}
                  />
                </>
              ) : (
                <p className="empty-state">
                  Select a file in the browser to edit it.
                </p>
              )
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="grid system-grid">
          <article
            className={`panel${systemPreviewPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Composed System Prompt"
              collapse={systemPreviewPanel}
              actions={
                <button type="button" onClick={() => void loadSystemPreview()}>
                  Load Preview
                </button>
              }
            />
            {systemPreviewPanel.open ? (
              <>
                <p className="files-path">
                  Preview only. It does not store or send another system message.
                </p>
                <pre className="system-preview">
                  {(systemPreview as { text?: string } | null)?.text ||
                    'No preview loaded.'}
                </pre>
              </>
            ) : null}
          </article>
          <article
            className={`panel${systemReportPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Report" collapse={systemReportPanel} />
            {systemReportPanel.open ? (
              <pre className="service-output">
                {JSON.stringify(
                  (systemPreview as { report?: unknown } | null)?.report || {},
                  null,
                  2,
                )}
              </pre>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'skills' ? (
        <section className="grid skills-grid">
          <article
            className={`panel${skillsPanelState.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Skills Catalog"
              collapse={skillsPanelState}
              actions={
                <>
                  <button type="button" onClick={() => void refreshSkills()}>
                    Refresh
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void fetchJson('/api/skills/validate', {
                        method: 'POST',
                      }).then((r) => setSkillStatus(JSON.stringify(r, null, 2)))
                    }
                  >
                    Validate
                  </button>
                </>
              }
            />
            {skillsPanelState.open ? (
              <>
                <input
                  type="text"
                  placeholder="filter by name, path, description"
                  onChange={(event) => {
                    const q = event.target.value;
                    if (!q) {
                      void refreshSkills();
                      return;
                    }
                    setSkillGroups((prev) =>
                      prev.map((group) => ({
                        ...group,
                        skills: group.skills.filter((skill) =>
                          `${skill.name} ${skill.path} ${skill.description}`
                            .toLowerCase()
                            .includes(q.toLowerCase()),
                        ),
                      })),
                    );
                  }}
                />
                <div className="scroll-block skills-scroll">
                  {skillGroups.map((group) => (
                    <details key={group.root.id} open>
                      <summary>
                        <strong>{group.root.label}</strong>{' '}
                        <span>{group.skills.length}</span>
                      </summary>
                      {group.skills.map((skill) => (
                        <div
                          className="skill-item"
                          key={`${group.root.id}:${skill.path}`}
                        >
                          <div>
                            <p className="skill-title">{skill.name}</p>
                            <p className="files-path">{skill.path}</p>
                            <p>{skill.description || 'No description.'}</p>
                          </div>
                        </div>
                      ))}
                    </details>
                  ))}
                </div>
                <pre className="service-output">
                  {skillStatus ||
                    'Use the Files tab to edit a SKILL.md. Catalog is read-only.'}
                </pre>
              </>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'tasks' ? (
        <section className="grid tasks-grid">
          <article
            className={`panel${tasksListPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Scheduled Tasks"
              collapse={tasksListPanel}
              actions={
                <button
                  type="button"
                  onClick={() =>
                    void fetchJson<{ ok: boolean }>('/api/tasks').then(setTasks)
                  }
                >
                  Refresh
                </button>
              }
            />
            {tasksListPanel.open ? (
              <div className="scroll-block">
                {taskList.length === 0 ? (
                  <p className="empty-state">No scheduled tasks.</p>
                ) : (
                  taskList.map((task) => (
                    <div className="task-row" key={String(task.id)}>
                      <strong>{String(task.id)}</strong>
                      <span>
                        {String(task.status)} · next{' '}
                        {shortTime(String(task.next_run || ''))}
                      </span>
                      <span>
                        {String(task.schedule_type)} {String(task.schedule_value)}
                      </span>
                      <div className="composer-actions">
                        <button
                          onClick={() =>
                            void runTaskAction(String(task.id), 'trigger')
                          }
                        >
                          Trigger
                        </button>
                        <button
                          onClick={() =>
                            void runTaskAction(String(task.id), 'pause')
                          }
                        >
                          Pause
                        </button>
                        <button
                          onClick={() =>
                            void runTaskAction(String(task.id), 'resume')
                          }
                        >
                          Resume
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </article>
          <article
            className={`panel${tasksJsonPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Task JSON" collapse={tasksJsonPanel} />
            {tasksJsonPanel.open ? (
              <pre className="service-output">
                {JSON.stringify(tasks, null, 2)}
              </pre>
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'pipelines' ? (
        <section className="panel">
          <h2>Pipelines</h2>
          <pre className="service-output">
            {JSON.stringify(pipelines, null, 2)}
          </pre>
        </section>
      ) : null}
      {activeTab === 'memory' ? (
        <section className="panel">
          <h2>Memory + Canonical Files</h2>
          <pre className="service-output">
            {JSON.stringify(memory, null, 2)}
          </pre>
        </section>
      ) : null}

      {activeTab === 'knowledge' ? (
        <section className="grid knowledge-grid">
          <article
            className={`panel${knowledgeCapturePanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Knowledge Wiki"
              collapse={knowledgeCapturePanel}
            />
            {knowledgeCapturePanel.open ? (
              <>
                <p>
                  ready {knowledgeStatus?.ready ? 'yes' : 'no'} · raw{' '}
                  {knowledgeStatus?.rawCaptureCount ?? 0} · wiki docs{' '}
                  {knowledgeStatus?.wikiDocCount ?? 0}
                </p>
                <textarea
                  value={knowledgeNote}
                  onChange={(event) => setKnowledgeNote(event.target.value)}
                  placeholder="Capture a raw knowledge note for later curation..."
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    onClick={() => void captureKnowledge()}
                    disabled={!knowledgeNote.trim()}
                  >
                    Capture Note
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void fetchJson('/api/knowledge/lint', { method: 'POST' })
                        .then(() =>
                          fetchJson<Record<string, unknown>>('/api/knowledge'),
                        )
                        .then(setKnowledge)
                    }
                  >
                    Run Lint
                  </button>
                </div>
                <h3>Index</h3>
                <MarkdownLite text={knowledgeWiki?.index || ''} />
                <h3>Progress</h3>
                <MarkdownLite text={knowledgeWiki?.progress || ''} />
              </>
            ) : null}
          </article>
          <aside
            className={`panel logs-panel${knowledgeCuratorPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Curator Log"
              collapse={knowledgeCuratorPanel}
            />
            {knowledgeCuratorPanel.open ? (
              <>
                <MarkdownLite text={knowledgeWiki?.log || ''} />
                <h3>Recent Reports</h3>
                <pre>{JSON.stringify(knowledgeRecord.reports || [], null, 2)}</pre>
              </>
            ) : null}
          </aside>
        </section>
      ) : null}

      {activeTab === 'logs' ? (
        <section className="grid logs-grid">
          <article
            className={`panel logs-panel${hostLogsPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader
              title="Host Log"
              collapse={hostLogsPanel}
              actions={
                <button
                  type="button"
                  onClick={() => void refreshLogs()}
                >
                  Refresh
                </button>
              }
            />
            {hostLogsPanel.open ? (
              <pre>{hostLogs || '(empty)'}</pre>
            ) : null}
          </article>
          <article
            className={`panel logs-panel${errorLogsPanel.open ? '' : ' panel--collapsed'}`}
          >
            <PanelHeader title="Error Log" collapse={errorLogsPanel} />
            {errorLogsPanel.open ? <pre>{errorLogs || '(empty)'}</pre> : null}
          </article>
        </section>
      ) : null}
      </div>
    </OnboardingGate>
  );
}
