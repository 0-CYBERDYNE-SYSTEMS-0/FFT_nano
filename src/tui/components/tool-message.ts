import { Container, Markdown, Spacer } from '@mariozechner/pi-tui';

import type { VerboseMode } from '../../verbose-mode.js';
import { markdownTheme, theme } from '../theme/theme.js';

interface ToolEventData {
  index: number;
  toolName: string;
  status: 'start' | 'ok' | 'error';
  args?: string;
  output?: string;
  error?: string;
}

function formatToolEvent(
  data: ToolEventData,
  verboseMode: VerboseMode,
): string {
  const statusLabel =
    data.status === 'start' ? 'running' : data.status === 'ok' ? 'ok' : 'error';
  const lines = [`Tool #${data.index} ${data.toolName} ${statusLabel}`];

  if (data.args) {
    lines.push(`args: ${data.args}`);
  }
  if (data.error) {
    lines.push(`error: ${data.error}`);
  } else if (verboseMode === 'verbose' && data.output) {
    lines.push(`output: ${data.output}`);
  }

  return lines.join('\n');
}

export class ToolMessageComponent extends Container {
  private body: Markdown;

  constructor(data: ToolEventData, verboseMode: VerboseMode) {
    super();
    this.body = new Markdown(
      formatToolEvent(data, verboseMode),
      1,
      0,
      markdownTheme,
      {
        color: (line) => {
          if (data.status === 'error') return theme.error(line);
          if (data.status === 'ok') return theme.success(line);
          return theme.accentSoft(line);
        },
      },
    );
    this.addChild(new Spacer(1));
    this.addChild(this.body);
  }

  setEvent(data: ToolEventData, verboseMode: VerboseMode) {
    this.body.setText(formatToolEvent(data, verboseMode));
  }
}
