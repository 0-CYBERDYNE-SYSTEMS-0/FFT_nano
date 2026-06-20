import { Container, Text } from '@mariozechner/pi-tui';

import type { VerboseMode } from '../../verbose-mode.js';
import { getEffectiveVerboseMode } from '../../verbose-mode.js';
import { theme } from '../theme/theme.js';

interface ToolEventData {
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

const MAX_OUTPUT_PREVIEW_CHARS = 400;

function trimForPreview(value: string, max = MAX_OUTPUT_PREVIEW_CHARS): string {
  if (!value) return value;
  const normalized = value.replace(/\r\n?/g, '\n');
  if (normalized.length <= max) return normalized;
  const head = normalized.slice(0, max);
  return `${head}\n…[truncated ${normalized.length - max} chars]`;
}

function statusLabel(data: ToolEventData): string {
  if (data.status === 'start') return 'running';
  if (data.status === 'ok') return 'ok';
  return 'error';
}

function formatToolSummary(data: ToolEventData): string {
  const status = statusLabel(data);
  const lines = [`Tool #${data.index} ${data.toolName} ${status}`];
  if (data.error) {
    lines.push(`error: ${trimForPreview(data.error)}`);
  }
  if (data.status === 'ok' && data.output) {
    lines.push(`output: ${trimForPreview(data.output)}`);
  }
  return lines.join('\n');
}

function formatToolVerbose(data: ToolEventData): string {
  const status = statusLabel(data);
  const lines = [`Tool #${data.index} ${data.toolName} ${status}`];
  if (data.args) {
    lines.push('args:');
    lines.push(trimForPreview(data.args, 2_000));
  }
  if (data.error) {
    lines.push(`error: ${trimForPreview(data.error, 2_000)}`);
  } else if (data.output) {
    lines.push('output:');
    lines.push(trimForPreview(data.output, 4_000));
  }
  return lines.join('\n');
}

function formatToolEvent(
  data: ToolEventData,
  verboseMode: VerboseMode,
): string {
  const effective = getEffectiveVerboseMode(verboseMode);
  if (effective === 'verbose') return formatToolVerbose(data);
  if (effective === 'off') {
    // Off: only render a brief status line on completion. Skip noisy "running" lines.
    if (data.status === 'start') return '';
    return `Tool #${data.index} ${data.toolName} ${statusLabel(data)}`;
  }
  return formatToolSummary(data);
}

export class ToolMessageComponent extends Container {
  private body: Text;

  constructor(data: ToolEventData, verboseMode: VerboseMode) {
    super();
    const text = formatToolEvent(data, verboseMode);
    const colored = applyStatusColor(text, data.status);
    this.body = new Text(colored, 1, 0);
    this.addChild(this.body);
  }

  setEvent(data: ToolEventData, verboseMode: VerboseMode) {
    const text = formatToolEvent(data, verboseMode);
    const colored = applyStatusColor(text, data.status);
    this.body.setText(colored);
  }
}

function applyStatusColor(
  text: string,
  status: 'start' | 'ok' | 'error',
): string {
  if (!text) return text;
  if (status === 'error') return theme.error(text);
  if (status === 'ok') return theme.success(text);
  return theme.accentSoft(text);
}
