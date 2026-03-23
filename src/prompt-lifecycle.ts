import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import type { SystemPromptReport } from './system-prompt.js';

export type PromptPreflightDecision =
  | 'continue'
  | 'flush_then_continue'
  | 'rebase_session'
  | 'abort';

export interface PromptCacheEntry {
  key: string;
  hash: string;
  content: string;
  manifest: SystemPromptReport;
  builtAt: string;
}

export interface PromptRuntimeState {
  version: number;
  sessionEpoch: number;
  corrupted?: boolean;
  lastTotalTokens?: number;
  lastOverflowAt?: string;
  lastPreflightDecision?: PromptPreflightDecision;
  lastRebaseAt?: string;
  lastManifestPath?: string;
  flushedEpoch?: number;
  cacheEntries: Record<string, PromptCacheEntry>;
}

export interface PromptPreflightInput {
  preflightRebaseEnabled: boolean;
  flushEnabled: boolean;
  softTokenThreshold: number;
  hardTokenThreshold: number;
  currentPromptChars: number;
  runMode: 'interactive' | 'scheduled' | 'heartbeat';
  stateCorrupted?: boolean;
  previousTotalTokens?: number;
  overflowDetected: boolean;
  alreadyFlushedEpoch: boolean;
}

type PromptPreflightBaseInput = Omit<
  PromptPreflightInput,
  'stateCorrupted' | 'previousTotalTokens' | 'overflowDetected' | 'alreadyFlushedEpoch'
>;

const STATE_VERSION = 1;

function emptyPromptRuntimeState(corrupted = false): PromptRuntimeState {
  return {
    version: STATE_VERSION,
    sessionEpoch: 0,
    corrupted,
    cacheEntries: {},
  };
}

export function hashPromptContent(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function determinePromptPreflightDecision(
  input: PromptPreflightInput,
): PromptPreflightDecision {
  if (!input.preflightRebaseEnabled) return 'continue';
  if (input.stateCorrupted) return 'abort';
  if (input.hardTokenThreshold <= 0 || input.hardTokenThreshold < input.softTokenThreshold) {
    return 'abort';
  }
  if (input.overflowDetected) return 'rebase_session';

  const previous = input.previousTotalTokens || 0;
  const promptTokenEstimate = Math.ceil(Math.max(0, input.currentPromptChars || 0) / 4);
  const reserve =
    input.runMode === 'interactive'
      ? 4_000
      : input.runMode === 'scheduled'
        ? 1_500
        : 500;
  const projected = previous + promptTokenEstimate + reserve;

  if (previous >= input.hardTokenThreshold || projected >= input.hardTokenThreshold) {
    return 'rebase_session';
  }
  if (previous >= input.softTokenThreshold || projected >= input.softTokenThreshold) {
    if (input.flushEnabled && !input.alreadyFlushedEpoch) return 'flush_then_continue';
    return 'rebase_session';
  }
  return 'continue';
}

function buildPreflightInputFromState(
  input: PromptPreflightBaseInput,
  state: PromptRuntimeState,
  alreadyFlushedEpoch: boolean,
): PromptPreflightInput {
  return {
    ...input,
    stateCorrupted: state.corrupted === true,
    previousTotalTokens: state.lastTotalTokens,
    overflowDetected: typeof state.lastOverflowAt === 'string',
    alreadyFlushedEpoch,
  };
}

export async function resolvePromptPreflightOutcome(params: {
  input: PromptPreflightBaseInput;
  state: PromptRuntimeState;
  executeFlush?: () => Promise<PromptRuntimeState | null>;
}): Promise<{
  decision: PromptPreflightDecision;
  state: PromptRuntimeState;
  flushed: boolean;
}> {
  const initialDecision = determinePromptPreflightDecision(
    buildPreflightInputFromState(
      params.input,
      params.state,
      params.state.flushedEpoch === params.state.sessionEpoch,
    ),
  );

  if (initialDecision !== 'flush_then_continue' || !params.executeFlush) {
    return {
      decision: initialDecision,
      state: params.state,
      flushed: false,
    };
  }

  const flushedState = await params.executeFlush();
  if (!flushedState) {
    return {
      decision: initialDecision,
      state: params.state,
      flushed: false,
    };
  }

  const markedState: PromptRuntimeState = {
    ...flushedState,
    flushedEpoch: flushedState.sessionEpoch,
  };

  return {
    decision: determinePromptPreflightDecision(
      buildPreflightInputFromState(params.input, markedState, true),
    ),
    state: markedState,
    flushed: true,
  };
}

export function readPromptRuntimeState(statePath: string): PromptRuntimeState {
  try {
    if (!fs.existsSync(statePath)) {
      return emptyPromptRuntimeState(false);
    }
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PromptRuntimeState>;
    return {
      version: STATE_VERSION,
      corrupted: false,
      sessionEpoch:
        typeof parsed.sessionEpoch === 'number' && Number.isFinite(parsed.sessionEpoch)
          ? Math.max(0, Math.floor(parsed.sessionEpoch))
          : 0,
      lastTotalTokens:
        typeof parsed.lastTotalTokens === 'number' && Number.isFinite(parsed.lastTotalTokens)
          ? Math.max(0, Math.floor(parsed.lastTotalTokens))
          : undefined,
      lastOverflowAt:
        typeof parsed.lastOverflowAt === 'string' ? parsed.lastOverflowAt : undefined,
      lastPreflightDecision:
        parsed.lastPreflightDecision === 'continue' ||
        parsed.lastPreflightDecision === 'flush_then_continue' ||
        parsed.lastPreflightDecision === 'rebase_session' ||
        parsed.lastPreflightDecision === 'abort'
          ? parsed.lastPreflightDecision
          : undefined,
      lastRebaseAt:
        typeof parsed.lastRebaseAt === 'string' ? parsed.lastRebaseAt : undefined,
      lastManifestPath:
        typeof parsed.lastManifestPath === 'string' ? parsed.lastManifestPath : undefined,
      flushedEpoch:
        typeof parsed.flushedEpoch === 'number' && Number.isFinite(parsed.flushedEpoch)
          ? Math.max(0, Math.floor(parsed.flushedEpoch))
          : undefined,
      cacheEntries:
        parsed.cacheEntries && typeof parsed.cacheEntries === 'object'
          ? (parsed.cacheEntries as Record<string, PromptCacheEntry>)
          : {},
    };
  } catch {
    return emptyPromptRuntimeState(true);
  }
}

export function writePromptRuntimeState(
  statePath: string,
  state: PromptRuntimeState,
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

export function writePromptManifest(
  manifestPath: string,
  manifest: SystemPromptReport,
): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
