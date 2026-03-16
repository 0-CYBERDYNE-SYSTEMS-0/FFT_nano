import path from 'path';

function clean(value: string | undefined, fallback: string): string {
  const trimmed = (value || '').trim();
  return trimmed || fallback;
}

export const WORKSPACE_ROOT_DIR = clean(
  process.env.FFT_AGENT_WORKSPACE_ROOT_DIR,
  '/workspace',
);
export const WORKSPACE_GROUP_DIR = clean(
  process.env.FFT_AGENT_WORKSPACE_GROUP_DIR,
  path.join(WORKSPACE_ROOT_DIR, 'group'),
);
export const WORKSPACE_PROJECT_DIR = clean(
  process.env.FFT_AGENT_WORKSPACE_PROJECT_DIR,
  path.join(WORKSPACE_ROOT_DIR, 'project'),
);
export const WORKSPACE_GLOBAL_DIR = clean(
  process.env.FFT_AGENT_WORKSPACE_GLOBAL_DIR,
  path.join(WORKSPACE_ROOT_DIR, 'global'),
);
export const WORKSPACE_IPC_DIR = clean(
  process.env.FFT_AGENT_WORKSPACE_IPC_DIR,
  path.join(WORKSPACE_ROOT_DIR, 'ipc'),
);

export const WORKSPACE_IPC_MESSAGES_DIR = path.join(WORKSPACE_IPC_DIR, 'messages');
export const WORKSPACE_IPC_ACTIONS_DIR = path.join(WORKSPACE_IPC_DIR, 'actions');
export const WORKSPACE_IPC_ACTION_RESULTS_DIR = path.join(
  WORKSPACE_IPC_DIR,
  'action_results',
);

export const PI_HOME_DIR = clean(process.env.FFT_AGENT_PI_HOME_DIR, '/home/node/.pi');
export const PI_AGENT_FFT_DIR = clean(
  process.env.FFT_AGENT_PI_AGENT_DIR,
  path.join(PI_HOME_DIR, 'agent-fft'),
);
export const PI_AGENT_CODER_DIR = clean(
  process.env.FFT_AGENT_CODER_AGENT_DIR,
  path.join(PI_HOME_DIR, 'agent-coder'),
);
export const PI_ON_PI_EXTENSION_PATH = clean(
  process.env.FFT_AGENT_PI_ON_PI_EXTENSION_PATH,
  '/app/dist/extensions/pi-on-pi.js',
);

const ALLOWED_ABSOLUTE_ROOTS = [
  WORKSPACE_ROOT_DIR,
  WORKSPACE_PROJECT_DIR,
  WORKSPACE_GROUP_DIR,
  WORKSPACE_GLOBAL_DIR,
  WORKSPACE_IPC_DIR,
]
  .map((entry) => clean(entry, ''))
  .filter((entry) => entry.length > 0);

export function isAllowedWorkspaceAbsolutePath(candidatePath: string): boolean {
  if (!path.isAbsolute(candidatePath)) return true;
  return ALLOWED_ABSOLUTE_ROOTS.some((root) => {
    if (candidatePath === root) return true;
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    return candidatePath.startsWith(prefix);
  });
}
