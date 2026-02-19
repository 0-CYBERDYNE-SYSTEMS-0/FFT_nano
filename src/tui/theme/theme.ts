import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { createRequire } from 'module';

type CliHighlightModule = {
  highlight: (code: string, options?: { language?: string; ignoreIllegals?: boolean }) => string;
  supportsLanguage: (language: string) => boolean;
};

let cliHighlight: CliHighlightModule | null = null;
try {
  const require = createRequire(import.meta.url);
  cliHighlight = require('cli-highlight') as CliHighlightModule;
} catch {
  cliHighlight = null;
}

const palette = {
  text: '#E8E3D5',
  dim: '#7B7F87',
  accent: '#F6C453',
  accentSoft: '#F2A65A',
  border: '#3C414B',
  userBg: '#2B2F36',
  userText: '#F3EEE0',
  systemText: '#9BA3B2',
  quote: '#8CC8FF',
  quoteBorder: '#3B4D6B',
  code: '#F0C987',
  codeBorder: '#343A45',
  link: '#7DD3A5',
  error: '#F97066',
  success: '#7DD3A5',
};

const fg = (hex: string) => (text: string) => chalk.hex(hex)(text);
const bg = (hex: string) => (text: string) => chalk.bgHex(hex)(text);

function highlightCode(code: string, lang?: string): string[] {
  if (!cliHighlight) {
    return code.split('\n').map((line) => fg(palette.code)(line));
  }
  try {
    const language = lang && cliHighlight.supportsLanguage(lang) ? lang : undefined;
    const highlighted = cliHighlight.highlight(code, {
      language,
      ignoreIllegals: true,
    });
    return highlighted.split('\n');
  } catch {
    return code.split('\n').map((line) => fg(palette.code)(line));
  }
}

export const theme = {
  fg: fg(palette.text),
  assistantText: (text: string) => text,
  dim: fg(palette.dim),
  accent: fg(palette.accent),
  accentSoft: fg(palette.accentSoft),
  success: fg(palette.success),
  error: fg(palette.error),
  header: (text: string) => chalk.bold(fg(palette.accent)(text)),
  system: fg(palette.systemText),
  userBg: bg(palette.userBg),
  userText: fg(palette.userText),
  border: fg(palette.border),
  bold: (text: string) => chalk.bold(text),
};

export const markdownTheme: MarkdownTheme = {
  heading: (text) => chalk.bold(fg(palette.accent)(text)),
  link: (text) => fg(palette.link)(text),
  linkUrl: (text) => chalk.dim(text),
  code: (text) => fg(palette.code)(text),
  codeBlock: (text) => fg(palette.code)(text),
  codeBlockBorder: (text) => fg(palette.codeBorder)(text),
  quote: (text) => fg(palette.quote)(text),
  quoteBorder: (text) => fg(palette.quoteBorder)(text),
  hr: (text) => fg(palette.border)(text),
  listBullet: (text) => fg(palette.accentSoft)(text),
  bold: (text) => chalk.bold(text),
  italic: (text) => chalk.italic(text),
  strikethrough: (text) => chalk.strikethrough(text),
  underline: (text) => chalk.underline(text),
  highlightCode,
};

const selectListTheme: SelectListTheme = {
  selectedPrefix: (text) => fg(palette.accent)(text),
  selectedText: (text) => chalk.bold(fg(palette.accent)(text)),
  description: (text) => fg(palette.dim)(text),
  scrollInfo: (text) => fg(palette.dim)(text),
  noMatch: (text) => fg(palette.dim)(text),
};

export const editorTheme: EditorTheme = {
  borderColor: (text) => fg(palette.border)(text),
  selectList: selectListTheme,
};
