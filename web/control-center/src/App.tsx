import { useEffect, useMemo, useRef, useState } from 'react';

type TabId =
  | 'overview'
  | 'chat'
  | 'sessions'
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
  { id: 'setup', label: 'Setup' },
  { id: 'system', label: 'System' },
  { id: 'skills', label: 'Skills' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'memory', label: 'Memory' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'logs', label: 'Logs' },
];

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

function renderMarkdownLite(input: string): JSX.Element {
  return <pre className="markdown-lite">{input || '(empty)'}</pre>;
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

  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const requestSeqRef = useRef(0);
  const activeSessionRef = useRef(activeSession);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const authHeaders = useMemo(() => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
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
        if (['final', 'aborted', 'error'].includes(payload.state || ''))
          setActiveRunId('');
        return;
      }
      if (parsed.event === 'agent_event') {
        appendEvent(`agent ${asText(parsed.payload).slice(0, 300)}`);
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
    <div className="app">
      <header className="masthead panel">
        <div>
          <h1>FFT CONTROL CENTER</h1>
          <p>
            {gatewayConnected ? 'gateway online' : 'gateway offline'} ·{' '}
            {runtime?.runtime.runtime || 'runtime unknown'}
          </p>
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
          <article className="panel stat">
            <h2>Runtime</h2>
            <div className="stat-value">{runtime?.runtime.runtime || '-'}</div>
            <p>sessions {runtime?.runtime.sessions ?? 0}</p>
            <p>active runs {runtime?.runtime.activeRuns ?? 0}</p>
          </article>
          <article className="panel stat">
            <h2>Profile</h2>
            <div className="stat-value">{runtime?.profile.profile || '-'}</div>
            <p>farm {runtime?.profile.featureFarm ? 'on' : 'off'}</p>
            <p>{runtime?.profile.profileDetection.source || '-'}</p>
          </article>
          <article className="panel stat">
            <h2>Provider</h2>
            <div className="stat-value">{settings?.providerPreset || '-'}</div>
            <p>{settings?.model || '-'}</p>
            <p>
              {settings?.apiKeyEnv}:{' '}
              {settings?.apiKeyConfigured ? 'set' : 'missing'}
            </p>
          </article>
          <article className="panel stat">
            <h2>Knowledge</h2>
            <div className="stat-value">
              {knowledgeStatus?.ready ? 'ready' : 'check'}
            </div>
            <p>raw {knowledgeStatus?.rawCaptureCount ?? 0}</p>
            <p>wiki docs {knowledgeStatus?.wikiDocCount ?? 0}</p>
          </article>
        </section>
      ) : null}

      {activeTab === 'chat' || activeTab === 'sessions' ? (
        <section className="grid main-grid">
          <article className="panel sessions-panel">
            <h2>Sessions</h2>
            <div className="scroll-block">
              {sessions.map((session) => (
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
              ))}
            </div>
          </article>
          <article className="panel chat-panel">
            <h2>Live Chat · {activeSession}</h2>
            <div className="scroll-block history">
              {history.map((msg, index) => (
                <div
                  key={`${msg.timestamp}-${index}`}
                  className={`message ${msg.role}`}
                >
                  <div className="message-meta-row">
                    <span className="meta">{msg.role}</span>
                    <span className="meta-time">
                      {shortTime(msg.timestamp)}
                    </span>
                  </div>
                  <pre className="message-content">{msg.text}</pre>
                </div>
              ))}
            </div>
            <div className="composer">
              <textarea
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="Type a run prompt..."
              />
              <div className="composer-actions">
                <button type="button" onClick={() => void sendChat()}>
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
                <button
                  type="button"
                  onClick={() => void loadHistory(activeSession)}
                >
                  Refresh
                </button>
              </div>
            </div>
          </article>
          <article className="panel service-panel">
            <h2>Events</h2>
            <pre className="service-output">
              {events.join('\n') || 'No events yet.'}
            </pre>
          </article>
        </section>
      ) : null}

      {activeTab === 'setup' ? (
        <section className="grid setup-grid">
          <article className="panel">
            <h2>Provider + Model</h2>
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
          </article>
          <article className="panel">
            <h2>Get API Keys</h2>
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
          </article>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="grid system-grid">
          <article className="panel">
            <h2>Composed System Prompt</h2>
            <p className="files-path">
              Preview only. It does not store or send another system message.
            </p>
            <button type="button" onClick={() => void loadSystemPreview()}>
              Load Preview
            </button>
            <pre className="system-preview">
              {(systemPreview as { text?: string } | null)?.text ||
                'No preview loaded.'}
            </pre>
          </article>
          <article className="panel">
            <h2>Report</h2>
            <pre className="service-output">
              {JSON.stringify(
                (systemPreview as { report?: unknown } | null)?.report || {},
                null,
                2,
              )}
            </pre>
          </article>
        </section>
      ) : null}

      {activeTab === 'skills' ? (
        <section className="grid skills-grid">
          <article className="panel">
            <div className="skills-head">
              <h2>Skills Catalog</h2>
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
            </div>
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
                'Use Workspace + Skills file roots through the file APIs for editing.'}
            </pre>
          </article>
        </section>
      ) : null}

      {activeTab === 'tasks' ? (
        <section className="grid tasks-grid">
          <article className="panel">
            <h2>Scheduled Tasks</h2>
            <div className="scroll-block">
              {taskList.map((task) => (
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
              ))}
            </div>
          </article>
          <article className="panel">
            <h2>Task JSON</h2>
            <pre className="service-output">
              {JSON.stringify(tasks, null, 2)}
            </pre>
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
          <article className="panel">
            <h2>Knowledge Wiki</h2>
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
            {renderMarkdownLite(knowledgeWiki?.index || '')}
            <h3>Progress</h3>
            {renderMarkdownLite(knowledgeWiki?.progress || '')}
          </article>
          <aside className="panel logs-panel">
            <h2>Curator Log</h2>
            {renderMarkdownLite(knowledgeWiki?.log || '')}
            <h3>Recent Reports</h3>
            <pre>{JSON.stringify(knowledgeRecord.reports || [], null, 2)}</pre>
          </aside>
        </section>
      ) : null}

      {activeTab === 'logs' ? (
        <section className="grid logs-grid">
          <article className="panel logs-panel">
            <h2>Host Log</h2>
            <pre>{hostLogs || '(empty)'}</pre>
          </article>
          <article className="panel logs-panel">
            <h2>Error Log</h2>
            <pre>{errorLogs || '(empty)'}</pre>
          </article>
        </section>
      ) : null}
    </div>
  );
}
