import { useEffect, useMemo, useRef, useState } from 'react';

interface RuntimeResponse {
  ok: boolean;
  serverTime: string;
  runtime: {
    runtime: string;
    sessions: number;
    activeRuns: number;
  };
  profile: {
    profile: string;
    featureFarm: boolean;
    profileDetection: {
      source: string;
      reason: string;
    };
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
  gateway: {
    host: string;
    port: number;
    authRequired: boolean;
    wsUrl: string;
  };
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

interface WsEventFrame {
  event: string;
  payload?: unknown;
}

interface WsResponseFrame {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface ChatEventPayload {
  runId: string;
  sessionKey: string;
  state: 'message' | 'delta' | 'final' | 'aborted' | 'error';
  message?: {
    role?: string;
    content?: string;
  };
  errorMessage?: string;
}

interface LogResponse {
  ok: boolean;
  content: string;
}

interface FileRootSummary {
  id: string;
  label: string;
}

interface FileEntry {
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  size: number;
  modifiedAt: string;
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
const THINK_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const REASONING_OPTIONS = ['off', 'on', 'stream'];

function lineText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function shortTime(input: string | undefined): string {
  if (!input) return '-';
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return input;
  return dt.toLocaleTimeString();
}

function parentDir(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized === '.') return '.';
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? parts.join('/') : '.';
}

function normalizeRelPath(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  return normalized || '.';
}

export function App(): JSX.Element {
  const [tokenInput, setTokenInput] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '');
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_KEY) || '');
  const [runtime, setRuntime] = useState<RuntimeResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string>('');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<string>('main');
  const [history, setHistory] = useState<SessionHistoryMessage[]>([]);
  const [stream, setStream] = useState<string[]>([]);
  const [chatInput, setChatInput] = useState<string>('');
  const [activeRunId, setActiveRunId] = useState<string>('');

  const [serviceOutput, setServiceOutput] = useState<string>('');
  const [hostLogs, setHostLogs] = useState<string>('');
  const [errorLogs, setErrorLogs] = useState<string>('');
  const [gatewayConnected, setGatewayConnected] = useState<boolean>(false);

  const [sessionProvider, setSessionProvider] = useState<string>('');
  const [sessionModel, setSessionModel] = useState<string>('');
  const [sessionThinkLevel, setSessionThinkLevel] = useState<string>('');
  const [sessionReasoningLevel, setSessionReasoningLevel] = useState<string>('');
  const [sessionStatus, setSessionStatus] = useState<string>('');

  const [fileRoots, setFileRoots] = useState<FileRootSummary[]>([]);
  const [selectedRoot, setSelectedRoot] = useState<string>('');
  const [selectedDir, setSelectedDir] = useState<string>('.');
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [fileFilter, setFileFilter] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<string>('');
  const [newFilePath, setNewFilePath] = useState<string>('');
  const [fileStatus, setFileStatus] = useState<string>('');

  const [skillGroups, setSkillGroups] = useState<SkillCatalogGroup[]>([]);
  const [skillFilter, setSkillFilter] = useState<string>('');
  const [skillsStatus, setSkillsStatus] = useState<string>('');

