import fs from 'fs';
import http from 'http';
import path from 'path';

import type { WebAccessMode } from '../config.js';
import type { ActiveRunStatusDetail } from '../app-state.js';
import { logger } from '../logger.js';

interface RuntimeStatusPayload {
  runtime: string;
  sessions: number;
  activeRuns: number;
  activeRunDetails: ActiveRunStatusDetail[];
}

interface ProfileStatusPayload {
  profile: string;
  featureFarm: boolean;
  profileDetection: {
    source: string;
    reason: string;
  };
}

interface BuildInfoPayload {
  startedAt: string;
  version: string;
  branch?: string;
  commit?: string;
}

interface GatewayStatusPayload {
  host: string;
  port: number;
  authRequired: boolean;
}

export interface WebControlCenterFileRoot {
  id: string;
  label: string;
  path: string;
}

interface NormalizedFileRoot {
  id: string;
  label: string;
  path: string;
}

export interface WebControlCenterAdapters {
  getRuntimeStatus: () => RuntimeStatusPayload;
  getProfileStatus: () => ProfileStatusPayload;
  getBuildInfo: () => BuildInfoPayload;
  getGatewayStatus: () => GatewayStatusPayload;
}

export interface WebControlCenterServerOptions {
  host: string;
  port: number;
  accessMode: WebAccessMode;
  authToken: string;
  staticDir: string;
  logsDir: string;
  fileRoots: WebControlCenterFileRoot[];
}

