import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface BootCheckResult {
  ok: boolean;
  failures: string[];
}

export type BootChecker = () => void;

export function defaultBootChecks(): BootChecker[] {
  return [
    () => {
      try {
        // Paren-required import of the native module; catches ABI
        // NODE_MODULE_VERSION crashes (independent of initDatabase's file DB).
        const Database = require('better-sqlite3');
        const db = new Database(':memory:');
        db.close();
      } catch (err) {
        throw new Error(
          `better-sqlite3 preflight failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    () => {
      try {
        require.resolve('pino');
      } catch (err) {
        throw new Error(
          `pino preflight failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  ];
}

export function runBootPreflight(checks?: BootChecker[]): BootCheckResult {
  const toRun = checks ?? defaultBootChecks();
  const failures: string[] = [];
  for (const check of toRun) {
    try {
      check();
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { ok: failures.length === 0, failures };
}
