import { z } from 'zod';

import { HA_TOKEN, HA_URL, HA_URL_CANDIDATES } from './config.js';
import { logger } from './logger.js';

const haEntitySchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  last_changed: z.string().optional(),
  last_updated: z.string().optional(),
});

const haStateResponseSchema = z.array(haEntitySchema);

const haCalendarEventSchema = z
  .object({
    summary: z.string().optional(),
    description: z.string().optional(),
    start: z.unknown().optional(),
    end: z.unknown().optional(),
  })
  .passthrough();

const haCalendarResponseSchema = z.array(haCalendarEventSchema);

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface CalendarEvent {
  summary: string;
  start: string;
  end: string;
  description?: string;
  raw: Record<string, unknown>;
}

function normalizeCalendarDate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const candidate = value as Record<string, unknown>;
  for (const key of ['dateTime', 'date', 'time']) {
    const found = candidate[key];
    if (typeof found === 'string' && found.length > 0) {
      return found;
    }
  }

  return '';
}

function ensureTrailingSlashless(value: string): string {
  return value.replace(/\/$/, '');
}

export class HomeAssistantAdapter {
  private readonly token: string;

  private readonly endpointCandidates: string[];

  private activeBaseUrl: string;

  private endpointInitPromise: Promise<void> | null = null;

  constructor(
    baseUrl: string = HA_URL,
    token: string = HA_TOKEN || '',
    endpointCandidates: string[] = HA_URL_CANDIDATES,
  ) {
    const normalizedPrimary = ensureTrailingSlashless(baseUrl);
    const normalizedCandidates = Array.from(
      new Set(
        [normalizedPrimary, ...endpointCandidates]
          .map((candidate) => ensureTrailingSlashless(candidate))
          .filter(Boolean),
      ),
    );
    this.endpointCandidates =
      normalizedCandidates.length > 0 ? normalizedCandidates : [normalizedPrimary];
    this.activeBaseUrl = this.endpointCandidates[0];
    this.token = token;
  }

  getActiveBaseUrl(): string {
    return this.activeBaseUrl;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async fetchJson(pathname: string, init?: RequestInit): Promise<unknown> {
    await this.ensureEndpointReady();

    try {
      return await this.fetchJsonWithEndpoint(this.activeBaseUrl, pathname, init);
    } catch (error) {
      if (!this.shouldAttemptFailover(error)) {
        throw error;
      }

      const failedEndpoint = this.activeBaseUrl;
      const nextEndpoint = this.getNextEndpointCandidate(failedEndpoint);
      if (!nextEndpoint) {
        throw error;
      }

      try {
        await this.probeEndpoint(nextEndpoint);
        this.switchActiveEndpoint(failedEndpoint, nextEndpoint, 'failover');
      } catch (probeError) {
        logger.warn(
          {
            failedEndpoint,
            candidateEndpoint: nextEndpoint,
            err:
              probeError instanceof Error ? probeError.message : String(probeError),
          },
          'Home Assistant failover probe failed',
        );
        throw error;
      }

      return this.fetchJsonWithEndpoint(this.activeBaseUrl, pathname, init);
    }
  }

  private async fetchJsonWithEndpoint(
    endpoint: string,
    pathname: string,
    init?: RequestInit,
  ): Promise<unknown> {
    const url = `${endpoint}${pathname}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        ...this.getHeaders(),
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Home Assistant request failed (${response.status} ${response.statusText}): ${url}`,
      );
    }

    return response.json();
  }

  private async ensureEndpointReady(): Promise<void> {
    if (this.endpointInitPromise) {
      await this.endpointInitPromise;
      return;
    }

    this.endpointInitPromise = this.resolveInitialEndpoint();
    try {
      await this.endpointInitPromise;
    } finally {
      this.endpointInitPromise = null;
    }
  }

  private async resolveInitialEndpoint(): Promise<void> {
    const errors: string[] = [];
    for (const endpoint of this.endpointCandidates) {
      try {
        await this.probeEndpoint(endpoint);
        if (endpoint !== this.activeBaseUrl) {
          this.switchActiveEndpoint(this.activeBaseUrl, endpoint, 'startup');
        }
        return;
      } catch (error) {
        errors.push(
          `${endpoint}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    throw new Error(
      `No reachable Home Assistant endpoint. Tried: ${errors.join(' | ')}`,
    );
  }

  private async probeEndpoint(endpoint: string): Promise<void> {
    const response = await fetch(`${endpoint}/api/`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(
        `Home Assistant probe failed (${response.status} ${response.statusText})`,
      );
    }
  }

  private switchActiveEndpoint(
    previousEndpoint: string,
    nextEndpoint: string,
    reason: 'startup' | 'failover',
  ): void {
    this.activeBaseUrl = nextEndpoint;
    logger.warn(
      { previousEndpoint, nextEndpoint, reason },
      'Switching Home Assistant endpoint',
    );
  }

  private getNextEndpointCandidate(failedEndpoint: string): string | null {
    const idx = this.endpointCandidates.indexOf(failedEndpoint);
    if (idx === -1) {
      return this.endpointCandidates[0] || null;
    }

    for (let offset = 1; offset < this.endpointCandidates.length; offset += 1) {
      const candidate = this.endpointCandidates[
        (idx + offset) % this.endpointCandidates.length
      ];
      if (candidate !== failedEndpoint) return candidate;
    }

    return null;
  }

  private shouldAttemptFailover(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (!(error instanceof Error)) return false;

    const statusMatch = error.message.match(/\((\d{3})\s/);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (status === 401 || status === 403) return false;
      return [404, 408, 429, 500, 502, 503, 504].includes(status);
    }

    return /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout/i.test(
      error.message,
    );
  }

  async getAllStates(): Promise<HAEntity[]> {
    const payload = await this.fetchJson('/api/states');
    return haStateResponseSchema.parse(payload);
  }

  async getState(entityId: string): Promise<HAEntity> {
    const payload = await this.fetchJson(
      `/api/states/${encodeURIComponent(entityId)}`,
    );
    return haEntitySchema.parse(payload);
  }

  async callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.fetchJson(`/api/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async getCalendarEvents(
    entityId: string,
    start: string,
    end: string,
  ): Promise<CalendarEvent[]> {
    const query = new URLSearchParams({ start, end });
    const payload = await this.fetchJson(
      `/api/calendars/${encodeURIComponent(entityId)}?${query.toString()}`,
    );

    const events = haCalendarResponseSchema.parse(payload);
    return events.map((event) => ({
      summary: event.summary || '',
      description: event.description,
      start: normalizeCalendarDate(event.start),
      end: normalizeCalendarDate(event.end),
      raw: event,
    }));
  }
}
