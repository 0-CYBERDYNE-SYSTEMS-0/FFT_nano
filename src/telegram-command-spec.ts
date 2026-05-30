export const TELEGRAM_COMMON_COMMANDS = [
  { command: 'help', description: 'Show command help' },
  { command: 'status', description: 'Show runtime status' },
  { command: 'title', description: 'Show/set session title' },
  { command: 'id', description: 'Show this chat id' },
  { command: 'models', description: 'List available models' },
  { command: 'model', description: 'Show/set model override' },
  { command: 'think', description: 'Show/set thinking level' },
  { command: 'reasoning', description: 'Show/set reasoning visibility' },
  { command: 'delivery', description: 'Show/set Telegram text delivery mode' },
  { command: 'verbose', description: 'Cycle or set tool progress mode' },
  { command: 'new', description: 'Start a fresh session' },
  { command: 'reset', description: 'Reset session (alias for /new)' },
  { command: 'stop', description: 'Stop current run' },
  { command: 'usage', description: 'Show usage counters' },
  { command: 'queue', description: 'Show/set queue behavior' },
  { command: 'compact', description: 'Compact session context' },
] as const;

export const TELEGRAM_ADMIN_COMMANDS = [
  { command: 'main', description: 'Claim this chat as main/admin' },
  { command: 'freechat', description: 'Manage non-main free-chat allowlist' },
  {
    command: 'gateway',
    description: 'Gateway service ops: /gateway status|restart|doctor',
  },
  { command: 'restart', description: 'Alias for /gateway restart' },
  {
    command: 'setup',
    description: 'Open runtime setup wizard for provider/model/key',
  },
  { command: 'coder', description: 'Delegate coding execution' },
  { command: 'coding', description: 'Alias for /coder' },
  { command: 'coder_plan', description: 'Delegate coding plan-only' },
  { command: 'subagents', description: 'List/stop/spawn subagent runs' },
  { command: 'run', description: 'Start a durable long agent run' },
  { command: 'runs', description: 'List recent long agent runs' },
  { command: 'run_status', description: 'Show long run status' },
  { command: 'cancel_run', description: 'Cancel a long agent run' },
  {
    command: 'skill_manager',
    description: 'Manage skill lifecycle (stale detection, archiving, backups)',
  },
  {
    command: 'librarian',
    description: 'Knowledge wiki controls (status, lint, capture, run)',
  },
  {
    command: 'reflect',
    description: 'Reflect on recent work; save only durable learning',
  },
  { command: 'tasks', description: 'List scheduled tasks' },
  { command: 'knowledge', description: 'Manage knowledge wiki/librarian' },
  { command: 'task_pause', description: 'Pause a task: /task_pause <id>' },
  { command: 'task_resume', description: 'Resume a task: /task_resume <id>' },
  { command: 'task_cancel', description: 'Cancel a task: /task_cancel <id>' },
  { command: 'groups', description: 'List registered groups' },
  { command: 'reload', description: 'Refresh command state and metadata' },
  { command: 'panel', description: 'Open admin panel buttons' },
  {
    command: 'update',
    description: 'Preserve local changes, pull, rebuild, and restart',
  },
] as const;

export type TelegramCommandName =
  | '/help'
  | '/status'
  | '/title'
  | '/id'
  | '/models'
  | '/model'
  | '/think'
  | '/thinking'
  | '/t'
  | '/reasoning'
  | '/reason'
  | '/delivery'
  | '/text_delivery'
  | '/verbose'
  | '/v'
  | '/new'
  | '/reset'
  | '/stop'
  | '/usage'
  | '/queue'
  | '/compact'
  | '/subagents'
  | '/run'
  | '/runs'
  | '/run-status'
  | '/run_status'
  | '/cancel-run'
  | '/cancel_run'
  | '/skill-manager'
  | '/skill_manager'
  | '/librarian'
  | '/curator'
  | '/reflect'
  | '/main'
  | '/gateway'
  | '/restart'
  | '/setup'
  | '/tasks'
  | '/knowledge'
  | '/task_pause'
  | '/task_resume'
  | '/task_cancel'
  | '/groups'
  | '/reload'
  | '/panel'
  | '/update'
  | '/coder'
  | '/coding'
  | '/coder-plan'
  | '/coder_plan'
  | '/freechat';

