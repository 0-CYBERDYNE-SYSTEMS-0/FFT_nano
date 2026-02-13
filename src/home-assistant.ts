import { z } from 'zod';

import { HA_TOKEN, HA_URL } from './config.js';

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
  private readonly baseUrl: string;

  private readonly token: string;

  constructor(baseUrl: string = HA_URL, token: string = HA_TOKEN || '') {
    this.baseUrl = ensureTrailingSlashless(baseUrl);
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<unknown> {
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

  async getAllStates(): Promise<HAEntity[]> {
    const payload = await this.fetchJson(`${this.baseUrl}/api/states`);
    return haStateResponseSchema.parse(payload);
  }

  async getState(entityId: string): Promise<HAEntity> {
    const payload = await this.fetchJson(
      `${this.baseUrl}/api/states/${encodeURIComponent(entityId)}`,
    );
    return haEntitySchema.parse(payload);
  }

  async callService(
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.fetchJson(`${this.baseUrl}/api/services/${domain}/${service}`, {
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
      `${this.baseUrl}/api/calendars/${encodeURIComponent(entityId)}?${query.toString()}`,
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
