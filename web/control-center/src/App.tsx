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

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const TOKEN_KEY = 'fft_control_center.token';

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

  const wsRef = useRef<WebSocket | null>(null);
  const requestSeqRef = useRef(0);
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const activeSessionRef = useRef<string>(activeSession);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  const authHeaders = useMemo(() => {
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }, [token]);

  const appendStream = (text: string) => {
    setStream((prev) => [...prev.slice(-119), text]);
  };

  const fetchRuntime = async () => {
    try {
      const res = await fetch('/api/runtime/status', {
        headers: authHeaders,
      });
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
    if (!nextSessions.some((s) => s.sessionKey === activeSession) && nextSessions.length > 0) {
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
    const timer = window.setInterval(() => {
      void fetchRuntime();
      void fetchLogs('host');
      void fetchLogs('error');
    }, 10000);

    void fetchLogs('host');
    void fetchLogs('error');
    return () => window.clearInterval(timer);
  }, [token]);

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
            onChange={(e) => setTokenInput(e.target.value)}
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
            {history.map((msg, idx) => (
              <div key={`${msg.timestamp}-${idx}`} className={`message ${msg.role}`}>
                <span className="meta">{msg.role}</span>
                <pre>{msg.text}</pre>
              </div>
            ))}
          </div>
          <div className="composer">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
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
          <h2>Service Controls</h2>
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