export interface WebControlCenterServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};
const MAX_FILE_WRITE_BYTES = 1024 * 1024;
const MAX_FILE_READ_BYTES = 1024 * 1024;
const MAX_SKILLS_SCAN_DIRS = 3000;
const MAX_SKILLS_RESULTS_PER_ROOT = 500;

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(
  res: http.ServerResponse,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseLineCount(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 120;
  return Math.max(10, Math.min(1000, parsed));
}

async function readJsonBody<T>(
  req: http.IncomingMessage,
  limitBytes = MAX_FILE_WRITE_BYTES,
): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer | string) => {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += data.byteLength;
      if (total > limitBytes) {
        reject(new Error(`Request body exceeds ${limitBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(data);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {} as T;
  return JSON.parse(raw) as T;
}

function normalizeSubPath(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+/, '');
  return trimmed || '.';
}

function normalizeRelPosix(raw: string): string {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const normalized = path.posix.normalize(cleaned || '.');
  return normalized === '' ? '.' : normalized;
}

function ensureWithinRoot(rootPath: string, subPath: string): string {
  const resolved = path.resolve(rootPath, subPath);
  const rel = path.relative(rootPath, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes root directory');
  }
  return resolved;
}

function ensureRealPathWithinRoot(
  rootPath: string,
  candidatePath: string,
): string {
  const resolvedReal = fs.realpathSync(candidatePath);
  const rootReal = fs.realpathSync(rootPath);
  const rel = path.relative(rootReal, resolvedReal);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes root directory via symlink');
  }
  return resolvedReal;
}

function ensureWritePathWithinRoot(rootPath: string, filePath: string): void {
  const rootReal = fs.realpathSync(rootPath);
  const parentPath = path.dirname(filePath);
  const parentReal = fs.realpathSync(parentPath);
  const relParent = path.relative(rootReal, parentReal);
  if (relParent.startsWith('..') || path.isAbsolute(relParent)) {
    throw new Error('Path escapes root directory via symlink');
  }

  if (!fs.existsSync(filePath)) return;
  const existing = fs.lstatSync(filePath);
  if (existing.isSymbolicLink()) {
    throw new Error('Refusing to write through symlink path');
  }
  ensureRealPathWithinRoot(rootPath, filePath);
}

function ensureWritableParentDirWithinRoot(
  rootPath: string,
  filePath: string,
): void {
  const rootReal = fs.realpathSync(rootPath);
  const targetDir = path.dirname(filePath);
  const relDir = path.relative(rootPath, targetDir);
  if (!relDir || relDir === '.') return;

  const parts = relDir.split(path.sep).filter(Boolean);
  let current = rootPath;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
      continue;
    }
    const existing = fs.lstatSync(current);
    if (existing.isSymbolicLink()) {
      throw new Error('Refusing to traverse symlink directory path');
    }
    if (!existing.isDirectory()) {
      throw new Error('Parent path is not a directory');
    }
    const currentReal = fs.realpathSync(current);
    const rel = path.relative(rootReal, currentReal);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Path escapes root directory via symlink');
    }
  }
}

function listDirectoryEntries(dirPath: string): Array<{
  name: string;
  relPath: string;
  kind: 'file' | 'dir';
  size: number;
  modifiedAt: string;
}> {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const fullPath = path.join(dirPath, entry.name);
      const lstat = fs.lstatSync(fullPath);
      if (lstat.isSymbolicLink()) return null;
      const stat = fs.statSync(fullPath);
      const kind: 'file' | 'dir' = entry.isDirectory() ? 'dir' : 'file';
      return {
        name: entry.name,
        relPath: entry.name,
        kind,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        name: string;
        relPath: string;
        kind: 'file' | 'dir';
        size: number;
        modifiedAt: string;
      } => entry !== null,
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function parseSkillDescription(raw: string): string {
  const text = raw.trim();
  if (!text) return '';

  const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (frontmatterMatch) {
    const body = frontmatterMatch[1] || '';
    const descriptionMatch = body.match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descriptionMatch?.[1]) {
      return descriptionMatch[1].trim();
    }
  }

  const headingMatch = text.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].trim();

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine || '';
}

function scanSkillsCatalogForRoot(root: NormalizedFileRoot): Array<{
  name: string;
  path: string;
  dir: string;
  description: string;
}> {
  const entries: Array<{
    name: string;
    path: string;
    dir: string;
    description: string;
  }> = [];
  const queue = ['.'];
  let visitedDirs = 0;

  while (queue.length > 0) {
    if (
      visitedDirs >= MAX_SKILLS_SCAN_DIRS ||
      entries.length >= MAX_SKILLS_RESULTS_PER_ROOT
    ) {
      break;
    }
    const relDir = queue.shift() || '.';
    const absDir = ensureWithinRoot(root.path, relDir);
    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue;
    }
    visitedDirs += 1;

    const hasSkill = dirEntries.some(
      (entry) => entry.isFile() && entry.name === 'SKILL.md',
    );
    if (hasSkill) {
      const skillRelPath = normalizeRelPosix(
        path.posix.join(relDir === '.' ? '' : relDir, 'SKILL.md'),
      );
      const skillPath = ensureWithinRoot(root.path, skillRelPath);
      let description = '';
      try {
        description = parseSkillDescription(
          fs.readFileSync(skillPath, 'utf-8'),
        );
      } catch {
        description = '';
      }
      const name = relDir === '.' ? root.label : path.basename(relDir);
      entries.push({
        name,
        path: skillRelPath,
        dir: normalizeRelPosix(relDir),
        description,
      });
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const childRel = normalizeRelPosix(
        path.posix.join(relDir === '.' ? '' : relDir, entry.name),
      );
      queue.push(childRel);
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function tailFile(filePath: string, lineCount: number): string {
  if (!fs.existsSync(filePath)) return '';
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return '';
  if (stat.size === 0) return '';

  const maxBytes = 768 * 1024;
  const readSize = Math.min(stat.size, maxBytes);
  const offset = stat.size - readSize;
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(readSize);
  try {
    fs.readSync(fd, buffer, 0, readSize, offset);
  } finally {
    fs.closeSync(fd);
  }

  const raw = buffer.toString('utf-8');
  const lines = raw.split(/\r?\n/);
  if (offset > 0 && lines.length > 0) {
    lines.shift();
  }
  return lines.slice(-lineCount).join('\n');
}

function resolveGatewayWsUrl(
  req: http.IncomingMessage,
  gateway: GatewayStatusPayload,
): string {
  const hostHeader = req.headers.host || '';
  const hostFromHeader = hostHeader.split(':')[0]?.trim();
  const selectedHost =
    gateway.host === '0.0.0.0' ? hostFromHeader || '127.0.0.1' : gateway.host;

  const xfProtoRaw = req.headers['x-forwarded-proto'];
  const xfProto = Array.isArray(xfProtoRaw) ? xfProtoRaw[0] : xfProtoRaw;
  const protocol = (xfProto || '').toLowerCase() === 'https' ? 'wss' : 'ws';
  return `${protocol}://${selectedHost}:${gateway.port}`;
}

function isAuthorized(
  req: http.IncomingMessage,
  authRequired: boolean,
  authToken: string,
): boolean {
  if (!authRequired) return true;
  const header = req.headers.authorization || '';
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  return header.slice(7).trim() === authToken;
}

export async function startWebControlCenterServer(
  adapters: WebControlCenterAdapters,
  options: WebControlCenterServerOptions,
): Promise<WebControlCenterServer> {
  const authToken = options.authToken.trim();
  const authRequired = options.accessMode !== 'localhost';
  if (authRequired && !authToken) {
    throw new Error(
      'FFT_NANO_WEB_ACCESS_MODE is lan/remote but FFT_NANO_WEB_AUTH_TOKEN is empty.',
    );
  }

  const staticDir = path.resolve(options.staticDir);
  const logsDir = path.resolve(options.logsDir);
  const fileRoots: NormalizedFileRoot[] = options.fileRoots
    .map((root) => {
      const id = root.id.trim();
      const label = root.label.trim() || id;
      const resolved = path.resolve(root.path);
      if (!id) return null;
      try {
        // If the root exists at startup, normalize through realpath to reduce aliasing.
        // If it does not exist yet (lazy bootstrap), keep the resolved path so the root
        // still appears in /api/files/roots and becomes available once created.
        return {
          id,
          label,
          path: fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved,
        };
      } catch {
        return {
          id,
          label,
          path: resolved,
        };
      }
    })
    .filter((root): root is NormalizedFileRoot => root !== null);
  const fileRootsById = new Map(fileRoots.map((root) => [root.id, root]));
  const skillsRoots = fileRoots.filter((root) =>
    root.id.toLowerCase().includes('skill'),
  );
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Control Center build is missing (${indexPath}). Run npm run web:build.`,
    );
  }

  const server = http.createServer(async (req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const requestPath = decodeURIComponent(url.pathname || '/');

    if (method === 'GET' && requestPath === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (requestPath.startsWith('/api/')) {
      if (!isAuthorized(req, authRequired, authToken)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }

      if (requestPath === '/api/runtime/status') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const runtime = adapters.getRuntimeStatus();
        const profile = adapters.getProfileStatus();
        const build = adapters.getBuildInfo();
        const gateway = adapters.getGatewayStatus();
        sendJson(res, 200, {
          ok: true,
          serverTime: new Date().toISOString(),
          runtime,
          profile,
          build,
          web: {
            accessMode: options.accessMode,
            host: options.host,
            port: options.port,
            authRequired,
          },
          gateway: {
            ...gateway,
            wsUrl: resolveGatewayWsUrl(req, gateway),
          },
        });
        return;
      }

      if (requestPath === '/api/profile') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          ...adapters.getProfileStatus(),
        });
        return;
      }

      if (requestPath === '/api/logs/recent') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const target = (url.searchParams.get('target') || 'host').toLowerCase();
        const lines = parseLineCount(url.searchParams.get('lines'));
        const fileName =
          target === 'error' ? 'fft_nano.error.log' : 'fft_nano.log';
        const filePath = path.join(logsDir, fileName);
        const text = tailFile(filePath, lines);
        sendJson(res, 200, {
          ok: true,
          target,
          lines,
          filePath,
          content: text,
        });
        return;
      }

      if (requestPath === '/api/files/roots') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          roots: fileRoots.map((root) => ({
            id: root.id,
            label: root.label,
          })),
        });
        return;
      }

      if (requestPath === '/api/skills/catalog') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const rootFilter = (url.searchParams.get('root') || '').trim();
        const query = (url.searchParams.get('q') || '').trim().toLowerCase();
        const roots = rootFilter
          ? skillsRoots.filter((root) => root.id === rootFilter)
          : skillsRoots;
        if (rootFilter && roots.length === 0) {
          sendJson(res, 400, {
            ok: false,
            error: `Unknown skill root: ${rootFilter}`,
          });
          return;
        }

        const groups = roots.map((root) => {
          const skills = scanSkillsCatalogForRoot(root)
            .filter((entry) => {
              if (!query) return true;
              const haystack =
                `${entry.name} ${entry.path} ${entry.description}`.toLowerCase();
              return haystack.includes(query);
            })
            .map((entry) => ({
              ...entry,
              rootId: root.id,
              rootLabel: root.label,
            }));
          return {
            root: {
              id: root.id,
              label: root.label,
            },
            skills,
          };
        });

        sendJson(res, 200, { ok: true, groups });
        return;
      }

      if (requestPath === '/api/files/tree') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const rootId = (url.searchParams.get('root') || '').trim();
        const root = fileRootsById.get(rootId);
        if (!root) {
          sendJson(res, 400, {
            ok: false,
            error: `Unknown file root: ${rootId}`,
          });
          return;
        }
        const relPath = normalizeSubPath(url.searchParams.get('path') || '.');
        try {
          const dirPath = ensureRealPathWithinRoot(
            root.path,
            ensureWithinRoot(root.path, relPath),
          );
          const stat = fs.statSync(dirPath);
          if (!stat.isDirectory()) {
            sendJson(res, 400, {
              ok: false,
              error: 'Requested path is not a directory',
            });
            return;
          }
          const entries = listDirectoryEntries(dirPath).map((entry) => ({
            ...entry,
            relPath: path.posix.join(
              relPath === '.' ? '' : relPath,
              entry.relPath,
            ),
          }));
          sendJson(res, 200, {
            ok: true,
            root: { id: root.id, label: root.label },
            path: relPath,
            entries,
          });
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (requestPath === '/api/files/read') {
        if (method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        const rootId = (url.searchParams.get('root') || '').trim();
        const root = fileRootsById.get(rootId);
        if (!root) {
          sendJson(res, 400, {
            ok: false,
            error: `Unknown file root: ${rootId}`,
          });
          return;
        }
        const relPath = normalizeSubPath(url.searchParams.get('path') || '');
        try {
          const filePath = ensureRealPathWithinRoot(
            root.path,
            ensureWithinRoot(root.path, relPath),
          );
          const stat = fs.statSync(filePath);
          if (!stat.isFile()) {
            sendJson(res, 400, {
              ok: false,
              error: 'Requested path is not a file',
            });
            return;
          }
          if (stat.size > MAX_FILE_READ_BYTES) {
            sendJson(res, 413, {
              ok: false,
              error: `File is larger than ${MAX_FILE_READ_BYTES} bytes`,
            });
            return;
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          sendJson(res, 200, {
            ok: true,
            root: { id: root.id, label: root.label },
            path: relPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            content,
          });
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (requestPath === '/api/files/write') {
        if (method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed' });
          return;
        }
        try {
          const body = await readJsonBody<{
            root?: string;
            path?: string;
            content?: string;
          }>(req);
          const rootId = (body.root || '').trim();
          const root = fileRootsById.get(rootId);
          if (!root) {
            sendJson(res, 400, {
              ok: false,
              error: `Unknown file root: ${rootId}`,
            });
            return;
          }
          const relPath = normalizeSubPath(body.path || '');
          const content = typeof body.content === 'string' ? body.content : '';
          if (Buffer.byteLength(content, 'utf-8') > MAX_FILE_WRITE_BYTES) {
            sendJson(res, 413, {
              ok: false,
              error: `Content exceeds ${MAX_FILE_WRITE_BYTES} bytes`,
            });
            return;
          }
          // Roots may be created lazily after startup; create on first write.
          fs.mkdirSync(root.path, { recursive: true });
          const filePath = ensureWithinRoot(root.path, relPath);
          ensureWritableParentDirWithinRoot(root.path, filePath);
          ensureWritePathWithinRoot(root.path, filePath);
          fs.writeFileSync(filePath, content, 'utf-8');
          const stat = fs.statSync(filePath);
          sendJson(res, 200, {
            ok: true,
            root: { id: root.id, label: root.label },
            path: relPath,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const normalizedPath =
      requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const candidatePath = path.resolve(staticDir, normalizedPath);
    if (!candidatePath.startsWith(staticDir)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }

    const servePath =
      fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
        ? candidatePath
        : indexPath;

    const ext = path.extname(servePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    try {
      const body = fs.readFileSync(servePath);
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
        'Content-Length': body.byteLength,
      });
      res.end(body);
    } catch (err) {
      logger.error({ err, servePath }, 'Failed to serve control center asset');
      sendText(res, 500, 'Internal server error');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err) => reject(err));
    server.listen(options.port, options.host, () => resolve());
  });

  logger.info(
    {
      host: options.host,
      port: options.port,
      accessMode: options.accessMode,
      authRequired,
    },
    'FFT Control Center server listening',
  );

  return {
    host: options.host,
    port: options.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
