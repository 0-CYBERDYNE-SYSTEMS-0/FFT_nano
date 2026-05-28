import fs from 'fs';
import path from 'path';

/**
 * Create a temporary directory for tests.
 * Uses project data directory to avoid /tmp issues with better-sqlite3 on macOS.
 */
export function makeTestTempDir(prefix = 'fft-test'): string {
  const projectTmp = path.join(process.cwd(), 'data', 'test-db-temp');
  fs.mkdirSync(projectTmp, { recursive: true });
  const dirName = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const dir = path.join(projectTmp, dirName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a temporary file path (file is NOT created).
 * Directory is created under the test temp root.
 */
export function makeTestTempFile(filename: string): string {
  const dir = makeTestTempDir();
  return path.join(dir, filename);
}