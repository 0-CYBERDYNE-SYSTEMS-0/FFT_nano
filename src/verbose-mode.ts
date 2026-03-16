export type VerboseMode = 'off' | 'new' | 'all' | 'verbose';

export type ParsedVerboseDirective =
  | { kind: 'none'; prompt: string }
  | { kind: 'cycle'; prompt: string }
  | { kind: 'set'; prompt: string; mode: VerboseMode }
  | { kind: 'invalid'; prompt: string; value: string };

export function normalizeVerboseMode(raw: string): VerboseMode | undefined {
  const key = raw.trim().toLowerCase();
  if (!key) return undefined;
  if (['off', 'false', 'no', '0'].includes(key)) return 'off';
  if (key === 'new') return 'new';
  if (['all', 'on', 'true', 'yes', '1'].includes(key)) return 'all';
  if (['verbose', 'full', 'max', '2'].includes(key)) return 'verbose';
  return undefined;
}

export function describeVerboseMode(mode: VerboseMode): string {
  if (mode === 'off') return 'Tool progress: OFF — silent mode, just the final response.';
  if (mode === 'new') return 'Tool progress: NEW — show each new tool and skip repeats.';
  if (mode === 'all') return 'Tool progress: ALL — show every tool call with a short preview.';
  return 'Tool progress: VERBOSE — full args, results, and debug logs.';
}

export function cycleVerboseMode(mode: VerboseMode | undefined): VerboseMode {
  const cycle: VerboseMode[] = ['off', 'new', 'all', 'verbose'];
  const current = mode && cycle.includes(mode) ? mode : 'all';
  const index = cycle.indexOf(current);
  return cycle[(index + 1) % cycle.length] || 'off';
}

export function parseVerboseDirective(text: string): ParsedVerboseDirective {
  const raw = text || '';
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'none', prompt: raw };

  const leading = trimmed.match(/^\/(?:verbose|v)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i);
  if (!leading) return { kind: 'none', prompt: raw };

  const rawMode = (leading[1] || '').trim();
  const remainder = (leading[2] || '').trim();
  if (!rawMode && !remainder) return { kind: 'cycle', prompt: raw };
  if (!rawMode || remainder) {
    return { kind: 'invalid', prompt: raw, value: `${rawMode}${remainder ? ` ${remainder}` : ''}`.trim() };
  }

  const normalized = normalizeVerboseMode(rawMode);
  if (!normalized) {
    return { kind: 'invalid', prompt: raw, value: rawMode };
  }
  return { kind: 'set', prompt: raw, mode: normalized };
}
