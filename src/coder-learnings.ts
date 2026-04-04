/**
 * Helpers for parsing, formatting, and pruning coder learnings entries in MEMORY.md.
 *
 * Entry format:
 * ### YYYY-MM-DD
 *
 * What worked:
 * - ...
 *
 * What didn't:
 * - ...
 *
 * Patterns:
 * - ...
 */

import { logger } from './logger.js';
import { collectRuntimeSecrets } from './pi-runner.js';

export interface CoderLearningsEntry {
  date: string; // YYYY-MM-DD
  whatWorked: string[];
  whatDidnt: string[];
  patterns: string[];
  rawText?: string; // original markdown for reference
}

export interface CodingWorkerResult {
  status: 'success' | 'error' | 'aborted';
  summary: string;
  finalMessage: string;
  changedFiles: string[];
  commandsRun: string[];
  testsRun: string[];
  artifacts: string[];
  childRunIds: string[];
  startedAt: string;
  finishedAt: string;
  diffSummary?: string;
  worktreePath?: string;
  error?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    provider?: string;
    model?: string;
  };
}

const LEARNINGS_SECTION_HEADER = '## Coder Learnings';
const DATE_HEADING_RE = /^### (\d{4}-\d{2}-\d{2})\s*$/;
const WHAT_WORKED_RE = /^What worked:?\s*$/i;
const WHAT_DIDNT_RE = /^What didn't:?\s*$/i;
const PATTERNS_RE = /^Patterns:?\s*$/i;
const BULLET_RE = /^[-*]\s+/;

/**
 * Parse all coder learnings entries from MEMORY.md content.
 * Returns entries in reverse chronological order (newest first).
 */
export function parseCoderLearnings(memoryContent: string): CoderLearningsEntry[] {
  if (!memoryContent || typeof memoryContent !== 'string') {
    return [];
  }

  const entries: CoderLearningsEntry[] = [];
  const lines = memoryContent.split('\n');

  let currentDate: string | null = null;
  let currentSection: 'whatWorked' | 'whatDidnt' | 'patterns' | null = null;
  let currentWhatWorked: string[] = [];
  let currentWhatDidnt: string[] = [];
  let currentPatterns: string[] = [];
  let currentRawLines: string[] = [];

  const flushEntry = () => {
    if (currentDate) {
      entries.push({
        date: currentDate,
        whatWorked: [...currentWhatWorked],
        whatDidnt: [...currentWhatDidnt],
        patterns: [...currentPatterns],
        rawText: currentRawLines.join('\n'),
      });
    }
  };

  const resetCurrent = () => {
    currentDate = null;
    currentSection = null;
    currentWhatWorked = [];
    currentWhatDidnt = [];
    currentPatterns = [];
    currentRawLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect section header (top-level markdown heading)
    if (trimmed === LEARNINGS_SECTION_HEADER) {
      flushEntry();
      resetCurrent();
      continue;
    }

    // Detect date heading
    const dateMatch = trimmed.match(DATE_HEADING_RE);
    if (dateMatch) {
      flushEntry();
      currentDate = dateMatch[1];
      currentRawLines.push(line);
      continue;
    }

    // If we have a date, track sections and bullets
    if (currentDate) {
      currentRawLines.push(line);

      if (WHAT_WORKED_RE.test(trimmed)) {
        currentSection = 'whatWorked';
        continue;
      }
      if (WHAT_DIDNT_RE.test(trimmed)) {
        currentSection = 'whatDidnt';
        continue;
      }
      if (PATTERNS_RE.test(trimmed)) {
        currentSection = 'patterns';
        continue;
      }

      if (currentSection && BULLET_RE.test(trimmed)) {
        const text = trimmed.replace(BULLET_RE, '').trim();
        if (text) {
          if (currentSection === 'whatWorked') {
            currentWhatWorked.push(text);
          } else if (currentSection === 'whatDidnt') {
            currentWhatDidnt.push(text);
          } else if (currentSection === 'patterns') {
            currentPatterns.push(text);
          }
        }
      }
    }
  }

  flushEntry();
  return entries.reverse();
}

