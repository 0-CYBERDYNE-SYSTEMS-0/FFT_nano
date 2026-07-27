import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

export function connectAcpStdio(agent: acp.AgentApp): acp.AgentConnection {
  const output: WritableStream<Uint8Array> = Writable.toWeb(process.stdout);
  const input: ReadableStream<Uint8Array> = Readable.toWeb(process.stdin);
  return agent.connect(acp.ndJsonStream(output, input));
}
