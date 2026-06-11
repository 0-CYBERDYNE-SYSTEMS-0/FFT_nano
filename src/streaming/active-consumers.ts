import type { StreamConsumer } from './stream-consumer.js';

const activeConsumers = new Map<string, StreamConsumer>();

function key(chatJid: string, runId: string): string {
  return `${chatJid}:${runId}`;
}

export function registerActiveStreamConsumer(
  chatJid: string,
  runId: string,
  consumer: StreamConsumer,
): void {
  activeConsumers.set(key(chatJid, runId), consumer);
}

export function getActiveStreamConsumer(
  chatJid: string,
  runId: string,
): StreamConsumer | undefined {
  return activeConsumers.get(key(chatJid, runId));
}

export function unregisterActiveStreamConsumer(
  chatJid: string,
  runId: string,
  consumer: StreamConsumer,
): void {
  const runKey = key(chatJid, runId);
  if (activeConsumers.get(runKey) === consumer) {
    activeConsumers.delete(runKey);
  }
}