/**
 * Get formatted coder learnings for context prepending.
 *
 * Reads MEMORY.md from the group's memory directory, parses coder learnings entries,
 * and returns the last `maxEntries` formatted as a string to prepend to task context.
 *
 * @param groupFolder - The group folder name (e.g., 'global', 'main')
 * @param maxEntries - Maximum number of recent entries to include (default: 5)
 * @returns Formatted learnings string, or empty string if no learnings or file missing
 */
export async function getCoderLearningsForContext(
  groupFolder: string,
  maxEntries: number = 5,
): Promise<string> {
  const { GROUPS_DIR } = await import('./config.js');
  const fs = await import('fs');
  const path = await import('path');

  const memoryPath = path.join(GROUPS_DIR, groupFolder, 'MEMORY.md');

  if (!fs.existsSync(memoryPath)) {
    logger.debug({ memoryPath }, 'MEMORY.md not found for coder learnings');
    return '';
  }

  try {
    const content = fs.readFileSync(memoryPath, 'utf-8');
    const entries = parseCoderLearnings(content);

    if (entries.length === 0) {
      return '';
    }

    // Entries are already newest-first from parseCoderLearnings
    const recentEntries = entries.slice(0, maxEntries);

    const lines = [
      '## Recent Coder Learnings',
      '(from previous coding runs)',
      '',
    ];

    for (const entry of recentEntries) {
      lines.push(`### ${entry.date}`);
      lines.push('');

      if (entry.whatWorked.length > 0) {
        lines.push('What worked:');
        for (const item of entry.whatWorked) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }

      if (entry.whatDidnt.length > 0) {
        lines.push("What didn't:");
        for (const item of entry.whatDidnt) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }

      if (entry.patterns.length > 0) {
        lines.push('Patterns:');
        for (const item of entry.patterns) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error, memoryPath }, 'Failed to read coder learnings for context');
    return '';
  }
}

/**
 * Get formatted coder learnings synchronously (for use in contexts where async is not available).
 *
 * @param groupFolder - The group folder name
 * @param maxEntries - Maximum number of recent entries to include (default: 5)
 * @returns Formatted learnings string, or empty string if no learnings or file missing
 */
