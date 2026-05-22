/**
 * DEPRECATED: This file exists only for backward compatibility.
 * The /curator Telegram command and `fft curator` CLI are deprecated.
 * Use /skill-manager (Telegram) or `fft skill-manager` (CLI) instead.
 *
 * This file re-exports skill-manager-cli with a deprecation notice.
 */

// Signal to the skill-manager-cli that it's being invoked via the legacy alias
process.argv[1] = 'curator';

const legacyArgv = ['node', 'curator', ...process.argv.slice(2)];
const originalArgv = [...process.argv];
process.argv = legacyArgv;

import('./skill-manager-cli.js')
  .then(() => {
    // restore argv before running so the detection in skill-manager-cli works
    process.argv = originalArgv;
  })
  .catch((err) => {
    console.error(
      'skill-curator-cli: failed to load skill-manager-cli:',
      err.message,
    );
    process.exit(1);
  });
