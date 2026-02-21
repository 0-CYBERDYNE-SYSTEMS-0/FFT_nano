import { Container, Spacer, Text } from '@mariozechner/pi-tui';

import { theme } from '../theme/theme.js';
import { AssistantMessageComponent } from './assistant-message.js';
import { UserMessageComponent } from './user-message.js';

export class ChatLog extends Container {
  private streamingRuns = new Map<string, AssistantMessageComponent>();

  clearAll() {
    this.clear();
    this.streamingRuns.clear();
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
}
