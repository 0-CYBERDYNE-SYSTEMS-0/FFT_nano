import fs from 'fs';
import path from 'path';

import { ensureMemoryScaffold, resolveMemoryPath, resolveSoulPath } from './memory-paths.js';

const COMPACTION_HEADING_PREFIX = '## Session Compaction ';
const MIGRATION_NOTE =
  '> Note: Session compaction summaries are stored in MEMORY.md (migrated automatically).';

export interface CompactionMigrationResult {
  movedSections: number;
  movedChars: number;
  changed: boolean;
}

function splitCompactionSections(content: string): {
  preservedLines: string[];
  sections: string[];
} {
  const lines = content.split('\n');
  const preserved: string[] = [];
  const sections: string[] = [];
  let currentSection: string[] | null = null;

  const flushSection = () => {
    if (!currentSection) return;
    const text = currentSection.join('\n').trim();
    if (text) sections.push(text);
    currentSection = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const startsCompaction = line.startsWith(COMPACTION_HEADING_PREFIX);
    const startsHeading = /^##\s+/.test(line);

    if (startsCompaction) {
      flushSection();
      currentSection = [line];
      continue;
    }

    if (currentSection) {
      if (startsHeading) {
        flushSection();
        preserved.push(line);
      } else {
        currentSection.push(line);
      }
      continue;
    }

    preserved.push(line);
  }

  flushSection();
  return { preservedLines: preserved, sections };
}

export function migrateCompactionSectionsFromSoul(
  soulPath: string,
  memoryPath: string,
): CompactionMigrationResult {
  if (!fs.existsSync(soulPath)) {
    return { movedSections: 0, movedChars: 0, changed: false };
  }

  const rawSoul = fs.readFileSync(soulPath, 'utf8');
  const { preservedLines, sections } = splitCompactionSections(rawSoul);
  if (sections.length === 0) {
    return { movedSections: 0, movedChars: 0, changed: false };
  }

  const moved = sections.join('\n\n').trim();
  if (moved) {
    fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
    const existingMemory = fs.existsSync(memoryPath)
      ? fs.readFileSync(memoryPath, 'utf8')
      : '# MEMORY\n\n';
    const separator = existingMemory.trimEnd().length > 0 ? '\n\n' : '';
    fs.writeFileSync(memoryPath, `${existingMemory.trimEnd()}${separator}${moved}\n`);
  }

  const preservedText = preservedLines.join('\n').trimEnd();
  const notePresent = preservedText.includes(MIGRATION_NOTE);
  const nextSoul = notePresent ? preservedText : `${preservedText}\n\n${MIGRATION_NOTE}`;
  fs.writeFileSync(soulPath, `${nextSoul.trimEnd()}\n`);

  return {
    movedSections: sections.length,
    movedChars: moved.length,
    changed: true,
  };
}

export function migrateCompactionsForGroup(groupFolder: string): CompactionMigrationResult {
  ensureMemoryScaffold(groupFolder);
  return migrateCompactionSectionsFromSoul(
    resolveSoulPath(groupFolder),
    resolveMemoryPath(groupFolder),
  );
}

export function appendCompactionSummaryToMemory(
  groupFolder: string,
  summaryMarkdown: string,
  timestampIso: string,
): void {
  const { memoryPath } = ensureMemoryScaffold(groupFolder);
  const block = [
    '',
    `## Session Compaction ${timestampIso}`,
    '',
    summaryMarkdown.trim(),
    '',
  ].join('\n');
  fs.appendFileSync(memoryPath, block, 'utf8');
}
