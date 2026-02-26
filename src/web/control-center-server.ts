import fs from 'fs';
import http from 'http';
import path from 'path';

import type { WebAccessMode } from '../config.js';
import { logger } from '../logger.js';

interface RuntimeStatusPayload {
  runtime: string;
  sessions: number;
  activeRuns: number;
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
    gateway.host === '0.0.0.0'
      ? hostFromHeader || '127.0.0.1'
      : gateway.host;

  const xfProtoRaw = req.headers['x-forwarded-proto'];
  const xfProto = Array.isArray(xfProtoRaw)
    ? xfProtoRaw[0]
    : xfProtoRaw;
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
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Control Center build is missing (${indexPath}). Run npm run web:build.`,
    );
  }

  const server = http.createServer((req, res) => {
    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const requestPath = decodeURIComponent(url.pathname || '/');

    if (method === 'GET' && requestPath === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (requestPath.startsWith('/api/')) {
      if (method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }

      if (!isAuthorized(req, authRequired, authToken)) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        sendJson(res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }

      if (requestPath === '/api/runtime/status') {
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
        sendJson(res, 200, {
          ok: true,
          ...adapters.getProfileStatus(),
        });
        return;
      }

      if (requestPath === '/api/logs/recent') {
        const target = (url.searchParams.get('target') || 'host').toLowerCase();
        const lines = parseLineCount(url.searchParams.get('lines'));
        const fileName =
          target === 'error'
            ? 'fft_nano.error.log'
            : 'fft_nano.log';
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

      sendJson(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const normalizedPath =
      requestPath === '/'
        ? 'index.html'
        : requestPath.replace(/^\/+/, '');
    const candidatePath = path.resolve(staticDir, normalizedPath);
    if (!candidatePath.startsWith(staticDir)) {
      sendJson(res, 403, { ok: false, error: 'Forbidden' });
      return;
    }

    const servePath = fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
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
