import { Readable, Writable } from 'node:stream';

import type { AgentApp, AnyMessage, Stream } from '@agentclientprotocol/sdk';

interface AcpStdioStream {
  readonly stream: Stream;
  readonly getError: () => Error | null;
}

export interface AcpStdioConnection {
  readonly closed: Promise<void>;
  readonly transportError: Error | null;
  close(): void;
}

export function connectAcpStdio(agent: AgentApp): AcpStdioConnection {
  const transport = createAcpStdioStream(
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  );
  const connection = agent.connect(transport.stream);
  return {
    closed: connection.closed,
    get transportError() {
      return transport.getError();
    },
    close: () => connection.close(),
  };
}

export function createAcpStdioStream(
  input: ReadableStream<Uint8Array>,
  output: WritableStream<Uint8Array>,
  diagnostic: (message: string) => void = (message) =>
    process.stderr.write(`${message}\n`),
): AcpStdioStream {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let inputReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let inputController: ReadableStreamDefaultController<AnyMessage> | null =
    null;
  let transportError: Error | null = null;

  const fail = (error: unknown) => {
    if (transportError) return;
    transportError = error instanceof Error ? error : new Error(String(error));
    try {
      inputController?.error(transportError);
    } catch {}
    void inputReader?.cancel(transportError).catch(() => {});
  };

  const enqueueLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const message: unknown = JSON.parse(trimmed);
      if (
        (typeof message === 'object' && message !== null) ||
        Array.isArray(message)
      ) {
        inputController?.enqueue(message as AnyMessage);
      } else {
        diagnostic('ACP stdio ignored a JSON value that is not an object');
      }
    } catch {
      diagnostic('ACP stdio ignored malformed JSON input');
    }
  };

  const readable = new ReadableStream<AnyMessage>({
    async start(controller) {
      inputController = controller;
      const reader = input.getReader();
      inputReader = reader;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) enqueueLine(line);
        }
        buffer += decoder.decode();
        enqueueLine(buffer);
        controller.close();
      } catch (error) {
        fail(error);
      } finally {
        if (inputReader === reader) inputReader = null;
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return inputReader?.cancel(reason);
    },
  });

  const writable = new WritableStream<AnyMessage>({
    async write(message) {
      const writer = output.getWriter();
      try {
        await writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
      } catch (error) {
        fail(error);
        throw error;
      } finally {
        writer.releaseLock();
      }
    },
  });

  return {
    stream: { readable, writable },
    getError: () => transportError,
  };
}
