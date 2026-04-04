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

export interface CoderLearningsEntry {
  date: string; // YYYY-MM-DD
  whatWorked: string[];
  whatDidnt: string[];
  patterns: string[];
  rawText?: string; // original markdown for reference
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