export function getCoderLearningsForContextSync(
  groupFolder: string,
  maxEntries: number = 5,
): string {
  try {
    const { GROUPS_DIR } = require('./config.js');
    const fs = require('fs');
    const path = require('path');

    const memoryPath = path.join(GROUPS_DIR, groupFolder, 'MEMORY.md');

    if (!fs.existsSync(memoryPath)) {
      return '';
    }

    const content = fs.readFileSync(memoryPath, 'utf-8');
    const entries = parseCoderLearnings(content);

    if (entries.length === 0) {
      return '';
    }

    const recentEntries = entries.slice(0, maxEntries);

    const lines = [
      '## Recent Coder Learnings',
      '(from previous coding runs)',
      '',
    ];

    for (const entry of recentEntries) {
      lines.push(`### ${entry.date}`);
      lines.push('');

      if (entry.whatWorked.length > 0) {
        lines.push('What worked:');
        for (const item of entry.whatWorked) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }

      if (entry.whatDidnt.length > 0) {
        lines.push("What didn't:");
        for (const item of entry.whatDidnt) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }

      if (entry.patterns.length > 0) {
        lines.push('Patterns:');
        for (const item of entry.patterns) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
  } catch (err) {
    // Silently return empty on error to avoid crashing
    return '';
  }
}

/**
 * Format a CoderLearningsEntry back to markdown string.
 */
export function formatCoderLearningsEntry(entry: CoderLearningsEntry): string {
  const lines: string[] = [];

  lines.push(`### ${entry.date}`);
  lines.push('');

  if (entry.whatWorked.length > 0) {
    lines.push('What worked:');
    for (const item of entry.whatWorked) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (entry.whatDidnt.length > 0) {
    lines.push("What didn't:");
    for (const item of entry.whatDidnt) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  if (entry.patterns.length > 0) {
    lines.push('Patterns:');
    for (const item of entry.patterns) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Prune coder learnings entries to a maximum count.
 * Keeps the newest entries (assumes parsed input is newest-first).
 * Returns the pruned array (does not modify original).
 */
export function pruneCoderLearnings(
  entries: CoderLearningsEntry[],
  maxEntries: number,
): CoderLearningsEntry[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  if (entries.length <= maxEntries) {
    return entries;
  }
  return entries.slice(0, maxEntries);
}

/**
 * Generate a structured reflection prompt for the LLM.
 */
function buildReflectionPrompt(
  taskText: string,
  result: CodingWorkerResult,
): string {
  const lines: string[] = [
    'You are a coding reflection analyzer. Analyze the following coding run and produce structured learnings.',
    '',
    '## Task',
    taskText,
    '',
    '## Run Result',
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
  ];

  if (result.status === 'success') {
    lines.push(`Final message: ${result.finalMessage.slice(0, 500)}`);
    if (result.changedFiles.length > 0) {
      lines.push(`Changed files: ${result.changedFiles.join(', ')}`);
    }
    if (result.diffSummary) {
      lines.push(`Diff summary: ${result.diffSummary}`);
    }
    if (result.commandsRun.length > 0) {
      lines.push(`Commands run: ${result.commandsRun.join(' | ')}`);
    }
    if (result.testsRun.length > 0) {
      lines.push(`Tests run: ${result.testsRun.join(' | ')}`);
    }
  } else if (result.status === 'error') {
    lines.push(`Error: ${result.error || 'Unknown error'}`);
    lines.push(`Final message: ${result.finalMessage.slice(0, 500)}`);
  }

  lines.push(
    '',
    '## Your Task',
    'Analyze this coding run and produce a structured reflection with:',
  );

  if (result.status === 'success') {
    lines.push(
      '- "What worked": 2-4 specific things that went well (concise bullet points)',
      '- "Patterns": 2-4 reusable patterns or techniques discovered (concise bullet points)',
    );
  } else {
    lines.push(
      '- "What didn\'t": 2-4 specific things that went wrong or could be improved (concise bullet points)',
    );
  }

  lines.push(
    '',
    'Format your response exactly as:',
    '```',
    'What worked:',
    '- ...',
    '',
    "What didn't:",
    '- ...',
    '',
    'Patterns:',
    '- ...',
    '```',
  );

  return lines.join('\n');
}

interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmChatRequest {
  model: string;
  messages: LlmChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface LlmChatResponse {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
  };
}

/**
 * Call the LLM API to generate a reflection.
 * Returns the raw response content or null on error.
 */
async function callLlmReflection(
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<string | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const requestBody: LlmChatRequest = {
    model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn(
        { status: response.status, error: errorText },
        'LLM reflection call failed',
      );
      return null;
    }

    const data = (await response.json()) as LlmChatResponse;

    if (data.error) {
      logger.warn({ error: data.error }, 'LLM reflection returned error');
      return null;
    }

    const content = data.choices?.[0]?.message?.content;
    return content ?? null;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error }, 'LLM reflection call threw');
    return null;
  }
}

/**
 * Parse the LLM response into a CoderLearningsEntry.
 * Handles various response formats gracefully.
 */
function parseReflectionResponse(
  response: string,
  status: CodingWorkerResult['status'],
): CoderLearningsEntry {
  const today = new Date().toISOString().slice(0, 10);
  const whatWorked: string[] = [];
  const whatDidnt: string[] = [];
  const patterns: string[] = [];

  // Extract "What worked:" section
  const whatWorkedMatch = response.match(/What worked:?\s*\n([\s\S]*?)(?=\n\s*\n|What didn't:|Patterns:|$)/i);
  if (whatWorkedMatch) {
    const bullets = whatWorkedMatch[1].match(/^[-*]\s+(.+)$/gm);
    if (bullets) {
      for (const bullet of bullets) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text) whatWorked.push(text);
      }
    }
  }

  // Extract "What didn't:" section
  const whatDidntMatch = response.match(/What didn't:?\s*\n([\s\S]*?)(?=\n\s*\n|Patterns:|$)/i);
  if (whatDidntMatch) {
    const bullets = whatDidntMatch[1].match(/^[-*]\s+(.+)$/gm);
    if (bullets) {
      for (const bullet of bullets) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text) whatDidnt.push(text);
      }
    }
  }

  // Extract "Patterns:" section
  const patternsMatch = response.match(/Patterns:?\s*\n([\s\S]*?)$/im);
  if (patternsMatch) {
    const bullets = patternsMatch[1].match(/^[-*]\s+(.+)$/gm);
    if (bullets) {
      for (const bullet of bullets) {
        const text = bullet.replace(/^[-*]\s+/, '').trim();
        if (text) patterns.push(text);
      }
    }
  }

  // If we couldn't parse anything meaningful, provide sensible defaults
  if (whatWorked.length === 0 && whatDidnt.length === 0 && patterns.length === 0) {
    if (status === 'success') {
      whatWorked.push('Task completed successfully');
      patterns.push('Completed coding task as requested');
    } else {
      whatDidnt.push('Task did not complete successfully');
    }
  }

  return {
    date: today,
    whatWorked,
    whatDidnt,
    patterns,
  };
}

/**
 * Generate a reflection from a coder run result.
 *
 * This function calls an LLM to analyze the coding run and produce structured learnings.
 * It should be called ASYNC after the final message has been sent to the user.
 *
 * @param workerResult - The result from the coding worker
 * @param taskText - The original task description
 * @returns A CoderLearningsEntry with the reflection, or a fallback entry on error
 */
export async function reflectOnCoderRun(
  workerResult: CodingWorkerResult,
  taskText: string,
): Promise<CoderLearningsEntry> {
  // Skip reflection for aborted runs
  if (workerResult.status === 'aborted') {
    logger.debug('Skipping reflection for aborted coder run');
    return {
      date: new Date().toISOString().slice(0, 10),
      whatWorked: [],
      whatDidnt: [],
      patterns: [],
    };
  }

  try {
    // Get runtime configuration
    const projectRoot = process.cwd();
    const secrets = collectRuntimeSecrets(projectRoot);

    const apiKey =
      secrets.ZAI_API_KEY ||
      secrets.OPENAI_API_KEY ||
      secrets.ANTHROPIC_API_KEY ||
      '';
    const model = secrets.PI_MODEL || 'glm-4.7';
    const baseUrl =
      secrets.OPENAI_BASE_URL ||
      secrets.PI_BASE_URL ||
      'https://open.bigmodel.cn/api/paas/v4';

    if (!apiKey) {
      logger.warn('No API key available for reflection');
      return createFallbackEntry(workerResult, 'No API key available');
    }

    const prompt = buildReflectionPrompt(taskText, workerResult);
    const response = await callLlmReflection(prompt, model, apiKey, baseUrl);

    if (!response) {
      return createFallbackEntry(workerResult, 'LLM call returned no response');
    }

    return parseReflectionResponse(response, workerResult.status);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error }, 'reflectOnCoderRun threw');
    return createFallbackEntry(workerResult, error);
  }
}

