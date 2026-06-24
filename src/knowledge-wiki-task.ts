import { CronExpressionParser } from 'cron-parser';

import { MAIN_GROUP_FOLDER, TIMEZONE } from './config.js';
import { createTask, getTaskById } from './db.js';
import { logger } from './logger.js';
import { resolveEffectiveTimezone } from './time-context.js';
import type { ScheduledTask } from './types.js';

export const KNOWLEDGE_NIGHTLY_TASK_ID = 'task-main-knowledge-nightly-lint';
export const KNOWLEDGE_NIGHTLY_DEFAULT_CRON = '17 2 * * *';

export interface EnsureKnowledgeNightlyTaskResult {
  taskId: string;
  created: boolean;
  ensured: boolean;
  schedule: string;
  nextRun: string | null;
  status: ScheduledTask['status'] | 'missing';
  skippedReason?: string;
}

function resolveKnowledgeNightlyCronExpression(): string {
  const timezone = resolveEffectiveTimezone(undefined, TIMEZONE);
  const candidate =
    process.env.FFT_NANO_KNOWLEDGE_NIGHTLY_CRON?.trim() ||
    KNOWLEDGE_NIGHTLY_DEFAULT_CRON;
  try {
    CronExpressionParser.parse(candidate, {
      tz: timezone,
      currentDate: new Date(),
    });
    return candidate;
  } catch {
    return KNOWLEDGE_NIGHTLY_DEFAULT_CRON;
  }
}

export function buildKnowledgeNightlyPrompt(): string {
  return [
    'Nightly knowledge librarian maintenance run.',
    '',
    'This is a knowledge-base curator. It is NOT a memory task. The wiki is',
    'for what the agent has *read* (operator-curated sources in',
    '`knowledge/raw/`). The agent\'s own working memory lives in `canonical/`,',
    '`MEMORY.md`, and `memory/YYYY-MM-DD.md`. Do not write any of those here.',
    '',
    'Scope:',
    '1. Read `knowledge/schema/qualia-schema.md` and `knowledge/wiki/index.md`.',
    '2. List the contents of `knowledge/raw/`. For each capture not yet',
    '   integrated, decide what entity, concept, comparison, or procedure it',
    '   informs.',
    '3. For each new entity or topic:',
    '   - Create or update a page under `knowledge/wiki/` following the schema',
    '     (frontmatter + Summary, Facts with source citations,',
    '     Cross-references, Contradictions, Open questions, Sources).',
    '   - Cite the raw capture inline as `[raw/<capture-filename>]` next to',
    '     every non-obvious claim.',
    '   - Add a relative link from the new/updated page to related pages,',
    '     and add a one-line entry to `knowledge/wiki/index.md`.',
    '4. When a newer source contradicts an older one, surface it inline in',
    '   the page\'s `## Contradictions` section. Do not silently overwrite.',
    '5. Update `knowledge/wiki/progress.md` with one new row: today\'s date,',
    '   one-sentence summary of what was integrated, one next-action item.',
    '6. Append one entry to `knowledge/wiki/log.md` of the form:',
    '   `- <ISO timestamp> [integrate] sources=<n> pages_touched=<list>`.',
    '7. Run `knowledge/wiki` lint if available; otherwise self-check the',
    '   schema conformance of the pages you touched.',
    '',
    'Hard rules:',
    '- Never modify anything in `knowledge/raw/`. Raw captures are',
    '  immutable. The operator owns them.',
    '- Never write the agent\'s own working notes, decisions, or',
    '  self-reflection into `knowledge/wiki/`. That is what `canonical/` and',
    '  `memory/` are for. If a fact is about the operator or the agent\'s',
    '  own state, it does not belong here even if a raw capture mentions it.',
    '- Every non-obvious claim needs a `[raw/...]` source citation. If you',
    '  cannot cite a raw capture for a claim, drop the claim.',
    '- If there is nothing to curate, log a NOOP with reason and exit.',
    '- Keep pages concise. Prefer revising an existing page over creating a',
    '  near-duplicate. Cross-link aggressively.',
  ].join('\n');
}

export function ensureKnowledgeNightlyTask(params: {
  mainChatJid: string | null;
  now?: Date;
}): EnsureKnowledgeNightlyTaskResult {
  const existing = getTaskById(KNOWLEDGE_NIGHTLY_TASK_ID);
  if (existing) {
    return {
      taskId: existing.id,
      created: false,
      ensured: true,
      schedule: existing.schedule_value,
      nextRun: existing.next_run,
      status: existing.status,
    };
  }

  const schedule = resolveKnowledgeNightlyCronExpression();
  if (!params.mainChatJid) {
    return {
      taskId: KNOWLEDGE_NIGHTLY_TASK_ID,
      created: false,
      ensured: false,
      schedule,
      nextRun: null,
      status: 'missing',
      skippedReason: 'main chat is not registered yet',
    };
  }

  const now = params.now || new Date();
  const timezone = resolveEffectiveTimezone(undefined, TIMEZONE);
  let nextRun: string;
  try {
    const interval = CronExpressionParser.parse(schedule, {
      tz: timezone,
      currentDate: now,
    });
    const computed = interval.next().toISOString();
    if (!computed) {
      throw new Error(
        'Cron parser returned empty next run for knowledge nightly task',
      );
    }
    nextRun = computed;
  } catch (err) {
    logger.warn(
      { err, schedule, timezone },
      'Failed to compute knowledge nightly next run; using 24h fallback',
    );
    nextRun = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }

  createTask({
    id: KNOWLEDGE_NIGHTLY_TASK_ID,
    group_folder: MAIN_GROUP_FOLDER,
    chat_jid: params.mainChatJid,
    prompt: buildKnowledgeNightlyPrompt(),
    schedule_type: 'cron',
    schedule_value: schedule,
    context_mode: 'isolated',
    schedule_json: JSON.stringify({
      kind: 'cron',
      expr: schedule,
      tz: timezone,
    }),
    session_target: 'isolated',
    wake_mode: 'next-heartbeat',
    delivery_mode: 'none',
    delivery_channel: null,
    delivery_to: null,
    delivery_webhook_url: null,
    timeout_seconds: null,
    stagger_ms: null,
    delete_after_run: 0,
    consecutive_errors: 0,
    subagent_type: null,
    next_run: nextRun,
    status: 'active',
    created_at: now.toISOString(),
  });

  return {
    taskId: KNOWLEDGE_NIGHTLY_TASK_ID,
    created: true,
    ensured: true,
    schedule,
    nextRun,
    status: 'active',
  };
}
