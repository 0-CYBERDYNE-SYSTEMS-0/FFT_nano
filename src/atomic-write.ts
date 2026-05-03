import fs from 'fs';
import path from 'path';

function uniqueTempPath(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function backupExistingFile(filePath: string, backupPath: string): void {
  if (!fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(filePath, backupPath);
}

export function writeTextFileAtomic(
  filePath: string,
  content: string,
  options: { backupPath?: string } = {},
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (options.backupPath) {
    backupExistingFile(filePath, options.backupPath);
  }
  const tmpPath = uniqueTempPath(filePath);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore cleanup errors */
    }
    throw err;
  }
}

export function writeJsonFileAtomic(
  filePath: string,
  payload: unknown,
  options: { backupPath?: string } = {},
): void {
  writeTextFileAtomic(
    filePath,
    `${JSON.stringify(payload, null, 2)}\n`,
    options,
  );
}

export function defaultBackupPath(filePath: string): string {
  return `${filePath}.bak`;
}