/**
 * Create a fallback learnings entry when LLM reflection fails.
 */
function createFallbackEntry(
  result: CodingWorkerResult,
  reason: string,
): CoderLearningsEntry {
  const today = new Date().toISOString().slice(0, 10);

  if (result.status === 'success') {
    return {
      date: today,
      whatWorked: [`Task completed: ${result.summary.slice(0, 100)}`],
      whatDidnt: [],
      patterns: [`Changed ${result.changedFiles.length} files`],
    };
  } else {
    return {
      date: today,
      whatWorked: [],
      whatDidnt: [`Error: ${(result.error || reason).slice(0, 100)}`],
      patterns: [],
    };
  }
}

const MAX_CODER_LEARNINGS_ENTRIES = 20;

/**
 * Write a coder learnings entry to MEMORY.md.
 *
 * This function:
 * - Reads existing MEMORY.md from the group's memory directory
 * - Parses existing coder learnings entries
 * - Prepends the new entry (newest first)
 * - Prunes old entries beyond MAX_CODER_LEARNINGS_ENTRIES (20)
 * - Writes the updated content back to MEMORY.md
 *
 * @param entry - The learnings entry to write
 * @param groupFolder - The group folder name (e.g., 'global', 'main')
 * @returns Promise<boolean> - true if successful, false otherwise
 */
