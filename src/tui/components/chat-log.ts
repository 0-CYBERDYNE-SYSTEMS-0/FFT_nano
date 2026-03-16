import { Container, Spacer, Text } from '@mariozechner/pi-tui';

import type { VerboseMode } from '../../verbose-mode.js';
import { theme } from '../theme/theme.js';
import { AssistantMessageComponent } from './assistant-message.js';
import { ToolMessageComponent } from './tool-message.js';
import { UserMessageComponent } from './user-message.js';

export class ChatLog extends Container {
  private streamingRuns = new Map<string, AssistantMessageComponent>();
  private toolRuns = new Map<string, ToolMessageComponent>();
  private lastToolByRun = new Map<string, string>();

  clearAll() {
    this.clear();
    this.streamingRuns.clear();
    this.toolRuns.clear();
    this.lastToolByRun.clear();
  }

  addSystem(text: string) {
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.system(text), 1, 0));
  }

  addUser(text: string) {
    this.addChild(new UserMessageComponent(text));
  }

  private resolveRunId(runId?: string) {
    return runId ?? 'default';
  }

  updateAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) {
      const component = new AssistantMessageComponent(text);
      this.streamingRuns.set(effectiveRunId, component);
      this.addChild(component);
      return;
    }
    existing.setText(text);
  }

  finalizeAssistant(text: string, runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (existing) {
      existing.setText(text);
      this.streamingRuns.delete(effectiveRunId);
      return;
    }
    this.addChild(new AssistantMessageComponent(text));
  }

  dropAssistant(runId?: string) {
    const effectiveRunId = this.resolveRunId(runId);
    const existing = this.streamingRuns.get(effectiveRunId);
    if (!existing) return;
    this.removeChild(existing);
    this.streamingRuns.delete(effectiveRunId);
  }

  upsertToolEvent(
    runId: string,
    data: {
      index: number;
      toolName: string;
      status: 'start' | 'ok' | 'error';
      args?: string;
      output?: string;
      error?: string;
    },
    verboseMode: VerboseMode,
  ) {
    const effectiveRunId = this.resolveRunId(runId);
    if (verboseMode === 'new' && data.status === 'start') {
      const lastTool = this.lastToolByRun.get(effectiveRunId);
      if (lastTool === data.toolName) {
        return;
      }
      this.lastToolByRun.set(effectiveRunId, data.toolName);
    }
    const key = `${effectiveRunId}:${data.index}`;
    const existing = this.toolRuns.get(key);
    if (existing) {
      existing.setEvent(data, verboseMode);
      return;
    }
    const component = new ToolMessageComponent(data, verboseMode);
    this.toolRuns.set(key, component);
    this.addChild(component);
  }
}