const KNOWN_TELEGRAM_COMMANDS: Set<TelegramCommandName> = new Set([
  '/help',
  '/status',
  '/title',
  '/id',
  '/models',
  '/model',
  '/think',
  '/thinking',
  '/t',
  '/reasoning',
  '/reason',
  '/delivery',
  '/text_delivery',
  '/verbose',
  '/v',
  '/new',
  '/reset',
  '/stop',
  '/usage',
  '/queue',
  '/compact',
  '/subagents',
  '/run',
  '/runs',
  '/run-status',
  '/run_status',
  '/cancel-run',
  '/cancel_run',
  '/skill-manager',
  '/skill_manager',
  '/librarian',
  '/curator',
  '/reflect',
  '/main',
  '/gateway',
  '/restart',
  '/setup',
  '/tasks',
  '/knowledge',
  '/task_pause',
  '/task_resume',
  '/task_cancel',
  '/groups',
  '/reload',
  '/panel',
  '/update',
  '/coder',
  '/coding',
  '/coder-plan',
  '/coder_plan',
  '/freechat',
]);

export function normalizeTelegramCommandToken(
  token: string,
): TelegramCommandName | null {
  if (!token.startsWith('/')) return null;
  const normalized = token.split('@')[0]?.toLowerCase();
  if (!normalized) return null;
  const commandToken = normalized.split(':')[0] || normalized;
  const command = commandToken as TelegramCommandName;
  return KNOWN_TELEGRAM_COMMANDS.has(command) ? command : null;
}

export function formatHelpText(isMainGroup: boolean): string {
  const common = [
    '/help - show this help',
    '/status - runtime and queue status',
    '/title [text|reset] - set a per-chat session title',
    '/id - show current Telegram chat id',
    '/models [query] - list/search available models',
    '/model [provider/model|reset] - show/set chat model',
    '/think [off|minimal|low|medium|high|xhigh] - set thinking level',
    '/reasoning [off|on|stream] - set reasoning visibility mode',
    '/delivery [stream|append|off|draft] - set Telegram text delivery mode',
    '/verbose [/v] [off|new|all|verbose] - cycle or set tool progress mode',
    '/new - start fresh session on next run',
    '/reset - alias for /new',
    '/stop - stop the current in-flight run',
    '/usage [all|reset] - usage counters',
    '/queue [mode/debounce/cap/drop] - queue policy for this chat',
    '/compact [instructions] - summarize + roll session',
  ];
  if (!isMainGroup) {
    return [
      'Telegram commands:',
      ...common,
      '',
      'Admin commands are only available in the main chat for safety.',
    ].join('\n');
  }

  return [
    'Telegram commands (main/admin):',
    ...common,
    '/main <secret> - claim chat as main/admin',
    '/gateway status|restart|doctor - host service + diagnostics',
    '/restart - alias for /gateway restart',
    '/setup [cancel] - runtime setup wizard for provider/model/key',
    '/tasks [list|due|detail|runs] - inspect scheduled tasks',
    '/knowledge [status|init|task|ingest|lint] - knowledge wiki/librarian controls',
    '/task_pause <id> - pause task',
    '/task_resume <id> - resume task',
    '/task_cancel <id> - cancel task',
    '/groups - list registered groups',
    '/freechat add <chatId> - enable free chat in a non-main Telegram chat',
    '/freechat remove <chatId> - disable free chat in a non-main Telegram chat',
    '/freechat list - list chats with free chat enabled',
    '/reload - refresh command menus and group metadata',
    '/panel - open admin quick actions',
    '/update - preserve local changes, pull latest code, rebuild, and restart service',
    '/coder <task> - explicit delegated coding run',
    '/coding <task> - alias for /coder',
    '/coder-plan <task> - explicit delegated planning run',
    '/subagents list|stop|spawn - manage delegated subagent runs',
    '/run <task> - start a durable long normal-agent run',
    '/runs - list recent long normal-agent runs',
    '/run-status <id> - show long run status',
    '/cancel-run <id> - cancel an active long run',
    '/skill-manager status|dry-run|run|pause|resume|pin|unpin|archive|restore|backup - manage skill lifecycle',
    '/reflect [dry-run] [focus] - reflect on recent work and save only durable learning (memory/skill); no-ops when nothing is reusable',
    '/librarian status|lint|capture|run|dry-run|log|progress - manage knowledge wiki',
    '/curator status|dry-run|run|pause|resume|pin|unpin|archive|restore|backup - [DEPRECATED: use /skill-manager]',
  ].join('\n');
}
