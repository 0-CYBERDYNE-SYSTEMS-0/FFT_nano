import { randomUUID } from 'crypto';

import { WebSocket } from 'ws';

import type {
  GatewayEventFrame,
  GatewayRequestFrame,
  GatewayResponseFrame,
} from './protocol.js';

const DEFAULT_GATEWAY_URL = `ws://127.0.0.1:${process.env.FFT_NANO_TUI_PORT || '28989'}`;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface GatewayClientOptions {
  url?: string;
  onEvent?: (event: GatewayEventFrame) => void;
  onClose?: (code: number, reason: string) => void;
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly onEvent?: (event: GatewayEventFrame) => void;
  private readonly onClose?: (code: number, reason: string) => void;

  constructor(options: GatewayClientOptions = {}) {
    this.url = options.url || DEFAULT_GATEWAY_URL;
    this.onEvent = options.onEvent;
    this.onClose = options.onClose;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;

      ws.once('open', () => resolve());
      ws.once('error', (err) => {
        reject(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on('message', (raw) => this.handleMessage(raw.toString('utf8')));
      ws.on('close', (code, reason) => {
        this.ws = null;
        const reasonText = reason.toString('utf8');
        for (const [, pending] of this.pending) {
          pending.reject(
            new Error(`Gateway closed (${code}): ${reasonText || 'no reason'}`),
          );
        }
        this.pending.clear();
        this.onClose?.(code, reasonText);
      });
    });
  }

  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Gateway is not connected.');
    }

    const id = randomUUID();
    const frame: GatewayRequestFrame = {
      id,
      method,
      params,
    };

    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws?.send(JSON.stringify(frame), (err) => {
        if (!err) return;
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    return result as T;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;
    const frame = parsed as Record<string, unknown>;

    if (typeof frame.id === 'string' && typeof frame.ok === 'boolean') {
      const response: GatewayResponseFrame = {
        id: frame.id,
        ok: frame.ok,
        result: frame.result,
        error: typeof frame.error === 'string' ? frame.error : undefined,
      };
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.error || 'Unknown gateway error'));
      }
      return;
    }

    if (typeof frame.event === 'string') {
      const eventFrame: GatewayEventFrame = {
        event: frame.event,
        payload: frame.payload,
      };
      this.onEvent?.(eventFrame);
    }
  }
}
