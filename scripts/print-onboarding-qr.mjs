import qrcode from 'qrcode-terminal';

const SENSITIVE_PARAM = /token|key|secret|password|auth/i;

export function buildOnboardingHandoffUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Onboarding URL must be a complete http or https URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Onboarding URL must use http or https.');
  }
  if (!url.hostname) {
    throw new Error('Onboarding URL must include a host.');
  }
  if (url.username || url.password || url.hash) {
    throw new Error('Onboarding URL must not contain credentials or a fragment.');
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE_PARAM.test(key)) {
      throw new Error('Onboarding URL must not contain credential query parameters.');
    }
  }
  url.searchParams.set('onboarding', '1');
  return url.toString();
}

function main() {
  const rawUrl = process.argv[2];
  if (!rawUrl) {
    process.stderr.write('Usage: node scripts/print-onboarding-qr.mjs <onboarding-url>\n');
    process.exitCode = 2;
    return;
  }
  const handoffUrl = buildOnboardingHandoffUrl(rawUrl);
  process.stdout.write(`Scan this QR code to continue onboarding in your browser:\n${handoffUrl}\n\n`);
  qrcode.generate(handoffUrl, { small: true });
  process.stdout.write('This QR code contains no API key, bot token, or bearer token.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `onboarding QR error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  }
}