  const wsRef = useRef<WebSocket | null>(null);
  const requestSeqRef = useRef(0);
  const fileTreeRequestSeqRef = useRef(0);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const activeSessionRef = useRef<string>(activeSession);
  const suppressAutoRootTreeLoadRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const authHeaders = useMemo(() => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const appendStream = (text: string) => {
    setStream((prev) => [...prev.slice(-149), text]);
  };

  const filteredFileEntries = useMemo(() => {
    const query = fileFilter.trim().toLowerCase();
    if (!query) return fileEntries;
    return fileEntries.filter((entry) => {
      const haystack = `${entry.name} ${entry.relPath}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [fileEntries, fileFilter]);

  const filteredSkillGroups = useMemo(() => {
    const query = skillFilter.trim().toLowerCase();
    if (!query) return skillGroups;
    return skillGroups
      .map((group) => ({
        ...group,
        skills: group.skills.filter((skill) => {
          const haystack = `${skill.name} ${skill.path} ${skill.description}`.toLowerCase();
          return haystack.includes(query);
        }),
      }))
      .filter((group) => group.skills.length > 0);
  }, [skillGroups, skillFilter]);

  const activeSessionDetails = useMemo(
    () => sessions.find((session) => session.sessionKey === activeSession) || null,
    [sessions, activeSession],
  );

  const fetchRuntime = async () => {
    try {
      const res = await fetch('/api/runtime/status', { headers: authHeaders });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Unauthorized. Enter a valid token for this access mode.');
        }
        throw new Error(`Runtime status failed: HTTP ${res.status}`);
      }
      const data = (await res.json()) as RuntimeResponse;
      setRuntime(data);
      setRuntimeError('');
    } catch (err) {
      setRuntimeError(err instanceof Error ? err.message : String(err));
    }
  };

  const fetchLogs = async (target: 'host' | 'error') => {
    const res = await fetch(`/api/logs/recent?target=${target}&lines=120`, {
      headers: authHeaders,
    });
    if (!res.ok) return;
    const data = (await res.json()) as LogResponse;
    if (target === 'host') setHostLogs(data.content || '');
    else setErrorLogs(data.content || '');
  };

  const fetchFileRoots = async () => {
    const res = await fetch('/api/files/roots', { headers: authHeaders });
    if (!res.ok) return;
    const payload = (await res.json()) as { ok: boolean; roots?: FileRootSummary[] };
    const roots = Array.isArray(payload.roots) ? payload.roots : [];
    setFileRoots(roots);
    setSelectedRoot((prev) => prev || roots[0]?.id || '');
  };

  const fetchSkillsCatalog = async () => {
    const res = await fetch('/api/skills/catalog', { headers: authHeaders });
    if (!res.ok) {
      setSkillsStatus(`skills catalog failed: HTTP ${res.status}`);
      return;
    }
    const payload = (await res.json()) as {
      ok: boolean;
      groups?: SkillCatalogGroup[];
    };
    const groups = Array.isArray(payload.groups) ? payload.groups : [];
    setSkillGroups(groups);
    setSkillsStatus(`loaded ${groups.reduce((sum, group) => sum + group.skills.length, 0)} skills`);
  };

  const loadFileTree = async (rootId: string, dirPath: string) => {
    if (!rootId) return;
    const requestSeq = ++fileTreeRequestSeqRef.current;
    const params = new URLSearchParams({
      root: rootId,
      path: dirPath || '.',
    });
    const res = await fetch(`/api/files/tree?${params.toString()}`, {
      headers: authHeaders,
    });
    if (!res.ok) {
      if (requestSeq !== fileTreeRequestSeqRef.current) return;
      setFileStatus(`tree failed: HTTP ${res.status}`);
      return;
    }
    const payload = (await res.json()) as {
      ok: boolean;
      entries?: FileEntry[];
      path?: string;
      error?: string;
    };
    if (!payload.ok) {
      if (requestSeq !== fileTreeRequestSeqRef.current) return;
      setFileStatus(payload.error || 'tree failed');
      return;
    }
    if (requestSeq !== fileTreeRequestSeqRef.current) return;
    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    setFileEntries(entries);
    setSelectedDir(payload.path || dirPath || '.');
  };

  const loadFile = async (rootId: string, filePath: string) => {
    const params = new URLSearchParams({
      root: rootId,
      path: filePath,
    });
    const res = await fetch(`/api/files/read?${params.toString()}`, {
      headers: authHeaders,
    });
    if (!res.ok) {
      setFileStatus(`read failed: HTTP ${res.status}`);
      return;
    }
    const payload = (await res.json()) as {
      ok: boolean;
      content?: string;
      modifiedAt?: string;
      size?: number;
      error?: string;
    };
    if (!payload.ok) {
      setFileStatus(payload.error || 'read failed');
      return;
    }
    setSelectedFile(filePath);
    setFileContent(payload.content || '');
    setFileStatus(`loaded ${filePath} (${payload.size ?? 0} bytes)`);
  };

  const saveFile = async () => {
    if (!selectedRoot || !selectedFile) return;
    const res = await fetch('/api/files/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        root: selectedRoot,
        path: selectedFile,
        content: fileContent,
      }),
    });
    if (!res.ok) {
      setFileStatus(`save failed: HTTP ${res.status}`);
      return;
    }
    const payload = (await res.json()) as { ok: boolean; modifiedAt?: string; error?: string };
    if (!payload.ok) {
      setFileStatus(payload.error || 'save failed');
      return;
    }
    setFileStatus(`saved ${selectedFile} at ${shortTime(payload.modifiedAt)}`);
    void loadFileTree(selectedRoot, selectedDir);
  };

  const createFile = async () => {
    if (!selectedRoot) return;
    const relPath = normalizeRelPath(newFilePath);
    if (!relPath || relPath === '.') {
      setFileStatus('enter a file path, example: notes/new-skill.md');
      return;
    }
    const res = await fetch('/api/files/write', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({
        root: selectedRoot,
        path: relPath,
        content: '',
      }),
    });
    if (!res.ok) {
      setFileStatus(`create failed: HTTP ${res.status}`);
      return;
    }
    const payload = (await res.json()) as { ok: boolean; error?: string };
    if (!payload.ok) {
      setFileStatus(payload.error || 'create failed');
      return;
    }
    setNewFilePath('');
    const targetDir = parentDir(relPath);
    await loadFileTree(selectedRoot, targetDir);
    await loadFile(selectedRoot, relPath);
    setFileStatus(`created ${relPath}`);
  };

  const openSkillInEditor = async (skill: SkillCatalogEntry) => {
    if (selectedRoot !== skill.rootId) {
      suppressAutoRootTreeLoadRef.current = skill.rootId;
    }
    setSelectedRoot(skill.rootId);
    const dirPath = skill.dir || parentDir(skill.path);
    await loadFileTree(skill.rootId, dirPath || '.');
    await loadFile(skill.rootId, skill.path);
    setSkillsStatus(`opened ${skill.path} from ${skill.rootLabel}`);
  };

  const wsRequest = <T,>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Gateway is not connected'));
    }

    requestSeqRef.current += 1;
    const id = `req-${Date.now()}-${requestSeqRef.current}`;
    const frame = { id, method, params };

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

      ws.send(JSON.stringify(frame));
    });
  };

  const loadSessions = async () => {
    const result = await wsRequest<{ sessions: SessionSummary[] }>('sessions.list');
    const nextSessions = Array.isArray(result.sessions) ? result.sessions : [];
    setSessions(nextSessions);
    if (!nextSessions.some((session) => session.sessionKey === activeSession) && nextSessions.length > 0) {
      setActiveSession(nextSessions[0].sessionKey);
    }
  };

  const loadHistory = async (sessionKey: string) => {
    const result = await wsRequest<{ messages: SessionHistoryMessage[] }>('chat.history', {
      sessionKey,
      limit: 120,
    });
    setHistory(Array.isArray(result.messages) ? result.messages : []);
  };

  useEffect(() => {
    void fetchRuntime();
    void fetchLogs('host');
    void fetchLogs('error');
    void fetchFileRoots();
    void fetchSkillsCatalog();

    const timer = window.setInterval(() => {
      void fetchRuntime();
      void fetchLogs('host');
      void fetchLogs('error');
    }, 10000);

    return () => window.clearInterval(timer);
  }, [token]);

  useEffect(() => {
    if (!selectedRoot) return;
    if (suppressAutoRootTreeLoadRef.current === selectedRoot) {
      suppressAutoRootTreeLoadRef.current = null;
      return;
    }
    void loadFileTree(selectedRoot, '.');
  }, [selectedRoot]);

  useEffect(() => {
    if (!runtime) return;

    const ws = new WebSocket(runtime.gateway.wsUrl);
    wsRef.current = ws;

    const rejectAllPending = (message: string) => {
      for (const [, pending] of pendingRef.current) {
        pending.reject(new Error(message));
      }
      pendingRef.current.clear();
    };

    ws.onopen = async () => {
      try {
        await wsRequest<{ ok: boolean }>('connect', {
          client: 'fft_control_center',
          token: token || undefined,
        });
        setGatewayConnected(true);
        appendStream('gateway connected');
        await loadSessions();
      } catch (err) {
        setGatewayConnected(false);
        appendStream(`gateway connect failed: ${lineText(err)}`);
      }
    };

    ws.onclose = (event) => {
      setGatewayConnected(false);
      rejectAllPending(`Gateway closed (${event.code})`);
      appendStream(`gateway disconnected (${event.code})`);
    };

    ws.onerror = () => {
      appendStream('gateway websocket error');
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const obj = parsed as Record<string, unknown>;

      if (typeof obj.id === 'string' && typeof obj.ok === 'boolean') {
        const frame = obj as unknown as WsResponseFrame;
        const pending = pendingRef.current.get(frame.id);
        if (!pending) return;
        pendingRef.current.delete(frame.id);
        if (frame.ok) pending.resolve(frame.result);
        else pending.reject(new Error(frame.error || 'Unknown gateway error'));
        return;
      }

      if (typeof obj.event === 'string') {
        const frame = obj as unknown as WsEventFrame;
        if (frame.event !== 'chat_event') return;
        const payload = (frame.payload || {}) as ChatEventPayload;
        if (!payload || payload.sessionKey !== activeSessionRef.current) return;

        if (payload.state === 'message' && payload.message) {
          const role = payload.message.role || 'assistant';
          const content = payload.message.content || '';
          setHistory((prev) => [
            ...prev,
            {
              role: role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system',
              text: content,
              timestamp: new Date().toISOString(),
              runId: payload.runId,
            },
          ]);
          if (role === 'user') setActiveRunId(payload.runId || '');
        } else if (payload.state === 'final') {
          setActiveRunId('');
          appendStream(`run ${payload.runId} final`);
        } else if (payload.state === 'aborted') {
          setActiveRunId('');
          appendStream(`run ${payload.runId} aborted`);
        } else if (payload.state === 'error') {
          setActiveRunId('');
          appendStream(`run ${payload.runId} error: ${payload.errorMessage || 'unknown error'}`);
        }
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      rejectAllPending('Gateway connection reset');
      setGatewayConnected(false);
    };
  }, [runtime?.gateway.wsUrl, token]);

  useEffect(() => {
    if (!gatewayConnected) return;
    void loadHistory(activeSession);
  }, [activeSession, gatewayConnected]);

  const onApplyToken = () => {
    const next = tokenInput.trim();
    if (next) localStorage.setItem(TOKEN_KEY, next);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(next);
  };

  const onSendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    try {
      const result = await wsRequest<{ runId: string; status: string }>('chat.send', {
        sessionKey: activeSession,
        message: text,
        deliver: false,
      });
      appendStream(`chat.send -> ${result.status} (${result.runId})`);
      setActiveRunId(result.runId || '');
      setChatInput('');
    } catch (err) {
      appendStream(`chat.send failed: ${lineText(err)}`);
    }
  };

  const onAbortRun = async () => {
    if (!activeRunId) return;
    try {
      const result = await wsRequest<{ aborted: boolean }>('chat.abort', {
        sessionKey: activeSession,
        runId: activeRunId,
      });
      appendStream(`chat.abort -> ${result.aborted ? 'aborted' : 'not-active'}`);
      if (result.aborted) setActiveRunId('');
    } catch (err) {
      appendStream(`chat.abort failed: ${lineText(err)}`);
    }
  };

  const onPatchSession = async () => {
    const provider = sessionProvider.trim();
    const model = sessionModel.trim();
    const thinkLevel = sessionThinkLevel.trim();
    const reasoningLevel = sessionReasoningLevel.trim();

    if (!provider && !model && !thinkLevel && !reasoningLevel) {
      setSessionStatus('enter at least one override before applying');
      return;
    }

    try {
      const result = await wsRequest<{
        ok: boolean;
        key: string;
        provider?: string;
        model?: string;
        thinkLevel?: string;
        reasoningLevel?: string;
      }>('sessions.patch', {
        sessionKey: activeSession,
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(thinkLevel ? { thinkLevel } : {}),
        ...(reasoningLevel ? { reasoningLevel } : {}),
      });
      setSessionStatus(
        `updated ${result.key}: ${result.provider || '-'} / ${result.model || '-'} / ${result.thinkLevel || '-'} / ${result.reasoningLevel || '-'}`,
      );
      appendStream(`sessions.patch -> ${result.key}`);
      await loadSessions();
    } catch (err) {
      setSessionStatus(`sessions.patch failed: ${lineText(err)}`);
    }
  };

  const onResetSession = async () => {
    try {
      const result = await wsRequest<{ ok: boolean; key: string; reason: string }>('sessions.reset', {
        sessionKey: activeSession,
        reason: 'control-center-reset',
      });
      setSessionStatus(`reset ${result.key} (${result.reason})`);
      appendStream(`sessions.reset -> ${result.key}`);
      await loadHistory(activeSession);
    } catch (err) {
      setSessionStatus(`sessions.reset failed: ${lineText(err)}`);
    }
  };

  const onGatewayService = async (action: 'status' | 'restart' | 'doctor') => {
    try {
      const result = await wsRequest<{ ok: boolean; text: string }>('gateway.service', { action });
      setServiceOutput(result.text || '(no output)');
      appendStream(`gateway.${action} ok`);
      void fetchRuntime();
      void fetchLogs('host');
      void fetchLogs('error');
    } catch (err) {
      setServiceOutput(`Failed: ${lineText(err)}`);
      appendStream(`gateway.${action} failed`);
    }
  };

  const openDir = (dirPath: string) => {
    void loadFileTree(selectedRoot, dirPath);
  };

  const dirSegments = selectedDir === '.'
    ? []
    : selectedDir.split('/').filter(Boolean);

  return (
    <div className="app">
      <header className="masthead panel">
        <div>
          <h1>FFT CONTROL CENTER</h1>
          <p>
            service-integrated ops surface · {gatewayConnected ? 'gateway online' : 'gateway offline'}
          </p>
        </div>
        <div className="token-control">
          <label htmlFor="token">Token</label>
          <input
            id="token"
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="Bearer token for lan/remote"
          />
          <button type="button" onClick={onApplyToken}>Apply</button>
        </div>
      </header>

      {runtimeError ? <div className="error panel">{runtimeError}</div> : null}

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
          <p>feature_farm {runtime?.profile.featureFarm ? 'on' : 'off'}</p>
          <p>{runtime?.profile.profileDetection.source || '-'}</p>
        </article>
        <article className="panel stat">
          <h2>Build</h2>
          <div className="stat-value">{runtime?.build.version || '-'}</div>
          <p>{runtime?.build.branch || '-'}</p>
          <p>{runtime?.build.commit || '-'}</p>
        </article>
        <article className="panel stat">
          <h2>Gateway</h2>
          <div className="stat-value">{runtime?.gateway.port ?? '-'}</div>
          <p>{runtime?.gateway.wsUrl || '-'}</p>
          <p>auth {runtime?.gateway.authRequired ? 'required' : 'none'}</p>
        </article>
      </section>

      <section className="grid main-grid">
        <article className="panel sessions-panel">
          <h2>Sessions</h2>
          <div className="scroll-block">
            {sessions.map((session) => (
              <button
                type="button"
                key={session.sessionKey}
                className={`session-item ${activeSession === session.sessionKey ? 'active' : ''}`}
                onClick={() => setActiveSession(session.sessionKey)}
              >
                <strong>{session.sessionKey}</strong>
                <span>{session.name}</span>
                <span>{shortTime(session.lastActivity)}</span>
              </button>
            ))}
            {sessions.length === 0 ? <p>No sessions loaded.</p> : null}
          </div>
        </article>

        <article className="panel chat-panel">
          <h2>Live Chat · {activeSession}</h2>
          <div className="scroll-block history">
            {history.map((msg, index) => (
              <div key={`${msg.timestamp}-${index}`} className={`message ${msg.role}`}>
                <span className="meta">{msg.role}</span>
                <pre>{msg.text}</pre>
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
              <button type="button" onClick={onSendChat}>Send</button>
              <button type="button" onClick={onAbortRun} disabled={!activeRunId}>Abort</button>
              <button type="button" onClick={() => void loadHistory(activeSession)}>Refresh</button>
            </div>
          </div>
        </article>

        <article className="panel service-panel">
          <h2>Service + Session Controls</h2>

          <div className="session-controls">
            <p className="files-path">
              {activeSessionDetails?.chatJid || 'no active chat jid'}
            </p>
            <div className="session-fields-grid">
              <label className="field">
                <span>Provider</span>
                <input
                  value={sessionProvider}
                  onChange={(event) => setSessionProvider(event.target.value)}
                  placeholder="zai / openai / anthropic"
                />
              </label>
              <label className="field">
                <span>Model</span>
                <input
                  value={sessionModel}
                  onChange={(event) => setSessionModel(event.target.value)}
                  placeholder="glm-4.7"
                />
              </label>
              <label className="field">
                <span>Think</span>
                <select
                  value={sessionThinkLevel}
                  onChange={(event) => setSessionThinkLevel(event.target.value)}
                >
                  <option value="">unchanged</option>
                  {THINK_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Reasoning</span>
                <select
                  value={sessionReasoningLevel}
                  onChange={(event) => setSessionReasoningLevel(event.target.value)}
                >
                  <option value="">unchanged</option>
                  {REASONING_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="composer-actions">
              <button type="button" onClick={() => void onPatchSession()}>Apply Prefs</button>
              <button type="button" onClick={() => void onResetSession()}>Reset Session</button>
            </div>
            <pre className="service-output">{sessionStatus || 'No session updates yet.'}</pre>
          </div>

          <div className="service-actions">
            <button type="button" onClick={() => void onGatewayService('status')}>Status</button>
            <button type="button" onClick={() => void onGatewayService('doctor')}>Doctor</button>
            <button type="button" onClick={() => void onGatewayService('restart')}>Restart</button>
          </div>
          <pre className="service-output">{serviceOutput || 'No service output yet.'}</pre>

          <h3>Event Stream</h3>
          <pre className="service-output">{stream.join('\n') || 'No events yet.'}</pre>
        </article>
      </section>

      <section className="grid files-grid">
        <article className="panel files-browser">
          <h2>Workspace + Skills Files</h2>
          <div className="files-toolbar">
            <select
              value={selectedRoot}
              onChange={(event) => {
                setSelectedRoot(event.target.value);
                setSelectedFile('');
                setFileContent('');
                setFileStatus('');
                setSelectedDir('.');
                setFileFilter('');
              }}
            >
              {fileRoots.map((root) => (
                <option key={root.id} value={root.id}>{root.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => openDir('.')}>Root</button>
            <button
              type="button"
              onClick={() => {
                const next = parentDir(selectedDir);
                openDir(next);
              }}
            >
              Up
            </button>
          </div>

          <div className="breadcrumb-row">
            <button type="button" onClick={() => openDir('.')}>.</button>
            {dirSegments.map((segment, index) => {
              const rel = dirSegments.slice(0, index + 1).join('/');
              return (
                <button key={rel} type="button" onClick={() => openDir(rel)}>{segment}</button>
              );
            })}
          </div>

          <label className="field">
            <span>Filter</span>
            <input
              value={fileFilter}
              onChange={(event) => setFileFilter(event.target.value)}
              placeholder="search current folder"
            />
          </label>

          <label className="field">
            <span>New File</span>
            <div className="inline-action">
              <input
                value={newFilePath}
                onChange={(event) => setNewFilePath(event.target.value)}
                placeholder="relative path, e.g. skills/new/SKILL.md"
              />
              <button type="button" onClick={() => void createFile()}>Create</button>
            </div>
          </label>

          <p className="files-path">{selectedDir}</p>
          <div className="scroll-block">
            {filteredFileEntries.map((entry) => (
              <button
                key={entry.relPath}
                type="button"
                className={`file-item ${entry.kind === 'dir' ? 'dir' : 'file'} ${selectedFile === entry.relPath ? 'active' : ''}`}
                onClick={() => {
                  if (entry.kind === 'dir') openDir(entry.relPath);
                  else void loadFile(selectedRoot, entry.relPath);
                }}
              >
                <strong>{entry.kind === 'dir' ? '[DIR]' : '[FILE]'}</strong>
                <span>{entry.relPath}</span>
                <span className="file-meta">{entry.size} bytes · {shortTime(entry.modifiedAt)}</span>
              </button>
            ))}
            {filteredFileEntries.length === 0 ? <p>No entries.</p> : null}
          </div>
        </article>

        <article className="panel file-editor">
          <h2>Editor</h2>
          <p className="files-path">{selectedFile || 'Select a file to edit'}</p>
          <textarea
            className="editor-area"
            value={fileContent}
            onChange={(event) => setFileContent(event.target.value)}
            disabled={!selectedFile}
          />
          <div className="composer-actions">
            <button type="button" onClick={() => void loadFile(selectedRoot, selectedFile)} disabled={!selectedFile}>Reload</button>
            <button type="button" onClick={() => void saveFile()} disabled={!selectedFile}>Save</button>
          </div>
          <pre className="service-output">{fileStatus || 'Ready.'}</pre>
        </article>
      </section>

      <section className="grid skills-grid">
        <article className="panel skills-panel">
          <div className="skills-head">
            <h2>Skills Catalog</h2>
            <button type="button" onClick={() => void fetchSkillsCatalog()}>Refresh</button>
          </div>

          <label className="field">
            <span>Filter Skills</span>
            <input
              value={skillFilter}
              onChange={(event) => setSkillFilter(event.target.value)}
              placeholder="search by name, path, description"
            />
          </label>

          <div className="scroll-block skills-scroll">
            {filteredSkillGroups.map((group) => (
              <details key={group.root.id} className="skill-group" open>
                <summary>
                  <strong>{group.root.label}</strong>
                  <span>{group.skills.length}</span>
                </summary>
                <div className="skill-list">
                  {group.skills.map((skill) => (
                    <div className="skill-item" key={`${group.root.id}:${skill.path}`}>
                      <div>
                        <p className="skill-title">{skill.name}</p>
                        <p className="files-path">{skill.path}</p>
                        <p className="skill-desc">{skill.description || 'No description.'}</p>
                      </div>
                      <button type="button" onClick={() => void openSkillInEditor(skill)}>Open</button>
                    </div>
                  ))}
                </div>
              </details>
            ))}
            {filteredSkillGroups.length === 0 ? <p>No skills found.</p> : null}
          </div>

          <pre className="service-output">{skillsStatus || 'Select a skill and open it in editor.'}</pre>
        </article>
      </section>

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
    </div>
  );
}
