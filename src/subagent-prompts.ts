/**
 * Subagent prompt template loader.
 *
 * Reads markdown prompt templates from config/subagent-prompts/<name>.md.
 * Falls back to a minimal default if the file is not found.
 */

import fs from 'fs';
import path from 'path';

/** Directory containing prompt template files. */
const PROMPTS_DIR = path.resolve(process.cwd(), 'config', 'subagent-prompts');

/**
 * Load the prompt template for a given subagent type.
 *
 * @param typeName - The subagent type name (e.g., 'eval', 'nightly-analyst')
 * @returns The prompt template text, or a minimal fallback if not found
 */
export function loadSubagentPrompt(typeName: string): string {
  const filePath = path.join(PROMPTS_DIR, `${typeName}.md`);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const trimmed = content.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // File not found or unreadable -- fall through to default
  }

  // Minimal fallback prompt
  return [
    `# ${typeName}`,
    '',
    `You are a ${typeName} worker for FFT_nano.`,
    'Complete the assigned task to the best of your ability.',
    '',
  ].join('\n');
}

/**
 * Check if a prompt template file exists for the given type.
 */
export function hasSubagentPrompt(typeName: string): boolean {
  const filePath = path.join(PROMPTS_DIR, `${typeName}.md`);
  return fs.existsSync(filePath);
}

/**
 * List all available prompt template names (files in the prompts directory).
 */
export function listAvailablePromptNames(): string[] {
  try {
    const files = fs.readdirSync(PROMPTS_DIR);
    return files
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort();
  } catch {
    return [];
  }
}
