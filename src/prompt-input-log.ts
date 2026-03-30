import fs from 'fs';
import path from 'path';

import type { PromptInputLogEntry } from './message-dispatch.js';
import { resolveGroupFolderPath } from './group-folder.js';

export function resolvePromptInputLogPath(
  groupFolder: string,
  requestId: string,
): string {
  const groupDir = resolveGroupFolderPath(groupFolder);
  const safeId = requestId.replace(/[^a-zA-Z0-9._-]+/g, '-');
  return path.join(groupDir, 'logs', 'prompt-inputs', `${safeId}.json`);
}

export function writePromptInputLogFile(entry: PromptInputLogEntry): void {
  const outPath = resolvePromptInputLogPath(entry.groupFolder, entry.requestId);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(entry, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, outPath);
}
