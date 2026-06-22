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
  actions?: JSX.Element | null;
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

type EditorMode = 'edit' | 'split' | 'preview';

function Editor({
  title,
  subtitle,
  value,
  original,
  onChange,
  onSave,
  onReload,
  saveDisabled,
  status,
  saveLabel = 'Save',
  reloadLabel = 'Reload',
  showPreview = true,
  extraActions,
  emptyHint,
}: {
  title: string;
  subtitle?: string;
  value: string;
  original: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  onReload?: () => void;
  saveDisabled?: boolean;
  status?: string;
  saveLabel?: string;
  reloadLabel?: string;
  showPreview?: boolean;
  extraActions?: JSX.Element;
  emptyHint?: string;
}): JSX.Element {
  const [mode, setMode] = useState<EditorMode>('edit');
  const dirty = value !== original;
  const lines = value.length === 0 ? 0 : value.split('\n').length;
  const chars = value.length;
  const words = value.trim().length === 0 ? 0 : value.trim().split(/\s+/).length;
  const statusClass = status && /fail|error/i.test(status)
    ? 'editor-shell__status--error'
    : dirty
      ? 'editor-shell__status--dirty'
      : 'editor-shell__status--saved';
  const statusText = status
    ? status
    : dirty
      ? 'Unsaved changes'
      : 'Saved';

  const editor = (
    <div className="editor-shell__pane editor-shell__pane--edit">
      <textarea
        className="editor-area"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        placeholder={emptyHint}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 's') {
            event.preventDefault();
            if (onSave && !saveDisabled) onSave();
          }
        }}
      />
    </div>
  );

  const preview = (
    <div className="editor-shell__pane editor-shell__pane--preview">
      <MarkdownLite text={value} />
    </div>
  );

  return (
    <div className="editor-shell">
      <div className="editor-shell__head">
        <div className="editor-shell__title">
          <strong title={title}>{title}</strong>
          {subtitle ? <small title={subtitle}>{subtitle}</small> : null}
        </div>
        <div className="editor-shell__actions">
          {showPreview ? (
            <div
              className="editor-shell__modes"
              role="tablist"
              aria-label="Editor mode"
            >
              <button
                type="button"
                className={mode === 'edit' ? 'active' : ''}
                onClick={() => setMode('edit')}
                title="Edit only"
              >
                Edit
              </button>
              <button
                type="button"
                className={mode === 'split' ? 'active' : ''}
                onClick={() => setMode('split')}
                title="Edit and preview side by side"
              >
                Split
              </button>
              <button
                type="button"
                className={mode === 'preview' ? 'active' : ''}
                onClick={() => setMode('preview')}
                title="Preview only"
              >
                Preview
              </button>
            </div>
          ) : null}
          {extraActions}
          {onReload ? (
            <button
              type="button"
              onClick={onReload}
              title="Re-read from disk (discard local changes)"
            >
              {reloadLabel}
            </button>
          ) : null}
          {onSave ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled}
              title="Write changes to disk (Ctrl/Cmd+S)"
            >
              {saveLabel}
            </button>
          ) : null}
        </div>
      </div>
      <div className="editor-shell__body">
        {showPreview && mode === 'split' ? (
          <>
            {editor}
            {preview}
          </>
        ) : showPreview && mode === 'preview' ? (
          preview
        ) : value.length === 0 ? (
          <div className="editor-shell__empty">
            {emptyHint || 'Nothing to display yet.'}
          </div>
        ) : (
          editor
        )}
      </div>
      <div className="editor-shell__footer">
        <span className={`editor-shell__status ${statusClass}`}>{statusText}</span>
        <span className="editor-shell__stats">
          <span>
            <strong>{lines}</strong> lines
          </span>
          <span>
            <strong>{words}</strong> words
          </span>
          <span>
            <strong>{chars}</strong> chars
          </span>
        </span>
      </div>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<TabId>('chat');
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

  // Memory tab state
  const [memoryGroups, setMemoryGroups] = useState<
    Array<{
      folder: string;
      workspaceDir: string;
      isMain: boolean;
      isGlobal: boolean;
    }>
  >([]);
  const [activeMemoryGroup, setActiveMemoryGroup] = useState('');
  const [memoryFiles, setMemoryFiles] = useState<
    Array<{
      path: string;
      name: string;
      size: number;
      modifiedAt: string;
      kind: string;
      exists: boolean;
      scaffoldOnly?: boolean;
    }>
  >([]);
  const [activeMemoryFile, setActiveMemoryFile] = useState<{
    group: string;
    path: string;
  } | null>(null);
  const [memoryFileContent, setMemoryFileContent] = useState('');
  const [memoryFileOriginal, setMemoryFileOriginal] = useState('');
  const [memoryFileStatus, setMemoryFileStatus] = useState('');
  const [memoryHistory, setMemoryHistory] = useState<
    Array<{ version: string; size: number; modifiedAt: string }>
  >([]);

  // Skills tab state
  const [activeSkill, setActiveSkill] = useState<{
    root: string;
    path: string;
    name: string;
  } | null>(null);
  const [skillFileContent, setSkillFileContent] = useState('');
  const [skillFileOriginal, setSkillFileOriginal] = useState('');
  const [skillFileStatus, setSkillFileStatus] = useState('');
  const [skillHistory, setSkillHistory] = useState<
    Array<{ version: string; size: number; modifiedAt: string }>
  >([]);

  // Knowledge tab state
  const [knowledgeFiles, setKnowledgeFiles] = useState<
    Array<{
      path: string;
      name: string;
      size: number;
      modifiedAt: string;
      kind: string;
      exists: boolean;
    }>
  >([]);
  const [activeKnowledgeFile, setActiveKnowledgeFile] = useState<{
    path: string;
    name: string;
  } | null>(null);
  const [knowledgeFileContent, setKnowledgeFileContent] = useState('');
  const [knowledgeFileOriginal, setKnowledgeFileOriginal] = useState('');
  const [knowledgeWriteMode, setKnowledgeWriteMode] = useState<
    'replace' | 'append'
  >('replace');
  const [knowledgeFileStatus, setKnowledgeFileStatus] = useState('');
  const [lastKnowledgeSaveMode, setLastKnowledgeSaveMode] = useState<
    'replace' | 'append' | null
  >(null);

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

  // Tab-level sidebar collapse (left sidebar for file tree, right for inspector)
  const memorySidebarLeft = useCollapse('sidebar.memory.left', true);
  const memorySidebarRight = useCollapse('sidebar.memory.right', true);
  const skillsSidebarLeft = useCollapse('sidebar.skills.left', true);
  const skillsSidebarRight = useCollapse('sidebar.skills.right', true);
  const knowledgeSidebarLeft = useCollapse('sidebar.knowledge.left', true);
  const knowledgeSidebarRight = useCollapse('sidebar.knowledge.right', true);
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
      refreshMemoryGroups().catch(() => null),
      refreshKnowledgeFiles().catch(() => null),
    ]);
  };

  const refreshMemoryGroups = async () => {
    const res = await fetchJson<{
      ok: boolean;
      groups: Array<{
        folder: string;
        workspaceDir: string;
        isMain: boolean;
        isGlobal: boolean;
      }>;
    }>('/api/memory/groups');
    setMemoryGroups(res.groups || []);
    if (!activeMemoryGroup && res.groups?.[0]) {
      setActiveMemoryGroup(res.groups[0].folder);
    }
  };

  const refreshMemoryFiles = async (group: string) => {
    if (!group) {
      setMemoryFiles([]);
      return;
    }
    const res = await fetchJson<{
      ok: boolean;
      files: typeof memoryFiles;
    }>(`/api/memory/files?group=${encodeURIComponent(group)}`);
    setMemoryFiles(res.files || []);
  };

  const openMemoryFile = async (group: string, filePath: string) => {
    if (
      memoryFileContent !== memoryFileOriginal &&
      memoryFileOriginal &&
      activeMemoryFile &&
      (activeMemoryFile.path !== filePath || activeMemoryFile.group !== group)
    ) {
      const ok = window.confirm('Discard unsaved changes to the current memory file?');
      if (!ok) return;
    }
    setMemoryFileStatus('Loading…');
    try {
      const res = await fetchJson<{
        ok: boolean;
        content: string;
        path: string;
        size: number;
        modifiedAt: string;
        exists: boolean;
      }>(
        `/api/memory/read?group=${encodeURIComponent(group)}&path=${encodeURIComponent(filePath)}`,
      );
      setActiveMemoryFile({ group, path: filePath });
      setMemoryFileContent(res.content || '');
      setMemoryFileOriginal(res.content || '');
      setMemoryFileStatus(res.exists ? 'Loaded.' : 'New file (empty).');
      await loadMemoryHistory(group, filePath);
    } catch (err) {
      setMemoryFileStatus(
        `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const loadMemoryHistory = async (group: string, filePath: string) => {
    try {
      const hist = await fetchJson<{
        ok: boolean;
        versions: typeof memoryHistory;
      }>(
        `/api/memory/history?group=${encodeURIComponent(group)}&path=${encodeURIComponent(filePath)}`,
      );
      setMemoryHistory(hist.versions || []);
    } catch {
      setMemoryHistory([]);
    }
  };

  const saveMemoryFile = async () => {
    if (!activeMemoryFile) return;
    setMemoryFileStatus('Saving…');
    try {
      await fetchJson('/api/memory/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: activeMemoryFile.group,
          path: activeMemoryFile.path,
          content: memoryFileContent,
        }),
      });
      setMemoryFileOriginal(memoryFileContent);
      setMemoryFileStatus('Saved.');
      await refreshMemoryFiles(activeMemoryFile.group);
      // Re-fetch history
      try {
        const hist = await fetchJson<{
          ok: boolean;
          versions: typeof memoryHistory;
        }>(
          `/api/memory/history?group=${encodeURIComponent(activeMemoryFile.group)}&path=${encodeURIComponent(activeMemoryFile.path)}`,
        );
        setMemoryHistory(hist.versions || []);
      } catch {
        setMemoryHistory([]);
      }
    } catch (err) {
      setMemoryFileStatus(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const rollbackMemoryFile = async (version: string) => {
    if (!activeMemoryFile) return;
    if (!window.confirm(`Roll back to version ${version}?`)) return;
    setMemoryFileStatus('Rolling back…');
    try {
      await fetchJson('/api/memory/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group: activeMemoryFile.group,
          path: activeMemoryFile.path,
          version,
        }),
      });
      await openMemoryFile(activeMemoryFile.group, activeMemoryFile.path);
      setMemoryFileStatus(`Rolled back to ${version}.`);
    } catch (err) {
      setMemoryFileStatus(
        `Rollback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const openSkillFile = async (
    root: { id: string; label: string },
    skill: { name: string; path: string; dir: string },
  ) => {
    if (
      skillFileContent !== skillFileOriginal &&
      skillFileOriginal &&
      activeSkill &&
      (activeSkill.path !== skill.path || activeSkill.root !== root.id)
    ) {
      const ok = window.confirm('Discard unsaved changes to the current skill?');
      if (!ok) return;
    }
    setSkillFileStatus('Loading…');
    try {
      const res = await fetchJson<{
        ok: boolean;
        content: string;
        path: string;
        size: number;
        modifiedAt: string;
        exists: boolean;
      }>(
        `/api/skills/read?root=${encodeURIComponent(root.id)}&path=${encodeURIComponent(skill.path)}`,
      );
      setActiveSkill({ root: root.id, name: skill.name, path: skill.path });
      setSkillFileContent(res.content || '');
      setSkillFileOriginal(res.content || '');
      setSkillFileStatus(res.exists ? 'Loaded.' : 'Empty.');
      try {
        const hist = await fetchJson<{
          ok: boolean;
          versions: typeof skillHistory;
        }>(
          `/api/skills/history?root=${encodeURIComponent(root.id)}&path=${encodeURIComponent(skill.path)}`,
        );
        setSkillHistory(hist.versions || []);
      } catch {
        setSkillHistory([]);
      }
    } catch (err) {
      setSkillFileStatus(
        `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const saveSkillFile = async () => {
    if (!activeSkill) return;
    setSkillFileStatus('Saving…');
    try {
      await fetchJson('/api/skills/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: activeSkill.root,
          path: activeSkill.path,
          content: skillFileContent,
        }),
      });
      setSkillFileOriginal(skillFileContent);
      setSkillFileStatus('Saved.');
      await refreshSkills();
      try {
        const hist = await fetchJson<{
          ok: boolean;
          versions: typeof skillHistory;
        }>(
          `/api/skills/history?root=${encodeURIComponent(activeSkill.root)}&path=${encodeURIComponent(activeSkill.path)}`,
        );
        setSkillHistory(hist.versions || []);
      } catch {
        setSkillHistory([]);
      }
    } catch (err) {
      setSkillFileStatus(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const rollbackSkillFile = async (version: string) => {
    if (!activeSkill) return;
    if (!window.confirm(`Roll back to version ${version}?`)) return;
    setSkillFileStatus('Rolling back…');
    try {
      await fetchJson('/api/skills/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          root: activeSkill.root,
          path: activeSkill.path,
          version,
        }),
      });
      await openSkillFile(
        { id: activeSkill.root, label: '' },
        { name: activeSkill.name, path: activeSkill.path, dir: '' },
      );
      setSkillFileStatus(`Rolled back to ${version}.`);
    } catch (err) {
      setSkillFileStatus(
        `Rollback failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const refreshKnowledgeFiles = async () => {
    const res = await fetchJson<{
      ok: boolean;
      files: typeof knowledgeFiles;
    }>('/api/knowledge/files');
    setKnowledgeFiles(res.files || []);
  };

  const openKnowledgeFile = async (filePath: string, name: string) => {
    if (
      knowledgeFileContent !== knowledgeFileOriginal &&
      knowledgeFileOriginal &&
      activeKnowledgeFile &&
      activeKnowledgeFile.path !== filePath
    ) {
      const ok = window.confirm('Discard unsaved changes to the current knowledge file?');
      if (!ok) return;
    }
    setKnowledgeFileStatus('Loading…');
    try {
      const res = await fetchJson<{
        ok: boolean;
        content: string;
        path: string;
        size: number;
        modifiedAt: string;
        exists: boolean;
      }>(`/api/knowledge/read?path=${encodeURIComponent(filePath)}`);
      setActiveKnowledgeFile({ path: filePath, name });
      setKnowledgeFileContent(res.content || '');
      setKnowledgeFileOriginal(res.content || '');
      setKnowledgeFileStatus(res.exists ? 'Loaded.' : 'Empty.');
    } catch (err) {
      setKnowledgeFileStatus(
        `Load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const saveKnowledgeFile = async () => {
    if (!activeKnowledgeFile) return;
    setKnowledgeFileStatus('Saving…');
    try {
      await fetchJson('/api/knowledge/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activeKnowledgeFile.path,
          content: knowledgeFileContent,
          mode: knowledgeWriteMode,
        }),
      });
      if (knowledgeWriteMode === 'replace') {
        setKnowledgeFileOriginal(knowledgeFileContent);
      }
      setKnowledgeFileStatus(`Saved (${knowledgeWriteMode}).`);
      setLastKnowledgeSaveMode(knowledgeWriteMode);
      await refreshKnowledgeFiles();
      await fetchJson<Record<string, unknown>>('/api/knowledge')
        .then(setKnowledge)
        .catch(() => null);
    } catch (err) {
      setKnowledgeFileStatus(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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

  // Memory file tree refresh when active group changes
  useEffect(() => {
    if (activeMemoryGroup) {
      void refreshMemoryFiles(activeMemoryGroup);
    }
  }, [activeMemoryGroup]);

  // Lazy-load memory groups/knowledge files on first tab visit
  useEffect(() => {
    if (activeTab === 'memory' && memoryGroups.length === 0) {
      void refreshMemoryGroups();
    }
    if (activeTab === 'knowledge' && knowledgeFiles.length === 0) {
      void refreshKnowledgeFiles();
    }
  }, [activeTab, memoryGroups.length, knowledgeFiles.length]);

  // Memory tab: once groups + files are loaded and no file is open,
  // auto-open the first file so the editor is never empty and clicking
  // a file in the sidebar always has a previous-selection context.
  useEffect(() => {
    if (
      activeTab !== 'memory' ||
      memoryGroups.length === 0 ||
      activeMemoryFile
    ) {
      return;
    }
    const targetGroup =
      activeMemoryGroup || memoryGroups[0]?.folder || '';
    if (!targetGroup || memoryFiles.length === 0) return;
    const firstReadable = memoryFiles.find((file) => file.exists) ||
      memoryFiles[0];
    if (firstReadable) {
      void openMemoryFile(targetGroup, firstReadable.path);
    }
  }, [
    activeTab,
    memoryGroups.length,
    activeMemoryGroup,
    memoryFiles.length,
    activeMemoryFile,
  ]);

  // System tab: auto-load the composed system prompt on first visit and
  // when the active session changes, so the tab is never blank.
  useEffect(() => {
    if (activeTab === 'system' && systemPreview === null) {
      void loadSystemPreview().catch(() => null);
    }
  }, [activeTab, systemPreview, activeSession]);

  // System tab: auto-load the main-group file list so the system file
  // cards are populated without manual reload.
  useEffect(() => {
    if (activeTab === 'system') {
      void refreshMemoryFiles('main').catch(() => null);
    }
  }, [activeTab]);

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
      <div className={`app app--${view.layout}${
        view.chatFocus && activeTab === 'chat' ? ' app--chat-focus' : ''
      }`}>
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
            <label
              className={`masthead__focus${activeTab === 'chat' ? '' : ' masthead__focus--disabled'}`}
              title={
                activeTab === 'chat'
                  ? 'Hide everything except the chat panel'
                  : 'Switch to the Chat tab to use chat focus'
              }
            >
              <input
                type="checkbox"
                checked={view.chatFocus}
                disabled={activeTab !== 'chat'}
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
              title={
                activeTab === 'sessions'
                  ? `History · ${activeSession}`
                  : `Live Chat · ${activeSession}`
              }
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
                      {activeTab === 'sessions'
                        ? 'No messages yet for this session. Switch to the Chat tab to send a prompt.'
                        : 'No messages yet. Send a prompt to start a run.'}
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
                {activeTab === 'chat' ? (
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
                ) : null}
              </>
            ) : null}
          </article>
          {activeTab === 'chat' ? (
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
          ) : null}
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
            />
            {filesEditorPanel.open ? (
              <Editor
                title={activeFile ? activeFile.path : 'No file selected'}
                subtitle={
                  activeFile
                    ? `${activeFile.root} · ${fileStatus || (fileContent === fileOriginal ? 'loaded' : 'modified')}`
                    : 'Pick a file on the left'
                }
                value={fileContent}
                original={fileOriginal}
                onChange={setFileContent}
                showPreview={activeFile?.path.toLowerCase().endsWith('.md') || activeFile?.path.toLowerCase().endsWith('.markdown') || false}
                onReload={
                  activeFile
                    ? () => void openFile(activeFile.root, activeFile.path)
                    : undefined
                }
                onSave={activeFile ? () => void saveFile() : undefined}
                saveDisabled={!activeFile || fileContent === fileOriginal}
                status={fileStatus}
                emptyHint={
                  activeFile
                    ? 'File is empty.'
                    : 'Select a file in the browser to view or edit it.'
                }
              />
            ) : null}
          </article>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="system-tab-section">
          <article className="panel system-files-panel">
            <PanelHeader
              title="System Files"
              actions={
                <>
                  <button
                    type="button"
                    onClick={() => void loadSystemPreview()}
                    title="Show the composed system prompt"
                  >
                    Composed
                  </button>
                  <button
                    type="button"
                    onClick={() => void refreshMemoryFiles('main')}
                    title="Reload file list from disk"
                  >
                    Reload
                  </button>
                </>
              }
            />
            <p className="files-path">
              Markdown files in the main workspace that shape the system message.
              Click to view.
            </p>
            <div className="system-file-list">
              {(() => {
                const SYSTEM_FILE_ORDER = [
                  'NANO.md',
                  'SOUL.md',
                  'IDENTITY.md',
                  'TOOLS.md',
                  'USER.md',
                  'AGENTS.md',
                  'PRINCIPLES.md',
                  'HEARTBEAT.md',
                  'BOOTSTRAP.md',
                ];
                const sysFiles = memoryFiles.filter((f) =>
                  SYSTEM_FILE_ORDER.includes(f.name),
                );
                const ordered = SYSTEM_FILE_ORDER.map((name) =>
                  sysFiles.find((f) => f.name === name),
                ).filter(Boolean);
                if (ordered.length === 0) {
                  return (
                    <p className="empty-state">
                      Loading system files… If this persists, click Reload.
                    </p>
                  );
                }
                return ordered.map((file) => (
                  <button
                    key={file!.path}
                    type="button"
                    className={`system-file-card${
                      activeMemoryFile &&
                      activeMemoryFile.path === file!.path
                        ? ' active'
                        : ''
                    }`}
                    onClick={() => void openMemoryFile('main', file!.path)}
                  >
                    <div className="system-file-card__head">
                      <strong>{file!.name}</strong>
                      <span className="meta">
                        {file!.exists ? `${file!.size}b` : 'missing'} ·{' '}
                        {shortTime(file!.modifiedAt)}
                      </span>
                    </div>
                    <p className="system-file-card__hint">
                      {file!.name === 'NANO.md' && 'Agent identity, role, and capabilities.'}
                      {file!.name === 'SOUL.md' && 'Core values, principles, voice.'}
                      {file!.name === 'IDENTITY.md' && 'Who the agent is and how it presents itself.'}
                      {file!.name === 'TOOLS.md' && 'Tool surface and usage conventions.'}
                      {file!.name === 'USER.md' && 'About the human in the loop.'}
                      {file!.name === 'AGENTS.md' && 'Subagent patterns and delegation rules.'}
                      {file!.name === 'PRINCIPLES.md' && 'Operating principles.'}
                      {file!.name === 'HEARTBEAT.md' && 'Periodic self-check cadence.'}
                      {file!.name === 'BOOTSTRAP.md' && 'First-run setup script.'}
                    </p>
                  </button>
                ));
              })()}
            </div>
          </article>
          <article
            className="panel system-viewer-panel"
            style={{ flex: 1, minWidth: 0, minHeight: 0 }}
          >
            {activeMemoryFile && activeMemoryFile.group === 'main' ? (
              <Editor
                title={activeMemoryFile.path}
                subtitle={`group=${activeMemoryFile.group} · system prompt source`}
                value={memoryFileContent}
                original={memoryFileOriginal}
                onChange={setMemoryFileContent}
                onReload={() =>
                  void openMemoryFile(activeMemoryFile.group, activeMemoryFile.path)
                }
                onSave={() => void saveMemoryFile()}
                saveDisabled={memoryFileContent === memoryFileOriginal}
                status={memoryFileStatus}
                showPreview={true}
                emptyHint="Pick a system file from the left to view or edit it."
              />
            ) : (
              <div className="editor-shell">
                <div className="editor-shell__head">
                  <div className="editor-shell__title">
                    <strong>System Prompt Editor</strong>
                    <small>Pick a system file from the left to begin</small>
                  </div>
                </div>
                <div className="editor-shell__empty">
                  These .md files are concatenated into the system message sent
                  to the model. Edits take effect on the next run. Click
                  <strong> Composed</strong> above to preview the final
                  assembled system prompt.
                </div>
                <div className="editor-shell__footer">
                  <span className="editor-shell__status editor-shell__status--saved">
                    Ready
                  </span>
                  <span className="editor-shell__stats">
                    <span>
                      <strong>0</strong> lines
                    </span>
                    <span>
                      <strong>0</strong> words
                    </span>
                    <span>
                      <strong>0</strong> chars
                    </span>
                  </span>
                </div>
              </div>
            )}
          </article>
        </section>
      ) : null}

      {activeTab === 'skills' ? (
        <section
          className={
            skillsSidebarLeft.open && skillsSidebarRight.open
              ? 'tab-sidebar-grid'
              : skillsSidebarLeft.open
                ? 'tab-sidebar-grid tab-sidebar-grid--no-inspector'
                : skillsSidebarRight.open
                  ? 'tab-sidebar-grid tab-sidebar-grid--no-sidebar'
                  : 'tab-sidebar-grid tab-sidebar-grid--solo'
          }
        >
          {skillsSidebarLeft.open ? (
            <aside className="sidebar-left">
              <div className="sidebar-resizer">
                <h2>Skills ({skillGroups.reduce((n, g) => n + g.skills.length, 0)})</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={skillsSidebarLeft.toggle}
                  title="Hide left sidebar"
                >
                  ◀
                </button>
              </div>
              <input
                type="text"
                placeholder="filter by name, path, description"
                className="files-filter"
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
              <div className="sidebar-list">
                {skillGroups.length === 0 ? (
                  <p className="sidebar-empty">
                    No skills indexed. Click Refresh.
                  </p>
                ) : (
                  skillGroups.map((group) => (
                    <div key={group.root.id}>
                      <p className="sidebar-group">{group.root.label}</p>
                      {group.skills.length === 0 ? (
                        <p className="sidebar-empty">no skills</p>
                      ) : (
                        group.skills.map((skill) => (
                          <button
                            key={`${group.root.id}:${skill.path}`}
                            type="button"
                            className={`sidebar-list-item${
                              activeSkill &&
                              activeSkill.root === group.root.id &&
                              activeSkill.path === skill.path
                                ? ' active'
                                : ''
                            }`}
                            onClick={() => void openSkillFile(group.root, skill)}
                          >
                            <strong>{skill.name}</strong>
                            <span className="meta">
                              {skill.path} · {skill.description || 'no description'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="composer-actions">
                <button type="button" onClick={() => void refreshSkills()}>
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void fetchJson('/api/skills/validate', { method: 'POST' }).then(
                      (r) => setSkillStatus(JSON.stringify(r, null, 2)),
                    )
                  }
                >
                  Validate
                </button>
              </div>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={skillsSidebarLeft.toggle}
                title="Show left sidebar"
              >
                ▶ Skills
              </button>
            </div>
          )}
          <div className="tab-main">
            <article
              className="panel"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                padding: 0,
                border: 0,
                boxShadow: 'none',
                background: 'transparent',
              }}
            >
              {activeSkill ? (
                <Editor
                  title={activeSkill.name}
                  subtitle={`${activeSkill.root}:${activeSkill.path}`}
                  value={skillFileContent}
                  original={skillFileOriginal}
                  onChange={setSkillFileContent}
                  onReload={() => {
                    const target = skillGroups
                      .flatMap((g) =>
                        g.skills.map((s) => ({ root: g.root, skill: s })),
                      )
                      .find(
                        (x) =>
                          x.root.id === activeSkill.root &&
                          x.skill.path === activeSkill.path,
                      );
                    if (target) void openSkillFile(target.root, target.skill);
                  }}
                  onSave={() => void saveSkillFile()}
                  saveDisabled={skillFileContent === skillFileOriginal}
                  status={skillFileStatus}
                  emptyHint="Select a skill on the left to view or edit its SKILL.md."
                />
              ) : (
                <div className="editor-shell">
                  <div className="editor-shell__head">
                    <div className="editor-shell__title">
                      <strong>Skill Editor</strong>
                      <small>Pick a skill from the left sidebar to begin</small>
                    </div>
                  </div>
                  <div className="editor-shell__empty">
                    Select a skill on the left to view or edit its SKILL.md.
                  </div>
                  <div className="editor-shell__footer">
                    <span className="editor-shell__status editor-shell__status--saved">
                      No file open
                    </span>
                    <span className="editor-shell__stats">
                      <span>
                        <strong>0</strong> lines
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </article>
          </div>
          {skillsSidebarRight.open ? (
            <aside className="sidebar-right">
              <div className="sidebar-resizer">
                <h2>History &amp; Status</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={skillsSidebarRight.toggle}
                  title="Hide right sidebar"
                >
                  ▶
                </button>
              </div>
              {activeSkill ? (
                <>
                  <p className="files-path">
                    Versions: {skillHistory.length} snapshot(s)
                  </p>
                  <div className="history-list">
                    {skillHistory.length === 0 ? (
                      <p className="sidebar-empty">No history yet.</p>
                    ) : (
                      skillHistory
                        .slice()
                        .reverse()
                        .map((entry) => (
                          <div key={entry.version} className="history-item">
                            <div>
                              <strong>{entry.version}</strong>
                              <br />
                              <span className="meta">
                                {entry.size}b · {shortTime(entry.modifiedAt)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void rollbackSkillFile(entry.version)}
                            >
                              Restore
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              ) : (
                <p className="sidebar-empty">Select a skill to view history.</p>
              )}
              <h3>Validation</h3>
              <pre className="service-output">
                {skillStatus || 'Run Validate to see results.'}
              </pre>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={skillsSidebarRight.toggle}
                title="Show right sidebar"
              >
                ◀ History
              </button>
            </div>
          )}
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
        <section
          className={
            memorySidebarLeft.open && memorySidebarRight.open
              ? 'tab-sidebar-grid'
              : memorySidebarLeft.open
                ? 'tab-sidebar-grid tab-sidebar-grid--no-inspector'
                : memorySidebarRight.open
                  ? 'tab-sidebar-grid tab-sidebar-grid--no-sidebar'
                  : 'tab-sidebar-grid tab-sidebar-grid--solo'
          }
        >
          {memorySidebarLeft.open ? (
            <aside className="sidebar-left">
              <div className="sidebar-resizer">
                <h2>Memory Groups</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={() => {
                    void refreshMemoryGroups();
                    if (activeMemoryGroup) {
                      void refreshMemoryFiles(activeMemoryGroup);
                    }
                  }}
                  title="Reload groups and files from disk"
                >
                  ↻
                </button>
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={memorySidebarLeft.toggle}
                  title="Hide left sidebar"
                >
                  ◀
                </button>
              </div>
              <div className="sidebar-list">
                {memoryGroups.length === 0 ? (
                  <p className="sidebar-empty">No groups found.</p>
                ) : (
                  memoryGroups.map((group) => (
                    <button
                      key={group.folder}
                      type="button"
                      className={`sidebar-list-item${
                        activeMemoryGroup === group.folder ? ' active' : ''
                      }`}
                      onClick={() => {
                        setActiveMemoryGroup(group.folder);
                        setActiveMemoryFile(null);
                        setMemoryFileContent('');
                        setMemoryFileOriginal('');
                        setMemoryHistory([]);
                      }}
                    >
                      <strong>
                        {group.isMain
                          ? 'main (workspace)'
                          : group.folder}
                      </strong>
                      <span className="meta">{group.workspaceDir}</span>
                    </button>
                  ))
                )}
              </div>
              <p className="sidebar-group">
                Files ({memoryFiles.length})
              </p>
              <div className="sidebar-list">
                {memoryFiles.length === 0 ? (
                  <p className="sidebar-empty">
                    {activeMemoryGroup
                      ? 'No files indexed.'
                      : 'Select a group above.'}
                  </p>
                ) : (
                  memoryFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className={`sidebar-list-item${
                        activeMemoryFile &&
                        activeMemoryFile.group === activeMemoryGroup &&
                        activeMemoryFile.path === file.path
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => {
                        const group = activeMemoryGroup ||
                          memoryGroups[0]?.folder || '';
                        if (!group) return;
                        if (group !== activeMemoryGroup) {
                          setActiveMemoryGroup(group);
                          setActiveMemoryFile(null);
                        }
                        void openMemoryFile(group, file.path);
                      }}
                    >
                      <strong>{file.name}</strong>
                      <span className="meta">
                        <span className="sidebar-kind">{file.kind}</span> ·{' '}
                        {file.exists ? `${file.size}b` : 'missing'} ·{' '}
                        {shortTime(file.modifiedAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={memorySidebarLeft.toggle}
                title="Show left sidebar"
              >
                ▶ Memory
              </button>
            </div>
          )}
          <div className="tab-main">
            <article
              className="panel"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                padding: 0,
                border: 0,
                boxShadow: 'none',
                background: 'transparent',
              }}
            >
              {activeMemoryFile ? (
                <Editor
                  title={activeMemoryFile.path}
                  subtitle={`group=${activeMemoryFile.group} · ${activeMemoryFile.path}`}
                  value={memoryFileContent}
                  original={memoryFileOriginal}
                  onChange={setMemoryFileContent}
                  onReload={() =>
                    void openMemoryFile(
                      activeMemoryFile.group,
                      activeMemoryFile.path,
                    )
                  }
                  onSave={() => void saveMemoryFile()}
                  saveDisabled={memoryFileContent === memoryFileOriginal}
                  status={memoryFileStatus}
                  emptyHint="Select a group and a file in the left sidebar to view or edit durable memory, canonical notes, or NANO/SOUL/TODOS files."
                />
              ) : (
                <div className="editor-shell">
                  <div className="editor-shell__head">
                    <div className="editor-shell__title">
                      <strong>Memory Editor</strong>
                      <small>Pick a group and file from the left sidebar</small>
                    </div>
                  </div>
                  <div className="editor-shell__empty">
                    Select a group and a file in the left sidebar to view or edit
                    durable memory, canonical notes, or NANO/SOUL/TODOS files.
                  </div>
                  <div className="editor-shell__footer">
                    <span className="editor-shell__status editor-shell__status--saved">
                      No file open
                    </span>
                    <span className="editor-shell__stats">
                      <span>
                        <strong>0</strong> lines
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </article>
          </div>
          {memorySidebarRight.open ? (
            <aside className="sidebar-right">
              <div className="sidebar-resizer">
                <h2>Version History</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={() => {
                    if (activeMemoryFile) {
                      void loadMemoryHistory(
                        activeMemoryFile.group,
                        activeMemoryFile.path,
                      );
                    }
                  }}
                  title="Reload version history from disk"
                >
                  ↻
                </button>
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={memorySidebarRight.toggle}
                  title="Hide right sidebar"
                >
                  ▶
                </button>
              </div>
              {activeMemoryFile ? (
                <>
                  <p className="files-path">
                    {memoryHistory.length} snapshot(s)
                  </p>
                  <div className="history-list">
                    {memoryHistory.length === 0 ? (
                      <p className="sidebar-empty">No history yet.</p>
                    ) : (
                      memoryHistory
                        .slice()
                        .reverse()
                        .map((entry) => (
                          <div key={entry.version} className="history-item">
                            <div>
                              <strong>{entry.version}</strong>
                              <br />
                              <span className="meta">
                                {entry.size}b · {shortTime(entry.modifiedAt)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => void rollbackMemoryFile(entry.version)}
                            >
                              Restore
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              ) : (
                <p className="sidebar-empty">
                  Open a file to view its history.
                </p>
              )}
              <h3>Active File</h3>
              <pre className="service-output">
                {activeMemoryFile
                  ? JSON.stringify(
                      {
                        group: activeMemoryFile.group,
                        path: activeMemoryFile.path,
                        bytes: memoryFileOriginal.length,
                        snapshots: memoryHistory.length,
                        lastStatus: memoryFileStatus,
                      },
                      null,
                      2,
                    )
                  : 'No file open.'}
              </pre>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={memorySidebarRight.toggle}
                title="Show right sidebar"
              >
                ◀ History
              </button>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'knowledge' ? (
        <section
          className={
            knowledgeSidebarLeft.open && knowledgeSidebarRight.open
              ? 'tab-sidebar-grid'
              : knowledgeSidebarLeft.open
                ? 'tab-sidebar-grid tab-sidebar-grid--no-inspector'
                : knowledgeSidebarRight.open
                  ? 'tab-sidebar-grid tab-sidebar-grid--no-sidebar'
                  : 'tab-sidebar-grid tab-sidebar-grid--solo'
          }
        >
          {knowledgeSidebarLeft.open ? (
            <aside className="sidebar-left">
              <div className="sidebar-resizer">
                <h2>Knowledge Files</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={knowledgeSidebarLeft.toggle}
                  title="Hide left sidebar"
                >
                  ◀
                </button>
              </div>
              <p className="files-path">
                ready {knowledgeStatus?.ready ? 'yes' : 'no'} · raw{' '}
                {knowledgeStatus?.rawCaptureCount ?? 0} · wiki docs{' '}
                {knowledgeStatus?.wikiDocCount ?? 0}
              </p>
              <p className="sidebar-group">Capture</p>
              <textarea
                value={knowledgeNote}
                onChange={(event) => setKnowledgeNote(event.target.value)}
                placeholder="Capture a raw knowledge note for later curation..."
                style={{ minHeight: 60 }}
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
                <button
                  type="button"
                  onClick={() => void refreshKnowledgeFiles()}
                >
                  Refresh
                </button>
              </div>
              <p className="sidebar-group">Files ({knowledgeFiles.length})</p>
              <div className="sidebar-list">
                {knowledgeFiles.length === 0 ? (
                  <p className="sidebar-empty">No knowledge files yet.</p>
                ) : (
                  knowledgeFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      className={`sidebar-list-item${
                        activeKnowledgeFile &&
                        activeKnowledgeFile.path === file.path
                          ? ' active'
                          : ''
                      }`}
                      onClick={() => void openKnowledgeFile(file.path, file.name)}
                    >
                      <strong>{file.name}</strong>
                      <span className="meta">
                        <span className="sidebar-kind">{file.kind}</span> ·{' '}
                        {file.size}b · {shortTime(file.modifiedAt)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={knowledgeSidebarLeft.toggle}
                title="Show left sidebar"
              >
                ▶ Knowledge
              </button>
            </div>
          )}
          <div className="tab-main">
            <article
              className="panel"
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                padding: 0,
                border: 0,
                boxShadow: 'none',
                background: 'transparent',
              }}
            >
              {activeKnowledgeFile ? (
                <Editor
                  title={activeKnowledgeFile.name}
                  subtitle={activeKnowledgeFile.path}
                  value={knowledgeFileContent}
                  original={knowledgeFileOriginal}
                  onChange={setKnowledgeFileContent}
                  extraActions={
                    <select
                      value={knowledgeWriteMode}
                      onChange={(event) =>
                        setKnowledgeWriteMode(
                          event.target.value as 'replace' | 'append',
                        )
                      }
                      title="Save mode"
                      style={{
                        fontSize: '0.7rem',
                        padding: '0.25rem 0.4rem',
                        border: '2px solid var(--border)',
                        background: '#fff',
                        color: 'var(--ink)',
                        fontFamily:
                          'Menlo, SFMono-Regular, IBM Plex Mono, monospace',
                      }}
                    >
                      <option value="replace">Replace</option>
                      <option value="append">Append</option>
                    </select>
                  }
                  onReload={() =>
                    void openKnowledgeFile(
                      activeKnowledgeFile.path,
                      activeKnowledgeFile.name,
                    )
                  }
                  onSave={() => void saveKnowledgeFile()}
                  saveLabel={`Save (${knowledgeWriteMode})`}
                  status={
                    lastKnowledgeSaveMode === 'append'
                      ? 'Append mode — current content will be kept'
                      : knowledgeFileStatus
                  }
                  emptyHint="Select a knowledge file on the left to view or edit the curated wiki, raw captures, schema, or reports."
                />
              ) : (
                <div className="editor-shell">
                  <div className="editor-shell__head">
                    <div className="editor-shell__title">
                      <strong>Knowledge Editor</strong>
                      <small>Pick a file from the left sidebar</small>
                    </div>
                  </div>
                  <div className="editor-shell__empty">
                    Select a knowledge file on the left to view or edit the
                    curated wiki, raw captures, schema, or reports.
                  </div>
                  <div className="editor-shell__footer">
                    <span className="editor-shell__status editor-shell__status--saved">
                      No file open
                    </span>
                    <span className="editor-shell__stats">
                      <span>
                        <strong>0</strong> lines
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </article>
            <article
              className="panel"
              style={{ flexShrink: 0, maxHeight: 240, overflow: 'auto' }}
            >
              <PanelHeader title="Curator Log" />
              <MarkdownLite text={knowledgeWiki?.log || ''} />
            </article>
          </div>
          {knowledgeSidebarRight.open ? (
            <aside className="sidebar-right">
              <div className="sidebar-resizer">
                <h2>Wiki &amp; Reports</h2>
                <span className="sidebar-resizer-spacer" />
                <button
                  type="button"
                  className="tab-sidebar-toggle"
                  onClick={knowledgeSidebarRight.toggle}
                  title="Hide right sidebar"
                >
                  ▶
                </button>
              </div>
              <h3>Index</h3>
              <MarkdownLite text={knowledgeWiki?.index || ''} />
              <h3>Progress</h3>
              <MarkdownLite text={knowledgeWiki?.progress || ''} />
              <h3>Recent Reports</h3>
              <pre className="service-output">
                {JSON.stringify(knowledgeRecord.reports || [], null, 2)}
              </pre>
              <h3>Status JSON</h3>
              <pre className="service-output">
                {JSON.stringify(knowledgeStatus || {}, null, 2)}
              </pre>
            </aside>
          ) : (
            <div className="sidebar-collapsed">
              <button
                type="button"
                className="tab-sidebar-toggle"
                onClick={knowledgeSidebarRight.toggle}
                title="Show right sidebar"
              >
                ◀ Wiki
              </button>
            </div>
          )}
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