export async function writeCoderLearningsToMemory(
  entry: CoderLearningsEntry,
  groupFolder: string,
): Promise<boolean> {
  try {
    const { GROUPS_DIR } = await import('./config.js');
    const fs = await import('fs');
    const path = await import('path');

    const memoryPath = path.join(GROUPS_DIR, groupFolder, 'MEMORY.md');

    // Read existing content or create empty if file doesn't exist
    let content = '';
    if (fs.existsSync(memoryPath)) {
      content = fs.readFileSync(memoryPath, 'utf-8');
    } else {
      // Create minimal MEMORY.md structure if it doesn't exist
      content = '# MEMORY\n\nDurable facts, decisions, and compaction summaries belong here.\n';
    }

    // Parse existing learnings
    const existingEntries = parseCoderLearnings(content);

    // Prepend new entry (entries are newest-first)
    const updatedEntries = [entry, ...existingEntries];

    // Prune to max entries
    const prunedEntries = pruneCoderLearnings(updatedEntries, MAX_CODER_LEARNINGS_ENTRIES);

    // Format the new entry
    const formattedEntry = formatCoderLearningsEntry(entry);

    // Rebuild the learnings section
    const learningsSectionLines = [
      LEARNINGS_SECTION_HEADER,
      '',
    ];

    for (const e of prunedEntries) {
      learningsSectionLines.push(formatCoderLearningsEntry(e));
      learningsSectionLines.push('');
    }

    const newLearningsSection = learningsSectionLines.join('\n').trimEnd() + '\n';

    // Find and replace or insert the Coder Learnings section
    const learningsSectionPattern = new RegExp(
      `\\n*${LEARNINGS_SECTION_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?$`,
      'm',
    );

    let newContent: string;
    if (learningsSectionPattern.test(content)) {
      // Replace existing section
      newContent = content.replace(learningsSectionPattern, '\n' + newLearningsSection);
    } else {
      // Append new section at the end
      newContent = content.trimEnd() + '\n\n' + newLearningsSection;
    }

    // Write back to file
    fs.writeFileSync(memoryPath, newContent, 'utf-8');

    logger.debug(
      { memoryPath, entryCount: prunedEntries.length },
      'Wrote coder learnings to MEMORY.md',
    );

    return true;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ error, groupFolder }, 'Failed to write coder learnings to MEMORY.md');
    return false;
  }
}

/**
 * Write coder learnings entry synchronously (for use in contexts where async is not available).
 *
 * @param entry - The learnings entry to write
 * @param groupFolder - The group folder name
 * @returns boolean - true if successful, false otherwise
 */
export function writeCoderLearningsToMemorySync(
  entry: CoderLearningsEntry,
  groupFolder: string,
): boolean {
  try {
    const { GROUPS_DIR } = require('./config.js');
    const fs = require('fs');
    const path = require('path');

    const memoryPath = path.join(GROUPS_DIR, groupFolder, 'MEMORY.md');

    // Read existing content or create empty if file doesn't exist
    let content = '';
    if (fs.existsSync(memoryPath)) {
      content = fs.readFileSync(memoryPath, 'utf-8');
    } else {
      // Create minimal MEMORY.md structure if it doesn't exist
      content = '# MEMORY\n\nDurable facts, decisions, and compaction summaries belong here.\n';
    }

    // Parse existing learnings
    const existingEntries = parseCoderLearnings(content);

    // Prepend new entry (entries are newest-first)
    const updatedEntries = [entry, ...existingEntries];

    // Prune to max entries
    const prunedEntries = pruneCoderLearnings(updatedEntries, MAX_CODER_LEARNINGS_ENTRIES);

    // Rebuild the learnings section
    const learningsSectionLines = [
      LEARNINGS_SECTION_HEADER,
      '',
    ];

    for (const e of prunedEntries) {
      learningsSectionLines.push(formatCoderLearningsEntry(e));
      learningsSectionLines.push('');
    }

    const newLearningsSection = learningsSectionLines.join('\n').trimEnd() + '\n';

    // Find and replace or insert the Coder Learnings section
    const learningsSectionPattern = new RegExp(
      `\\n*${LEARNINGS_SECTION_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?$`,
      'm',
    );

    let newContent: string;
    if (learningsSectionPattern.test(content)) {
      // Replace existing section
      newContent = content.replace(learningsSectionPattern, '\n' + newLearningsSection);
    } else {
      // Append new section at the end
      newContent = content.trimEnd() + '\n\n' + newLearningsSection;
    }

    // Write back to file
    fs.writeFileSync(memoryPath, newContent, 'utf-8');

    return true;
  } catch (err) {
    // Silently return false on error
    return false;
  }
}
