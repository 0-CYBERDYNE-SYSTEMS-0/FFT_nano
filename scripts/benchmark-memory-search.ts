import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  closeDatabase,
  initDatabaseAtPath,
  searchMessagesByFts,
  storeChatMetadata,
  storeTextMessage,
} from '../src/db.js';

function main(): void {
  const rows = Number.parseInt(process.argv[2] || '2000', 10);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fft-memory-bench-'));
  const dbPath = path.join(tmp, 'messages.db');

  try {
    initDatabaseAtPath(dbPath);
    storeChatMetadata('bench-chat', new Date().toISOString(), 'Bench Chat');
    const startedInsert = Date.now();
    for (let i = 0; i < rows; i += 1) {
      storeTextMessage({
        id: `bench-${i}`,
        chatJid: 'bench-chat',
        sender: 'user@bench',
        senderName: 'Bench',
        content:
          i % 7 === 0
            ? `Irrigation alert ${i}: moisture below threshold in north field`
            : `Routine note ${i}: operation log entry and farm status update`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        isFromMe: false,
      });
    }
    const insertMs = Date.now() - startedInsert;

    const startedQuery = Date.now();
    const hits = searchMessagesByFts(
      ['bench-chat'],
      'moisture threshold north field',
      10,
    );
    const queryMs = Date.now() - startedQuery;

    console.log(
      JSON.stringify(
        {
          rows,
          insertMs,
          queryMs,
          hitCount: hits.length,
          firstHit: hits[0]?.snippet || null,
        },
        null,
        2,
      ),
    );
  } finally {
    closeDatabase();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
